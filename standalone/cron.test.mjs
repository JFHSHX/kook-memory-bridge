import assert from 'node:assert/strict';
import { cronMatches, nextCronAt } from './cron.mjs';
assert.equal(cronMatches('0 * * * *', new Date('2026-11-21T13:00:00Z')), true);
assert.equal(cronMatches('0 * * * *', new Date('2026-11-21T13:01:00Z')), false);
assert.equal(cronMatches('*/15 * * * *', new Date('2026-11-21T13:30:00Z')), true);
assert.equal(cronMatches('30 3 * * 0', new Date('2026-11-22T03:30:00Z')), true);
assert.equal(cronMatches('0 9 * * 1-5', new Date('2026-11-22T09:00:00Z')), false);
assert.equal(nextCronAt('0 * * * *', new Date('2026-11-21T13:00:00Z')).toISOString(), '2026-11-21T14:00:00.000Z');
console.log('✓ 五字段 cron 通配符、步长、范围、星期与下一次运行时间');