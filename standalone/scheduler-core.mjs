import fs from 'node:fs';
import path from 'node:path';
import { cronMatches, nextCronAt } from './cron.mjs';

export const DEFAULT_MODEL_ID = 'default-project-profile';
export const DEFAULT_SOURCE_QUERY = '总结当前用户的重要长期偏好、活跃项目、关键技术决策与未完成事项。按以下稳定块输出，且每块必须以对应标记开始：<!-- mm:preferences -->、<!-- mm:active-projects -->、<!-- mm:decisions -->、<!-- mm:next-actions -->。每块只保留有证据的具体事实，保留项目名、日期和当前值，每块最多保留2条，全文控制在300字以内；无证据写“暂无证据”，不要编造，不记录密钥。';
export const PLACEHOLDER = '（尚未生成）';

export function nextDeltaAt(now = new Date()) { const value = new Date(now); value.setUTCMinutes(0, 0, 0); value.setUTCHours(value.getUTCHours() + 1); return value; }
export function nextFullAt(now = new Date()) { const value = new Date(now); value.setUTCHours(3, 30, 0, 0); let days = (7 - value.getUTCDay()) % 7; if (days === 0 && value.getTime() <= now.getTime()) days = 7; value.setUTCDate(value.getUTCDate() + days); return value; }
export function emptyState() { return { version: 1, paused: {}, lastFullCompletedAt: {}, updatedAt: null }; }
export function sanitizeError(error) { return String(error?.message || error || 'unknown error').replace(/Bearer\s+\S+/gi, 'Bearer <redacted>').replace(/nvapi-[A-Za-z0-9_-]+/g, '<redacted>').replace(/sk-[A-Za-z0-9_-]+/g, '<redacted>').slice(0, 500); }

export function modelSchedule(model) { return model.payload?.schedule || {}; }
export function lastRefreshMode(model) { return model.payload?.lastRefreshMode || model.payload?.trigger || 'manual'; }

export function shouldRunModel(model, mode, { now = new Date(), afterConsolidation = false, state = {} } = {}) {
  if (mode === 'dry-run') mode = 'delta';
  const schedule = modelSchedule(model);
  const last = Date.parse(model.payload?.lastRefreshedAt || '');
  const interval = Number(schedule.min_refresh_interval_seconds || 0);
  if (interval > 0 && last && now.getTime() - last < interval * 1000) return { run: false, reason: 'min-refresh-interval' };
  if (mode === 'delta') {
    if (afterConsolidation && schedule.refresh_after_consolidation) {
      if (!model.stale) return { run: false, reason: 'not-stale' };
      return { run: true, reason: 'after-consolidation' };
    }
    if (!model.stale) return { run: false, reason: 'not-stale' };
    if (schedule.refresh_cron && !cronMatches(schedule.refresh_cron, now)) return { run: false, reason: 'cron-not-due' };
    return { run: true, reason: 'stale' };
  }
  if (mode === 'full') {
    const lastFull = state.lastFullCompletedAt?.[model.modelId];
    if (!last || lastRefreshMode(model) !== 'delta') return { run: false, reason: 'no-delta-since-full' };
    if (lastFull && last <= Date.parse(lastFull)) return { run: false, reason: 'no-delta-since-full' };
    if (schedule.full_refresh_cron && !cronMatches(schedule.full_refresh_cron, now)) return { run: false, reason: 'cron-not-due' };
    return { run: true, reason: 'delta-since-full' };
  }
  return { run: false, reason: 'unknown-mode' };
}

export function nextModelRunAt(model, mode, now = new Date()) {
  const schedule = modelSchedule(model);
  if (mode === 'delta' && schedule.refresh_cron) return nextCronAt(schedule.refresh_cron, now);
  if (mode === 'full' && schedule.full_refresh_cron) return nextCronAt(schedule.full_refresh_cron, now);
  return mode === 'full' ? nextFullAt(now) : nextDeltaAt(now);
}

export function nextRunAt(models, mode, now = new Date()) {
  const dates = (models || []).map(model => nextModelRunAt(model, mode, now));
  return dates.length ? new Date(Math.min(...dates.map(date => date.getTime()))) : (mode === 'full' ? nextFullAt(now) : nextDeltaAt(now));
}

