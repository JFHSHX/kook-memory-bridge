import assert from 'node:assert/strict';
import { extractJson, createLLMClient, buildFactExtractionPrompt, parseExtractedFacts, buildObservationReconcilePrompt, parseObservationDecisions, buildMentalModelDeltaPrompt, buildReflectPrompt, validateCitations, reflect } from '../lib/llm.js';

assert.deepEqual(extractJson('前言```json\n{"facts":[]}\n```后缀'), { facts: [] });
assert.deepEqual(extractJson('{"x":[1,2,],}'), { x: [1, 2] });
assert.throws(() => extractJson('没有 JSON'), /没有可解析/);
console.log('✓ JSON 提取/代码围栏/尾逗号/错误');

const calls = [];
const client = createLLMClient({ llmBaseURL: 'https://mock.llm/v1', llmModel: 'mock-model', llmApiKey: 'test-key' }, {
  env: {},
  fetch: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"facts":[]}' } }] }) };
  },
});
assert.equal(client.enabled, true);
assert.deepEqual(await client.completeJson([{ role: 'user', content: 'x' }]), { facts: [] });
assert.equal(calls[0].url, 'https://mock.llm/v1/chat/completions');
assert.equal(JSON.parse(calls[0].options.body).response_format.type, 'json_object');
const noKey = createLLMClient({}, { env: {} });
assert.equal(noKey.enabled, false);
await assert.rejects(() => noKey.complete([]), /LLM 未配置/);
console.log('✓ OpenAI 客户端/JSON mode/未配置可行动错误');

const facts = parseExtractedFacts({ facts: [{
  text: '用户上周从 React 迁到 Vue', factType: 'world', occurredStart: '2026-11-01', occurredEnd: '2026-11-08',
  entities: [{ name: 'Vue', type: 'PRODUCT' }], links: [],
}] }, { documentId: 'doc-1', bank: 'default', tags: ['#project'] });
assert.equal(facts.length, 1);
assert.equal(facts[0].documentId, 'doc-1');
assert.equal(facts[0].entities[0].canonical, 'vue');
assert.ok(facts[0].tags.includes('#fact'));
const prompt = buildFactExtractionPrompt({ content: '我上周迁移', mode: 'verbose', mission: '保留技术选择', now: '2026-11-15' });
assert.ok(prompt[0].content.includes('2–5'));
assert.ok(prompt[0].content.includes('verbose'));
console.log('✓ 叙事事实抽取保留时间/实体/文档/factType');

const obsPrompt = buildObservationReconcilePrompt({ observations: [], facts });
assert.ok(obsPrompt[0].content.includes('raw facts 永不修改'));
const decisions = parseObservationDecisions({ decisions: [{ action: 'update', effect: 'repeats', sourceMemoryIds: ['f1'] }] }, [{ id: 'f1' }]);
assert.equal(decisions[0].sourceMemoryIds[0], 'f1');
assert.throws(() => parseObservationDecisions({ decisions: [{ action: 'create', text: '伪造', sourceMemoryIds: ['x'] }] }, [{ id: 'f1' }]), /未输入/);
console.log('✓ observation prompt 与证据 id 校验');

const mmPrompt = buildMentalModelDeltaPrompt({ model: { text: '旧文', payload: { sourceQuery: '偏好' }, question: '偏好' }, newMemories: [] });
assert.ok(mmPrompt[0].content.includes('未触及块必须逐字保留'));
console.log('✓ mental model delta prompt');

const args = {
  question: '我喜欢什么？', bankConfig: { disposition: { skepticism: 4, literalism: 3, empathy: 2 } },
  mentalModels: [], observations: [], memories: [{ id: 'm1', text: '用户喜欢 Vue' }], directives: [{ text: '用中文' }], toolTrace: ['recall'],
};
const reflectPrompt = buildReflectPrompt(args);
assert.ok(reflectPrompt[0].content.includes('skepticism=4'));
assert.ok(reflectPrompt[0].content.includes('硬规则：用中文'));
assert.equal(validateCitations('因为 [m1]', ['m1']).ok, true);
assert.equal(validateCitations('伪造 [m2]', ['m1']).unknown[0], 'm2');
const answerClient = { complete: async () => '你喜欢 Vue [m1]' };
const reflected = await reflect(answerClient, args);
assert.deepEqual(reflected.basedOn, ['m1']);
await assert.rejects(() => reflect({ complete: async () => '假引用 [m2]' }, args), /未检索 id/);
console.log('✓ reflect disposition/directives/basedOn/非法引用拒绝');
