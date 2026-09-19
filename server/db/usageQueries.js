const { AsyncLocalStorage } = require('async_hooks');
const { getDb } = require('./queries');

/**
 * Usage tracking: one row per billable/risky action (scan, email, claude, apollo, proxycurl).
 * Powers daily caps and per-scan cost reporting.
 *
 * scanContext lets deep callees (Claude, Apollo) tag usage with the scan's postUrl
 * without threading it through every function signature.
 */
const scanContext = new AsyncLocalStorage();

const DAILY_CAP_REACHED = 'DAILY_CAP_REACHED';

function recordUsage({ kind, units = 1, costUsd = 0, detail = null }) {
  const postUrl = scanContext.getStore()?.postUrl || null;
  getDb().prepare(
    'INSERT INTO usage_events (kind, post_url, units, cost_usd, detail) VALUES (?, ?, ?, ?, ?)'
  ).run(kind, postUrl, units, costUsd, detail);
}

// ponytail: "today" is a UTC day (SQLite 'now'), fine for caps meant to avoid bursts
function countToday(kind) {
  return getDb().prepare(
    "SELECT COUNT(*) AS n FROM usage_events WHERE kind = ? AND date(created_at) = date('now')"
  ).get(kind).n;
}

/**
 * Throw if today's count for `kind` has reached `limit`. A limit of 0 disables the cap.
 */
function assertUnderDailyCap(kind, limit) {
  if (!limit) return;
  const used = countToday(kind);
  if (used >= limit) {
    const err = new Error(`Daily ${kind} limit reached (${used}/${limit}). Try again tomorrow or raise the limit in .env.`);
    err.code = DAILY_CAP_REACHED;
    throw err;
  }
}

function dailyLimit(envVar, fallback) {
  const n = parseInt(process.env[envVar], 10);
  return Number.isNaN(n) ? fallback : n;
}

function getUsageSummary({ days = 30 } = {}) {
  const db = getDb();
  const since = `-${days} days`;
  return {
    today: {
      scans: countToday('scan'),
      scanLimit: dailyLimit('MAX_SCANS_PER_DAY', 10),
      emails: countToday('email'),
      emailLimit: dailyLimit('MAX_EMAILS_PER_DAY', 50),
    },
    byDay: db.prepare(`
      SELECT date(created_at) AS day, kind, SUM(units) AS units, ROUND(SUM(cost_usd), 4) AS cost_usd
      FROM usage_events WHERE created_at >= datetime('now', ?)
      GROUP BY day, kind ORDER BY day DESC
    `).all(since),
    byScan: db.prepare(`
      SELECT u.post_url, ROUND(SUM(u.cost_usd), 4) AS cost_usd,
        SUM(CASE WHEN u.kind = 'claude' THEN u.units ELSE 0 END) AS claude_tokens,
        SUM(CASE WHEN u.kind = 'apollo' THEN u.units ELSE 0 END) AS apollo_credits,
        (SELECT COUNT(*) FROM leads l WHERE l.post_url = u.post_url) AS leads,
        MAX(u.created_at) AS last_activity
      FROM usage_events u
      WHERE u.post_url IS NOT NULL AND u.created_at >= datetime('now', ?)
      GROUP BY u.post_url ORDER BY last_activity DESC
    `).all(since),
  };
}

module.exports = {
  scanContext,
  recordUsage,
  countToday,
  assertUnderDailyCap,
  dailyLimit,
  getUsageSummary,
  DAILY_CAP_REACHED,
};
