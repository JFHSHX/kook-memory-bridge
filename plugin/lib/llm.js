import { normalizeUnit } from './units.js';
import { validateObservationDecision } from './consolidation.js';

export function extractJson(input) {
  const source = String(input || '').replace(/```(?:json)?/gi, '').trim();
  const starts = [...source].map((c, i) => ['{', '['].includes(c) ? i : -1).filter(i => i >= 0);
  for (const start of starts) {
    const open = source[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let i = start; i < source.length; i++) {
      const char = source[i];
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === '"') { quoted = !quoted; continue; }
      if (quoted) continue;
      if (char === open) depth++;
      if (char === close) {
        depth--;
        if (depth === 0) {
          const candidate = source.slice(start, i + 1).replace(/,\s*([}\]])/g, '$1');
          try { return JSON.parse(candidate); } catch { break; }
        }
      }
    }
  }
  throw new Error('LLM 输出中没有可解析的 JSON 对象/数组');
}

async function chatRequest(fetchImpl, url, { apiKey, body, timeoutMs, retries = 1 }) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const error = new Error(`LLM HTTP ${response.status}: ${text.slice(0, 180)}`);
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt >= retries || error.retryable === false) break;
    }
  }
  throw new Error(`LLM 调用失败：${lastError?.message || lastError}`);
}

export function createLLMClient(config = {}, { fetch: fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const baseURL = String(config.llmBaseURL || '').replace(/\/$/, '');
  const model = config.llmModel || '';
  const apiKeyEnv = config.llmApiKeyEnv || 'NS_API_KEY';
  const apiKey = config.llmApiKey || env[apiKeyEnv] || '';
  const client = {
    enabled: Boolean(baseURL && model && apiKey),
    model,
    async complete(messages, { responseFormat, temperature = 0.1, maxTokens = 3000, timeoutMs = 60000 } = {}) {
      if (!client.enabled) throw new Error(`LLM 未配置：需要 llmBaseURL、llmModel 与 ${apiKeyEnv}；可用 chunks/verbatim 离线模式`);
      const body = { model, messages, temperature, max_tokens: maxTokens, ...(config.llmDisableThinking ? { chat_template_kwargs: { enable_thinking: false } } : {}) };
      if (responseFormat) body.response_format = responseFormat;
      for (let attempt = 0; attempt < 2; attempt++) {
        const json = await chatRequest(fetchImpl, `${baseURL}/chat/completions`, { apiKey, body, timeoutMs, retries: 1 });
        const content = json.choices?.[0]?.message?.content;
        if (typeof content === 'string' && content.trim()) return content;
        if (Array.isArray(content)) {
          const joined = content.map(part => part?.text || '').join('');
          if (joined.trim()) return joined;
        }
      }
      throw new Error('LLM 响应缺少 choices[0].message.content（已重试）');
    },
    async completeJson(messages, options = {}) {
      const raw = await client.complete(messages, { ...options, responseFormat: options.responseFormat || { type: 'json_object' } });
      return extractJson(raw);
    },
  };
  return client;
}

export function buildFactExtractionPrompt({ content, mode = 'concise', mission = '', context = '', now = new Date().toISOString() }) {
  const verbose = mode === 'verbose';
  return [
    { role: 'system', content: [
      '你是 Hindsight 风格的长期记忆抽取器。只输出 JSON：{"facts":[...]}。',
      '每段输入通常产出 2–5 条粗粒度叙事事实；很短输入可只产 1 条。不要碎片化，不要输出解释。',
      '共指消解到具体实体；相对时间转 ISO occurredStart/End；mentionedAt 由系统提供，不编造。',
      '用户/外部客观事实 factType=world，agent 的所作所为 factType=experience，观察=observation，主观信念=opinion。',
      '实体 fields: {name,type,canonical}，type 仅 PERSON/ORG/LOCATION/PRODUCT/CONCEPT/OTHER。',
      '链接 fields: {target,type,weight}；只能引用输入给出的 msgId，新事实间可用 documentId:序号。新写因果边只用 caused_by。',
      '每条 field: text,factType,occurredStart,occurredEnd,entities,links,confidence；无日期用 null。',
      verbose ? 'verbose：保留更多上下文、推理链和关系，但仍只输出耐用事实。' : 'concise：压缩为清晰、独立、可检索的事实。',
      `当前时间 ${now}`,
    ].join('\n') },
    { role: 'user', content: `记忆使命：${mission || '保留 durable、具体、有证据价值的事实'}\n上下文：${context || '(无)'}\n\n输入：\n${content}` },
  ];
}

export function parseExtractedFacts(raw, { bank = 'default', documentId, chunkId = null, tags = ['#fact'], context = '', mentionedAt = new Date().toISOString(), metadata = {}, factType: forcedFactType = null } = {}) {
  const list = Array.isArray(raw) ? raw : raw?.facts;
  if (!Array.isArray(list)) throw new Error('事实抽取结果缺少 facts 数组');
  if (list.length > 20) throw new Error('单次抽取事实超过 20 条，已拒绝');
  return list.filter(fact => String(fact?.text || fact?.fact || '').trim()).map((fact, index) => {
    const factType = forcedFactType || fact.factType || fact.fact_type || 'world';
    const autoTag = factType === 'experience' ? '#exp' : factType === 'observation' ? '#observation' : factType === 'opinion' ? '#opinion' : '#fact';
    return normalizeUnit({
      bank, documentId, chunkId, context,
      text: fact.text || fact.fact,
      factType,
      tags: [...new Set([...tags, autoTag])],
      occurredStart: fact.occurredStart || fact.occurred_start || null,
      occurredEnd: fact.occurredEnd || fact.occurred_end || null,
      mentionedAt,
      entities: fact.entities || [],
      links: fact.links || [],
      confidence: fact.confidence ?? (factType === 'opinion' ? 0.5 : 1),
      metadata: { ...metadata, extractionIndex: index },
    });
  });
}

export async function extractFacts(client, args) {
  const raw = await client.completeJson(buildFactExtractionPrompt(args), { maxTokens: args.maxTokens || 3000 });
  return parseExtractedFacts(raw, args);
}

export function buildObservationReconcilePrompt({ observations = [], facts = [], mission = '' }) {
  return [
    { role: 'system', content: [
      '你在整合长期观察。只输出 JSON：{"decisions":[{"action":"create|update|delete|skip","effect":"unrelated|repeats|changes|ends|adds","observationId":"...","text":"...","sourceMemoryIds":["..."],"scope":["#tag"]}]}',
      'repeats 只增加证据；changes/ends 必须保留“此前/现在”的历史，不抹掉旧理解；raw facts 永不修改。',
      'proofCount 由系统按去重 source ids 计算。只能引用输入实际给出的 fact 和 observation id。scope 不得跨组。',
      `整合使命：${mission || '长期稳定、可证据回溯的观察'}`,
    ].join('\n') },
    { role: 'user', content: JSON.stringify({ observations, facts }) },
  ];
}

export function parseObservationDecisions(raw, facts) {
  const list = raw?.decisions || (raw?.decision ? [raw.decision] : raw?.action ? [raw] : []);
  if (!Array.isArray(list) || !list.length) throw new Error('观察对账结果缺少 decisions');
  return list.map(decision => validateObservationDecision(decision, facts));
}

export function buildMentalModelDeltaPrompt({ model, newMemories = [] }) {
  return [
    { role: 'system', content: [
      '对 mental model 做增量编辑，不重写全文。未触及块必须逐字保留。',
      '块格式 <!-- mm:block-id -->。只输出 JSON：{"operations":[{"action":"replace|append|delete","id":"block-id","text":"..."}]}。',
      'id 必须原样使用现有块标记中的 block-id，不要包含 mm: 前缀。已有事实变化时必须 replace 对应块，不得 append 新值或保留过期值；只有新增主题才使用新 id。',
      '无基线或问题改变时才全量生成；空答案不是有效刷新。',
    ].join('\n') },
    { role: 'user', content: JSON.stringify({ sourceQuery: model.payload?.sourceQuery || model.question, current: model.text, newMemories: newMemories.map(m => ({ id: m.id || m.msgId, text: m.text, ts: m.ts })) }) },
  ];
}

export function buildReflectPrompt({ question, mentalModels = [], observations = [], memories = [], directives = [], bankConfig = {}, toolTrace = [] }) {
  const disposition = bankConfig.disposition || { skepticism: 3, literalism: 3, empathy: 3 };
  const pack = items => items.map(item => ({ id: item.id || item.msgId, text: item.text, stale: item.stale || false, proofCount: item.proofCount, occurredStart: item.occurredStart, occurredEnd: item.occurredEnd }));
  return [
    { role: 'system', content: [
      bankConfig.reflectMission || '基于检索证据回答，不编造来源。',
      `Disposition: skepticism=${disposition.skepticism}, literalism=${disposition.literalism}, empathy=${disposition.empathy}, biasStrength=${bankConfig.biasStrength ?? 0.5}`,
      '检索阶梯：mental models（stale 必须回查）→ observations（带证据与新鲜度）→ raw facts。',
      '只能引用实际提供的 id，格式 [id]；没有证据就明确说不知道。不要输出工具调用幻想。',
      ...directives.map(d => `硬规则：${d.text || d.content}`),
    ].join('\n') },
    { role: 'user', content: JSON.stringify({ question, mentalModels: pack(mentalModels), observations: pack(observations), memories: pack(memories), toolTrace }) },
  ];
}

export function validateCitations(answer, allowedIds) {
  const allowed = new Set([...allowedIds].map(String));
  const citations = [...String(answer).matchAll(/\[([A-Za-z0-9][A-Za-z0-9_.:-]{1,})\]/g)].map(m => m[1]);
  const unknown = [...new Set(citations.filter(id => !allowed.has(id)))];
  return { ok: unknown.length === 0, citations: [...new Set(citations)], unknown };
}

export async function reflect(client, args) {
  const allowed = [...args.mentalModels, ...args.observations, ...args.memories].map(m => m.id || m.msgId);
  const answer = await client.complete(buildReflectPrompt(args), { maxTokens: args.maxTokens || 3000, temperature: 0.2 });
  const validation = validateCitations(answer, allowed);
  if (!validation.ok) throw new Error(`reflect 引用了未检索 id: ${validation.unknown.join(', ')}`);
  return { answer, citations: validation.citations, basedOn: allowed.filter(id => validation.citations.includes(id)), toolTrace: args.toolTrace || [] };
}
