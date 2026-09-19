const test = require('node:test');
const assert = require('node:assert/strict');
const { initDatabase } = require('../db/queries');
const { scanContext, recordUsage, countToday, assertUnderDailyCap, getUsageSummary } = require('../db/usageQueries');

initDatabase(':memory:');

test('daily cap blocks once the limit is reached; 0 disables it', () => {
  assertUnderDailyCap('scan', 2);
  recordUsage({ kind: 'scan' });
  recordUsage({ kind: 'scan' });
  assert.equal(countToday('scan'), 2);
  assert.throws(() => assertUnderDailyCap('scan', 2), { code: 'DAILY_CAP_REACHED' });
  assertUnderDailyCap('scan', 0);
  assertUnderDailyCap('email', 2); // other kinds are counted separately
});

test('usage inside a scan context is attributed to that post', async () => {
  await scanContext.run({ postUrl: 'https://www.linkedin.com/posts/p1' }, async () => {
    await Promise.resolve();
    recordUsage({ kind: 'claude', units: 1500, costUsd: 0.01 });
    recordUsage({ kind: 'apollo', costUsd: 0.02 });
  });
  const [scan] = getUsageSummary().byScan;
  assert.equal(scan.post_url, 'https://www.linkedin.com/posts/p1');
  assert.equal(scan.cost_usd, 0.03);
  assert.equal(scan.claude_tokens, 1500);
  assert.equal(scan.apollo_credits, 1);
});
