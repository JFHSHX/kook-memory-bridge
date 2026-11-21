import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConsolidationRunner, deduplicateFacts } from '../lib/consolidation-state.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kook-consolidation-state-'));
const dedup = deduplicateFacts([{ id: 'a', text: '用户喜欢 Vue' }, { id: 'b', text: '用户喜欢 Vue' }, { id: 'c', text: '用户喜欢 Vue 和 Vite' }]);
assert.ok(dedup.duplicates >= 1);
console.log('✓ 精确与近似去重');
const runner = new ConsolidationRunner(dir, { lockMs: 1000 });
const first = runner.run('default', async () => { await new Promise(resolve => setTimeout(resolve, 50)); return { created: 1 }; });
let busy = false;
try { await runner.run('default', async () => ({ created: 1 })); } catch (error) { busy = /busy/.test(error.message); }
assert.equal(busy, true);
await first;
assert.equal(runner.status().state, 'committed');
console.log('✓ 并发锁防止同 bank 并行写入');
await assert.rejects(() => runner.run('default', async () => { throw new Error('模拟失败'); }));
assert.equal(runner.status().state, 'failed');
const recovered = await runner.run('default', async () => ({ created: 0 }));
assert.equal(recovered.consolidation.state, 'committed');
console.log('✓ 失败记录与自动恢复');
fs.rmSync(dir, { recursive: true, force: true });