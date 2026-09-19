const { getDb } = require('./queries');

// ─── Detected Signals ───────────────────────────────────────────────────────

function insertSignal({ type, leadId, linkedinUrl, companyDomain, data }) {
  const stmt = getDb().prepare(`
    INSERT INTO detected_signals (type, lead_id, linkedin_url, company_domain, data_json)
    VALUES (?, ?, ?, ?, ?)
  `);
  const dataJson = typeof data === 'string' ? data : JSON.stringify(data);
  const result = stmt.run(type, leadId || null, linkedinUrl || null, companyDomain || null, dataJson);
  return result.lastInsertRowid;
}

// ─── Keyword Monitors ───────────────────────────────────────────────────────

// ─── Company Headcount History ──────────────────────────────────────────────

function insertHeadcountSnapshot({ companyDomain, companyName, headcount }) {
  const stmt = getDb().prepare(`
    INSERT INTO company_headcount_history (company_domain, company_name, headcount)
    VALUES (?, ?, ?)
  `);
  return stmt.run(companyDomain, companyName || null, headcount);
}

function getLatestHeadcount(companyDomain) {
  return getDb().prepare(
    'SELECT * FROM company_headcount_history WHERE company_domain = ? ORDER BY checked_at DESC LIMIT 1'
  ).get(companyDomain);
}

module.exports = {
  insertSignal,
  insertHeadcountSnapshot,
  getLatestHeadcount,
};