export class MentalModelScheduler {
  constructor({ tools, stateFile, now = () => Date.now(), maxAttempts = 3, retryDelayMs = 250 }) {
    this.tools = tools; this.stateFile = stateFile; this.now = now; this.maxAttempts = maxAttempts; this.retryDelayMs = retryDelayMs; this.running = false; this.state = emptyState();
  }
  load() {
    try { const parsed = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')); this.state = { ...emptyState(), ...parsed, paused: parsed.paused || {}, lastFullCompletedAt: parsed.lastFullCompletedAt || {} }; }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('调度状态文件损坏，请修复或移走：' + this.stateFile); this.state = emptyState(); }
    return this.state;
  }
  save() {
    this.state.updatedAt = new Date(this.now()).toISOString();
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    const tmp = this.stateFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, this.stateFile);
  }
  async get(id) { const result = await this.tools.get({ modelId: id }); if (result?.ok === false) throw new Error(result.error || '读取模型失败'); return { model: result.model || result, stale: result.stale ?? result.model?.stale ?? false }; }
  resumeState(id, model) {
    const paused = this.state.paused[id];
    if (!paused) return null;
    const refreshedAt = Date.parse(model.payload?.lastRefreshedAt || '');
    if (refreshedAt > Date.parse(paused.pausedAt)) { delete this.state.paused[id]; return 'resumed'; }
    return 'paused';
  }
  async refreshOne(info, mode, { afterConsolidation = false } = {}) {
    const id = info.modelId;
    const { model, stale } = await this.get(id);
    const resumed = this.resumeState(id, model);
    if (resumed === 'paused') return { modelId: id, status: 'paused', reason: 'previous-failure' };
    const gate = shouldRunModel({ ...model, stale }, mode, { now: new Date(this.now()), afterConsolidation, state: this.state });
    if (!gate.run) return { modelId: id, status: 'skipped', reason: gate.reason };
    const text = String(model.text || '');
    const needsBaseline = text === PLACEHOLDER || !text.includes('<!-- mm:');
    if (mode === 'full' && text === PLACEHOLDER) return { modelId: id, status: 'skipped', reason: 'no-baseline' };
    const full = mode === 'full' || needsBaseline;
    if (mode === 'dry-run') return { modelId: id, status: 'would-refresh', mode: full ? 'full' : 'delta', reason: gate.reason };
    let lastError;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const result = await this.tools.refresh({ modelId: id, full, force: full });
        if (result?.refreshed === false) return { modelId: id, status: 'skipped', reason: 'not-stale' };
        const after = await this.get(id);
        const content = String(after.model.text || '');
        if (!content.trim() || content === PLACEHOLDER) throw new Error('刷新后内容为空');
        if (full) this.state.lastFullCompletedAt[id] = after.model.payload?.lastRefreshedAt || new Date(this.now()).toISOString();
        return { modelId: id, status: 'refreshed', mode: full ? 'full' : 'delta', attempts: attempt };
      } catch (error) {
        lastError = error;
        if (attempt < this.maxAttempts && this.retryDelayMs) await new Promise(resolve => setTimeout(resolve, this.retryDelayMs));
      }
    }
    const pausedAt = new Date(this.now()).toISOString();
    this.state.paused[id] = { pausedAt, error: sanitizeError(lastError) };
    return { modelId: id, status: 'failed', error: sanitizeError(lastError), attempts: this.maxAttempts };
  }
  async run(mode, { afterConsolidation = false } = {}) {
    if (!['delta', 'full', 'dry-run'].includes(mode)) throw new Error('未知调度模式: ' + mode);
    if (this.running) return { mode, busy: true, results: [], counts: { busy: 1 } };
    this.running = true;
    const results = [];
    try {
      this.load();
      const listing = await this.tools.list();
      if (listing?.ok === false) throw new Error(listing.error || '列出模型失败');
      for (const info of listing.models || []) results.push(await this.refreshOne(info, mode, { afterConsolidation }));
      return { mode, results, counts: summarize(results) };
    } finally { this.save(); this.running = false; }
  }
  async nextRunAt(mode) {
    const listing = await this.tools.list();
    return nextRunAt(listing.models || [], mode, new Date(this.now()));
  }
}

export function summarize(results) {
  const counts = { refreshed: 0, skipped: 0, paused: 0, failed: 0, wouldRefresh: 0 };
  for (const item of results) {
    if (item.status === 'refreshed') counts.refreshed++;
    else if (item.status === 'would-refresh') counts.wouldRefresh++;
    else if (item.status === 'failed') counts.failed++;
    else if (item.status === 'paused') counts.paused++;
    else counts.skipped++;
  }
  return counts;
}