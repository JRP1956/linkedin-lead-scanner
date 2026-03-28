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
 * Batch update status for multiple leads.
 * @param {number[]} leadIds
 * @param {string} newStatus
 * @returns {{ updated: number }}
 */
function batchUpdateStatus(leadIds, newStatus) {
  if (!VALID_STATUSES.includes(newStatus)) {
    throw new Error(`Invalid status: ${newStatus}. Must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  const db = getDb();

  const batchUpdate = db.transaction(() => {
    let updated = 0;
    for (const leadId of leadIds) {
      const lead = db.prepare('SELECT id, lead_status FROM leads WHERE id = ?').get(leadId);
      if (!lead) continue;

      const oldStatus = lead.lead_status || 'new';
      if (oldStatus === newStatus) continue;

      db.prepare('UPDATE leads SET lead_status = ? WHERE id = ?').run(newStatus, leadId);
      db.prepare(
        'INSERT INTO lead_status_history (lead_id, old_status, new_status) VALUES (?, ?, ?)'
      ).run(leadId, oldStatus, newStatus);
      updated++;
    }
    return { updated };
  });

  return batchUpdate();
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

/**
 * Get conversion funnel stats: count of leads per status.
 * @returns {Object} { new: N, contacted: N, replied: N, meeting_booked: N, converted: N, dead: N }
 */
function getStatusFunnel() {
  const stmt = getDb().prepare(`
    SELECT COALESCE(lead_status, 'new') as status, COUNT(*) as count
    FROM leads
    GROUP BY COALESCE(lead_status, 'new')
  `);
  const rows = stmt.all();

  const funnel = {};
  for (const s of VALID_STATUSES) {
    funnel[s] = 0;
  }
  for (const row of rows) {
    funnel[row.status] = row.count;
  }
  return funnel;
}

module.exports = {
  VALID_STATUSES,
  updateLeadStatus,
  batchUpdateStatus,
  getLeadStatusHistory,
  getStatusFunnel,
};
