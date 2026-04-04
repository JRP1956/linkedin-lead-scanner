const { getDb } = require('../db/queries');

// ─── LinkedIn Senders CRUD ──────────────────────────────────────────────────

function createSender({ name, email, browserProfilePath, dailyLimit }) {
  const stmt = getDb().prepare(`
    INSERT INTO linkedin_senders (name, email, browser_profile_path, daily_limit)
    VALUES (?, ?, ?, ?)
  `);
  const result = stmt.run(name, email || null, browserProfilePath || null, dailyLimit || 50);
  return getSenderById(result.lastInsertRowid);
}

function getSenderById(id) {
  return getDb().prepare('SELECT * FROM linkedin_senders WHERE id = ?').get(id);
}

function getAllSenders() {
  return getDb().prepare('SELECT * FROM linkedin_senders ORDER BY created_at DESC').all();
}

function getActiveSenders() {
  return getDb().prepare('SELECT * FROM linkedin_senders WHERE active = 1').all();
}

function updateSender(id, updates) {
  const fields = [];
  const values = [];

  if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
  if (updates.email !== undefined) { fields.push('email = ?'); values.push(updates.email); }
  if (updates.browserProfilePath !== undefined) { fields.push('browser_profile_path = ?'); values.push(updates.browserProfilePath); }
  if (updates.dailyLimit !== undefined) { fields.push('daily_limit = ?'); values.push(updates.dailyLimit); }
  if (updates.active !== undefined) { fields.push('active = ?'); values.push(updates.active ? 1 : 0); }

  if (fields.length === 0) return getSenderById(id);

  values.push(id);
  getDb().prepare(`UPDATE linkedin_senders SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getSenderById(id);
}

function deleteSender(id) {
  return getDb().prepare('DELETE FROM linkedin_senders WHERE id = ?').run(id);
}

/**
 * Get the next available sender using round-robin.
 * Resets daily counts when the date changes.
 */
function getNextAvailableSender() {
  const today = new Date().toISOString().split('T')[0];
  const db = getDb();

  // Reset daily counts if needed
  db.prepare(`
    UPDATE linkedin_senders SET sent_today = 0, last_reset_date = ?
    WHERE last_reset_date IS NULL OR last_reset_date != ?
  `).run(today, today);

  // Get the sender with the lowest sent_today that hasn't hit their limit
  return db.prepare(`
    SELECT * FROM linkedin_senders
    WHERE active = 1 AND sent_today < daily_limit
    ORDER BY sent_today ASC
    LIMIT 1
  `).get();
}

function incrementSenderCount(id) {
  getDb().prepare('UPDATE linkedin_senders SET sent_today = sent_today + 1 WHERE id = ?').run(id);
}

module.exports = {
  createSender,
  getSenderById,
  getAllSenders,
  getActiveSenders,
  updateSender,
  deleteSender,
  getNextAvailableSender,
  incrementSenderCount,
};
