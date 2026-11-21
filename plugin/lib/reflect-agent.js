import { searchKookMemory } from './search.js';
import { readMemory } from './core.js';
import { activeDirectives, resolveBankConfig } from './banks.js';
import { observationsAreStale } from './consolidation.js';
import { isMentalModelStale } from './mental-models.js';
import { buildReflectPrompt, validateCitations } from './llm.js';

const idOf = entry => String(entry.id || entry.msgId);
const unique = entries => [...new Map(entries.map(entry => [idOf(entry), entry])).values()];

export function createDecisionModel(client) {
  if (!client?.enabled) return null;
  return {
    async evaluate({ question, evidence, iteration, maxIterations }) {
      const allowed = new Set(evidence.map(idOf));
      const messages = [
        { role: 'system', content: '你是 reflect 的 decision model。只输出 JSON：{"answer_found":boolean,"done":boolean,"reason":"...","next_query":"...","include_ids":["..."]}。只能引用输入证据中的真实 id。答案证据不足时 done=false 并给出更具体的 next_query；不得编造。当前第 ' + iteration + ' 轮，最多 ' + maxIterations + ' 轮。' },
        { role: 'user', content: JSON.stringify({ question, evidence }) },
      ];
      const raw = await client.completeJson(messages, { maxTokens: 700, temperature: 0 });
      const includeIds = (raw.include_ids || []).filter(id => allowed.has(id));
      return {
        answerFound: raw.answer_found === true,
        done: raw.done === true,
        reason: String(raw.reason || ''),
        nextQuery: String(raw.next_query || ''),
        includeIds,
        invalidIds: (raw.include_ids || []).filter(id => !allowed.has(id)),
      };
    },
  };
}

export async function runReflectAgent({
  cfg, dir, question, bank = 'default', limit = 6, maxTokens = 3000, tags = [], client,
  maxIterations = 10, decisionModel = false,
}) {
  const rows = [];
  const toolTrace = [];
  const decisions = [];
  const seenQueries = new Set();
  let memories = [], observations = [], mentalModels = [];
  let query = String(question).trim();
  if (!query) throw new Error('reflect agent: question 不能为空');
  const iterations = Math.max(1, Math.min(20, Number(maxIterations) || 10));
  const evaluator = decisionModel ? createDecisionModel(client) : null;
  let recalled = false;

  for (let iteration = 1; iteration <= iterations; iteration++) {
    if (seenQueries.has(query)) throw new Error('reflect agent 查询未前进，已停止循环');
    seenQueries.add(query);
    const searchLimit = Math.max(1, Math.min(20, Number(limit) || 6));
    const [mm, obs, raw] = await Promise.all([
      searchKookMemory(cfg, dir, { query, bank, kinds: ['mental_model'], limit: searchLimit, maxTokens: 3000 }),
      searchKookMemory(cfg, dir, { query, bank, kinds: ['observation'], limit: searchLimit, maxTokens: 3000 }),
      searchKookMemory(cfg, dir, { query, bank, kinds: ['memory'], limit: searchLimit, maxTokens }),
    ]);
    mentalModels = unique([...mentalModels, ...mm.results.map(x => x.entry)]);
    observations = unique([...observations, ...obs.results.map(x => x.entry)]);
    memories = unique([...memories, ...raw.results.map(x => x.entry)]);
    recalled = true;
    toolTrace.push({ tool: 'search_mental_models', query, iteration, resultCount: mm.results.length });
    toolTrace.push({ tool: 'search_observations', query, iteration, resultCount: obs.results.length });
    toolTrace.push({ tool: 'recall', query, iteration, resultCount: raw.results.length });

    const currentRows = readMemory(dir);
    mentalModels = mentalModels.map(entry => ({ ...entry, stale: isMentalModelStale(entry, currentRows) }));
    observations = observations.map(entry => ({ ...entry, stale: observationsAreStale(entry, currentRows) }));
    const evidence = unique([...mentalModels, ...observations, ...memories]);
    if (evaluator) {
      const decision = await evaluator.evaluate({ question, evidence, iteration, maxIterations: iterations });
      decisions.push({ iteration, ...decision });
      if (decision.invalidIds.length) throw new Error('decision model 引用了未检索 id: ' + decision.invalidIds.join(','));
      if (decision.answerFound && decision.done) break;
      if (iteration < iterations && decision.nextQuery && decision.nextQuery !== query) {
        query = decision.nextQuery;
        continue;
      }
      if (decision.answerFound) break;
    }
    if (!evaluator && evidence.length) break;
    if (iteration === iterations) break;
    if (!decisions.length && evidence.length) break;
    if (evaluator && decisions.at(-1)?.done) break;
    if (evaluator && !decisions.at(-1)?.nextQuery) break;
  }
  if (!recalled) throw new Error('reflect agent 未执行 raw recall');

  const bankConfig = resolveBankConfig(rows, bank);
  const directives = activeDirectives(rows, bank, tags);
  const messages = buildReflectPrompt({
    question, mentalModels, observations, memories, directives, bankConfig, toolTrace,
  });
  const answer = await client.complete(messages, { maxTokens, temperature: 0.2 });
  const allowedIds = [...mentalModels, ...observations, ...memories].map(idOf);
  const validation = validateCitations(answer, allowedIds);
  if (!validation.ok) throw new Error('reflect 引用了未检索 id: ' + validation.unknown.join(','));
  return {
    answer,
    basedOn: allowedIds.filter(id => validation.citations.includes(id)),
    toolTrace,
    iterations: toolTrace.filter(item => item.tool === 'recall').length,
    decisionModel: evaluator ? { enabled: true, decisions } : { enabled: false, decisions: [] },
    evidence: { mentalModels, observations, memories },
  };
}