const { getDb } = require('./queries');

// ─── Suppression List Queries ────────────────────────────────────────────────

/**
 * Check multiple LinkedIn URLs against the suppression list.
 * Returns a Set of suppressed URLs for fast lookup.
 * @param {string[]} linkedinUrls
 * @returns {Set<string>}
 */
function getSuppressedUrls(linkedinUrls) {
  if (!linkedinUrls || linkedinUrls.length === 0) return new Set();

  const placeholders = linkedinUrls.map(() => '?').join(',');
  const stmt = getDb().prepare(
    `SELECT linkedin_url FROM suppression_list WHERE linkedin_url IN (${placeholders})`
  );
  const rows = stmt.all(...linkedinUrls);
  return new Set(rows.map((r) => r.linkedin_url));
}

/**
 * Add a single entry to the suppression list.
 * @param {{ linkedinUrl: string, name?: string, reason?: string, source?: string }} entry
 * @returns {Object} Insert result
 */
function addToSuppressionList({ linkedinUrl, name, reason, source }) {
  const stmt = getDb().prepare(`
    INSERT INTO suppression_list (linkedin_url, name, reason, source)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(linkedin_url) DO UPDATE SET
      name = COALESCE(excluded.name, suppression_list.name),
      reason = excluded.reason,
      source = excluded.source
  `);
  return stmt.run(linkedinUrl, name || null, reason || 'manual_exclude', source || 'manual');
}

/**
 * Bulk add entries to the suppression list.
 * @param {Array<{ linkedinUrl: string, name?: string }>} entries
 * @param {string} [reason='manual_exclude']
 * @param {string} [source='csv_import']
 * @returns {{ added: number, skipped: number }}
 */
function bulkAddToSuppressionList(entries, reason = 'manual_exclude', source = 'csv_import') {
  const stmt = getDb().prepare(`
    INSERT INTO suppression_list (linkedin_url, name, reason, source)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(linkedin_url) DO NOTHING
  `);

  const insertMany = getDb().transaction((items) => {
    let added = 0;
    let skipped = 0;
    for (const item of items) {
      const result = stmt.run(item.linkedinUrl, item.name || null, reason, source);
      if (result.changes > 0) added++;
      else skipped++;
    }
    return { added, skipped };
  });

  return insertMany(entries);
}

/**
 * Remove an entry from the suppression list by ID.
 * @param {number} id
 */
function removeFromSuppressionList(id) {
  const stmt = getDb().prepare('DELETE FROM suppression_list WHERE id = ?');
  return stmt.run(id);
}

/**
 * Get all suppressed leads with optional filtering.
 * @param {{ reason?: string, search?: string }} [filters={}]
 * @returns {Array} Suppressed lead entries
 */
function getAllSuppressed({ reason, search } = {}) {
  let sql = 'SELECT * FROM suppression_list WHERE 1=1';
  const params = [];

  if (reason) {
    sql += ' AND reason = ?';
    params.push(reason);
  }
  if (search) {
    sql += ' AND (linkedin_url LIKE ? OR name LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  sql += ' ORDER BY added_at DESC';

  const stmt = getDb().prepare(sql);
  return stmt.all(...params);
}

module.exports = {
  getSuppressedUrls,
  addToSuppressionList,
  bulkAddToSuppressionList,
  removeFromSuppressionList,
  getAllSuppressed,
};
