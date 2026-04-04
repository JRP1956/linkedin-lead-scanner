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

function getSignalsByLead(leadId) {
  return getDb().prepare(
    'SELECT * FROM detected_signals WHERE lead_id = ? ORDER BY detected_at DESC'
  ).all(leadId);
}

function getSignalsByType(type, { limit = 50, processed } = {}) {
  let sql = 'SELECT * FROM detected_signals WHERE type = ?';
  const params = [type];

  if (processed !== undefined) {
    sql += ' AND processed = ?';
    params.push(processed ? 1 : 0);
  }

  sql += ' ORDER BY detected_at DESC LIMIT ?';
  params.push(limit);

  return getDb().prepare(sql).all(...params);
}

function getRecentSignals({ limit = 100 } = {}) {
  return getDb().prepare(
    'SELECT ds.*, l.name as lead_name, l.company as lead_company FROM detected_signals ds LEFT JOIN leads l ON ds.lead_id = l.id ORDER BY ds.detected_at DESC LIMIT ?'
  ).all(limit);
}

function markSignalProcessed(id) {
  return getDb().prepare('UPDATE detected_signals SET processed = 1 WHERE id = ?').run(id);
}

function getSignalStats() {
  return getDb().prepare(`
    SELECT type, COUNT(*) as count, 
           SUM(CASE WHEN processed = 0 THEN 1 ELSE 0 END) as unprocessed
    FROM detected_signals
    GROUP BY type
  `).all();
}

// ─── Keyword Monitors ───────────────────────────────────────────────────────

function createKeywordMonitor(keyword) {
  const stmt = getDb().prepare('INSERT INTO keyword_monitors (keyword) VALUES (?)');
  return stmt.run(keyword);
}

function getAllKeywordMonitors() {
  return getDb().prepare('SELECT * FROM keyword_monitors ORDER BY created_at DESC').all();
}

function getActiveKeywordMonitors() {
  return getDb().prepare('SELECT * FROM keyword_monitors WHERE active = 1').all();
}

function deleteKeywordMonitor(id) {
  return getDb().prepare('DELETE FROM keyword_monitors WHERE id = ?').run(id);
}

// ─── Company Headcount History ──────────────────────────────────────────────

function insertHeadcountSnapshot({ companyDomain, companyName, headcount }) {
  const stmt = getDb().prepare(`
    INSERT INTO company_headcount_history (company_domain, company_name, headcount)
    VALUES (?, ?, ?)
  `);
  return stmt.run(companyDomain, companyName || null, headcount);
}

function getHeadcountHistory(companyDomain, { limit = 10 } = {}) {
  return getDb().prepare(
    'SELECT * FROM company_headcount_history WHERE company_domain = ? ORDER BY checked_at DESC LIMIT ?'
  ).all(companyDomain, limit);
}

function getLatestHeadcount(companyDomain) {
  return getDb().prepare(
    'SELECT * FROM company_headcount_history WHERE company_domain = ? ORDER BY checked_at DESC LIMIT 1'
  ).get(companyDomain);
}

module.exports = {
  insertSignal,
  getSignalsByLead,
  getSignalsByType,
  getRecentSignals,
  markSignalProcessed,
  getSignalStats,
  createKeywordMonitor,
  getAllKeywordMonitors,
  getActiveKeywordMonitors,
  deleteKeywordMonitor,
  insertHeadcountSnapshot,
  getHeadcountHistory,
  getLatestHeadcount,
};
