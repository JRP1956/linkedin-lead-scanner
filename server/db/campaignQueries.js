const { getDb } = require('./queries');

// ─── Campaign CRUD ──────────────────────────────────────────────────────────

function createCampaign({ name, status, icpProfileId, description }) {
  const stmt = getDb().prepare(`
    INSERT INTO campaigns (name, status, icp_profile_id, description)
    VALUES (?, ?, ?, ?)
  `);
  const result = stmt.run(name, status || 'draft', icpProfileId || null, description || null);
  return getCampaignById(result.lastInsertRowid);
}

function getCampaignById(id) {
  const campaign = getDb().prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
  if (!campaign) return null;

  campaign.variants = getDb().prepare(
    'SELECT * FROM campaign_variants WHERE campaign_id = ? ORDER BY id'
  ).all(id);

  campaign.lead_count = getDb().prepare(
    'SELECT COUNT(*) as count FROM campaign_leads WHERE campaign_id = ?'
  ).get(id).count;

  return campaign;
}

function getAllCampaigns() {
  const campaigns = getDb().prepare(
    'SELECT * FROM campaigns ORDER BY created_at DESC'
  ).all();

  for (const campaign of campaigns) {
    campaign.lead_count = getDb().prepare(
      'SELECT COUNT(*) as count FROM campaign_leads WHERE campaign_id = ?'
    ).get(campaign.id).count;

    campaign.variants = getDb().prepare(
      'SELECT * FROM campaign_variants WHERE campaign_id = ? ORDER BY id'
    ).all(campaign.id);
  }

  return campaigns;
}

function updateCampaign(id, updates) {
  const fields = [];
  const values = [];

  if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.icpProfileId !== undefined) { fields.push('icp_profile_id = ?'); values.push(updates.icpProfileId); }
  if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }

  if (fields.length === 0) return getCampaignById(id);

  fields.push("updated_at = datetime('now')");
  values.push(id);

  getDb().prepare(`UPDATE campaigns SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getCampaignById(id);
}

function deleteCampaign(id) {
  return getDb().prepare('DELETE FROM campaigns WHERE id = ?').run(id);
}

// ─── Campaign Variants ──────────────────────────────────────────────────────

function addVariant({ campaignId, name, messageTemplate, isControl }) {
  const stmt = getDb().prepare(`
    INSERT INTO campaign_variants (campaign_id, name, message_template, is_control)
    VALUES (?, ?, ?, ?)
  `);
  const result = stmt.run(campaignId, name || 'Variant', messageTemplate || null, isControl ? 1 : 0);
  return getDb().prepare('SELECT * FROM campaign_variants WHERE id = ?').get(result.lastInsertRowid);
}

function updateVariant(id, { name, messageTemplate }) {
  const fields = [];
  const values = [];

  if (name !== undefined) { fields.push('name = ?'); values.push(name); }
  if (messageTemplate !== undefined) { fields.push('message_template = ?'); values.push(messageTemplate); }

  if (fields.length === 0) return getDb().prepare('SELECT * FROM campaign_variants WHERE id = ?').get(id);

  values.push(id);
  getDb().prepare(`UPDATE campaign_variants SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getDb().prepare('SELECT * FROM campaign_variants WHERE id = ?').get(id);
}

function deleteVariant(id) {
  return getDb().prepare('DELETE FROM campaign_variants WHERE id = ?').run(id);
}

// ─── Campaign Leads ─────────────────────────────────────────────────────────

function assignLeadsToCampaign(campaignId, leadIds, variantId) {
  const stmt = getDb().prepare(`
    INSERT OR IGNORE INTO campaign_leads (campaign_id, lead_id, variant_id)
    VALUES (?, ?, ?)
  `);

  const insertMany = getDb().transaction((ids) => {
    let assigned = 0;
    for (const leadId of ids) {
      const result = stmt.run(campaignId, leadId, variantId || null);
      if (result.changes > 0) assigned++;
    }
    return assigned;
  });

  return insertMany(leadIds);
}

function getCampaignLeads(campaignId, { status } = {}) {
  let sql = `
    SELECT cl.*, l.name, l.title, l.company, l.email, l.linkedin_url,
           l.total_score, l.intent_tier, l.lead_status,
           cv.name as variant_name
    FROM campaign_leads cl
    JOIN leads l ON cl.lead_id = l.id
    LEFT JOIN campaign_variants cv ON cl.variant_id = cv.id
    WHERE cl.campaign_id = ?
  `;
  const params = [campaignId];

  if (status) {
    sql += ' AND cl.status = ?';
    params.push(status);
  }

  sql += ' ORDER BY l.total_score DESC';
  return getDb().prepare(sql).all(...params);
}

function updateCampaignLeadStatus(campaignId, leadId, status) {
  const updateFields = { status };
  if (status === 'sent') updateFields.sent_at = new Date().toISOString();
  if (status === 'replied') updateFields.replied_at = new Date().toISOString();

  const fields = Object.keys(updateFields).map(k => `${k} = ?`).join(', ');
  const values = Object.values(updateFields);

  getDb().prepare(
    `UPDATE campaign_leads SET ${fields} WHERE campaign_id = ? AND lead_id = ?`
  ).run(...values, campaignId, leadId);
}

function removeCampaignLead(campaignId, leadId) {
  return getDb().prepare(
    'DELETE FROM campaign_leads WHERE campaign_id = ? AND lead_id = ?'
  ).run(campaignId, leadId);
}

// ─── Campaign Metrics ───────────────────────────────────────────────────────

function getCampaignMetrics(campaignId) {
  // Aggregated from campaign_leads
  const metrics = getDb().prepare(`
    SELECT
      COUNT(*) as total_leads,
      SUM(CASE WHEN status = 'sent' OR status = 'replied' THEN 1 ELSE 0 END) as sent,
      SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) as replied,
      SUM(CASE WHEN status = 'meeting_booked' THEN 1 ELSE 0 END) as meetings
    FROM campaign_leads
    WHERE campaign_id = ?
  `).get(campaignId);

  // Per-variant breakdown
  const variantMetrics = getDb().prepare(`
    SELECT
      cv.id as variant_id,
      cv.name as variant_name,
      COUNT(cl.id) as total_leads,
      SUM(CASE WHEN cl.status IN ('sent', 'replied', 'meeting_booked') THEN 1 ELSE 0 END) as sent,
      SUM(CASE WHEN cl.status = 'replied' THEN 1 ELSE 0 END) as replied
    FROM campaign_variants cv
    LEFT JOIN campaign_leads cl ON cv.id = cl.variant_id
    WHERE cv.campaign_id = ?
    GROUP BY cv.id
  `).all(campaignId);

  return {
    ...metrics,
    reply_rate: metrics.sent > 0 ? ((metrics.replied / metrics.sent) * 100).toFixed(1) : '0.0',
    variants: variantMetrics,
  };
}

module.exports = {
  createCampaign,
  getCampaignById,
  getAllCampaigns,
  updateCampaign,
  deleteCampaign,
  addVariant,
  updateVariant,
  deleteVariant,
  assignLeadsToCampaign,
  getCampaignLeads,
  updateCampaignLeadStatus,
  removeCampaignLead,
  getCampaignMetrics,
};
