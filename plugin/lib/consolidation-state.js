import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scopeKey, scopeVariants } from './consolidation.js';

const norm = value => String(value || '').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
const tokens = value => {
  const text = norm(value);
  const out = new Set(text.match(/[a-z0-9_]+|[\u4e00-\u9fff]/g) || []);
  for (let i = 0; i < text.length - 1; i++) out.add(text.slice(i, i + 2));
  return out;
};
export function similarity(a, b) {
  const left = tokens(a), right = tokens(b);
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter(token => right.has(token)).length;
  return intersection / (left.size + right.size - intersection);
}

export function deduplicateFacts(facts, { nearDuplicateThreshold = 0.92 } = {}) {
  const groups = [];
  for (const fact of facts) {
    const text = norm(fact.text);
    let group = groups.find(item => item.text === text);
    if (!group) group = groups.find(item => similarity(item.text, text) >= nearDuplicateThreshold);
    if (group) { group.members.push(fact); continue; }
    groups.push({ canonical: fact, text, members: [fact] });
  }
  return {
    groups,
    facts: groups.map(group => group.canonical),
    duplicates: facts.length - groups.length,
  };
}

const locks = new Map();
const initialState = () => ({ state: 'idle', runId: null, error: null, history: [] });

export class ConsolidationRunner {
  constructor(dir, { lockMs = 30000 } = {}) {
    this.dir = dir;
    this.stateFile = path.join(dir, 'consolidation-state.json');
    this.historyFile = path.join(dir, 'consolidation-history.jsonl');
    this.lockMs = lockMs;
  }

  read() {
    try { return { ...initialState(), ...JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) }; } catch { return initialState(); }
  }

  write(state) {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = this.stateFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.stateFile);
  }

  record(state) {
    fs.appendFileSync(this.historyFile, JSON.stringify({ at: new Date().toISOString(), ...state }) + '\n', { mode: 0o600 });
  }

  acquire(bank) {
    if (locks.has(bank)) throw new Error('consolidation busy: ' + bank);
    const file = path.join(this.dir, 'consolidation-' + bank + '.lock');
    if (fs.existsSync(file)) {
      const age = Date.now() - fs.statSync(file).mtimeMs;
      if (age < this.lockMs) throw new Error('consolidation busy: ' + bank);
      fs.rmSync(file, { force: true });
    }
    fs.writeFileSync(file, String(process.pid), { flag: 'wx', mode: 0o600 });
    locks.set(bank, file);
    return file;
  }

  release(bank) {
    const file = locks.get(bank);
    if (file) fs.rmSync(file, { force: true });
    locks.delete(bank);
  }

  async run(bank, task, { autoResume = true } = {}) {
    const lock = this.acquire(bank);
    const runId = `consolidation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let state = this.read();
    if (state.state === 'failed' && !autoResume) throw new Error('consolidation 已暂停，请先 resume');
    if (state.state === 'failed') state = { ...state, resumedFrom: state.runId };
    try {
      state = { ...state, state: 'preparing', runId, error: null };
      this.write(state);
      const dedup = deduplicateFacts([]);
      state = { ...state, state: 'consolidating' };
      this.write(state);
      const result = await task({ deduplicateFacts, scopeKey, scopeVariants, state: () => state });
      state = { ...state, state: 'committing' };
      this.write(state);
      state = { ...state, state: 'committed', finishedAt: new Date().toISOString(), history: [...(state.history || []), { runId, state: 'committed' }].slice(-20) };
      this.write(state);
      this.record(state);
      return { ...result, consolidation: { state: state.state, runId, duplicates: dedup.duplicates } };
    } catch (error) {
      state = { ...state, state: 'failed', error: error.message, failedAt: new Date().toISOString(), history: [...(state.history || []), { runId, state: 'failed', error: error.message }].slice(-20) };
      this.write(state);
      this.record(state);
      throw error;
    } finally { this.release(bank); }
  }

  status() { return this.read(); }
  resume() { const state = { ...this.read(), state: 'idle', error: null }; this.write(state); return state; }
}