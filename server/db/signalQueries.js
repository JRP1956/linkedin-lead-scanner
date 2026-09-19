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

module.exports = {
  recordAppearance,
  getAppearanceCounts,
  getAppearanceHistory,
};
