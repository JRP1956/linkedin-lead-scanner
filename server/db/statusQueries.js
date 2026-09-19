const { getDb } = require('./queries');

// ─── Valid Lead Statuses ─────────────────────────────────────────────────────

const VALID_STATUSES = ['new', 'contacted', 'replied', 'meeting_booked', 'converted', 'dead'];

/**
 * Update a lead's status and log the change in history.
 * @param {number} leadId
 * @param {string} newStatus
 * @returns {Object} The updated lead
 */
function updateLeadStatus(leadId, newStatus) {
  if (!VALID_STATUSES.includes(newStatus)) {
    throw new Error(`Invalid status: ${newStatus}. Must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  const db = getDb();

  const lead = db.prepare('SELECT id, lead_status FROM leads WHERE id = ?').get(leadId);
  if (!lead) throw new Error('Lead not found');

  const oldStatus = lead.lead_status || 'new';
  if (oldStatus === newStatus) return lead;

  const updateAndLog = db.transaction(() => {
    db.prepare('UPDATE leads SET lead_status = ? WHERE id = ?').run(newStatus, leadId);
    db.prepare(
      'INSERT INTO lead_status_history (lead_id, old_status, new_status) VALUES (?, ?, ?)'
    ).run(leadId, oldStatus, newStatus);
  });

  updateAndLog();

  return db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
}

/**
 * Get the status change history for a lead.
 * @param {number} leadId
 * @returns {Array}
 */
function getLeadStatusHistory(leadId) {
  const stmt = getDb().prepare(
    'SELECT * FROM lead_status_history WHERE lead_id = ? ORDER BY changed_at DESC'
  );
  return stmt.all(leadId);
}

module.exports = {
  updateLeadStatus,
  getLeadStatusHistory,
};
