const { getDb } = require('./queries');

// ─── Cross-Scan Signal Stacking Queries ──────────────────────────────────────

/**
 * Record a lead's appearance on a post.
 * Uses INSERT OR IGNORE so the same linkedin_url + post_url pair is only stored once.
 * @param {{ linkedinUrl: string, postUrl: string, commentText?: string }}
 */
function recordAppearance({ linkedinUrl, postUrl, commentText }) {
  const stmt = getDb().prepare(`
    INSERT OR IGNORE INTO lead_appearances (linkedin_url, post_url, comment_text)
    VALUES (?, ?, ?)
  `);
  return stmt.run(linkedinUrl, postUrl, commentText || null);
}

/**
 * Get the number of distinct posts a lead has appeared in.
 * @param {string} linkedinUrl
 * @returns {number}
 */
function getAppearanceCount(linkedinUrl) {
  const stmt = getDb().prepare(
    'SELECT COUNT(DISTINCT post_url) as count FROM lead_appearances WHERE linkedin_url = ?'
  );
  return stmt.get(linkedinUrl)?.count || 0;
}

/**
 * Get appearance counts for multiple LinkedIn URLs at once.
 * Returns a Map of linkedinUrl → count for efficient lookup during scan.
 * @param {string[]} linkedinUrls
 * @returns {Map<string, number>}
 */
function getAppearanceCounts(linkedinUrls) {
  if (!linkedinUrls || linkedinUrls.length === 0) return new Map();

  const placeholders = linkedinUrls.map(() => '?').join(',');
  const stmt = getDb().prepare(`
    SELECT linkedin_url, COUNT(DISTINCT post_url) as count
    FROM lead_appearances
    WHERE linkedin_url IN (${placeholders})
    GROUP BY linkedin_url
  `);
  const rows = stmt.all(...linkedinUrls);
  return new Map(rows.map((r) => [r.linkedin_url, r.count]));
}

/**
 * Get the full appearance history for a lead.
 * @param {string} linkedinUrl
 * @returns {Array<{ post_url: string, comment_text: string, seen_at: string }>}
 */
function getAppearanceHistory(linkedinUrl) {
  const stmt = getDb().prepare(
    'SELECT post_url, comment_text, seen_at FROM lead_appearances WHERE linkedin_url = ? ORDER BY seen_at DESC'
  );
  return stmt.all(linkedinUrl);
}

/**
 * Get leads that have appeared in multiple posts (multi-signal leads).
 * @param {number} [minAppearances=2]
 * @returns {Array<{ linkedin_url: string, appearance_count: number }>}
 */
function getMultiSignalLeads(minAppearances = 2) {
  const stmt = getDb().prepare(`
    SELECT la.linkedin_url, COUNT(DISTINCT la.post_url) as appearance_count,
           l.name, l.title, l.company, l.total_score, l.intent_tier, l.lead_status
    FROM lead_appearances la
    LEFT JOIN leads l ON la.linkedin_url = l.linkedin_url
    GROUP BY la.linkedin_url
    HAVING appearance_count >= ?
    ORDER BY appearance_count DESC, l.total_score DESC
  `);
  return stmt.all(minAppearances);
}

module.exports = {
  recordAppearance,
  getAppearanceCount,
  getAppearanceCounts,
  getAppearanceHistory,
  getMultiSignalLeads,
};
