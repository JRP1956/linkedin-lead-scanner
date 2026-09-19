const { getDb } = require('./queries');

// ─── Campaign Analytics ─────────────────────────────────────────────────────

function getCampaignAnalytics() {
  return getDb().prepare(`
    SELECT
      c.id, c.name, c.status, c.created_at,
      COUNT(cl.id) as total_leads,
      SUM(CASE WHEN cl.status IN ('sent', 'replied', 'meeting_booked') THEN 1 ELSE 0 END) as sent,
      SUM(CASE WHEN cl.status = 'replied' THEN 1 ELSE 0 END) as replied,
      SUM(CASE WHEN cl.status = 'meeting_booked' THEN 1 ELSE 0 END) as meetings,
      CASE
        WHEN SUM(CASE WHEN cl.status IN ('sent', 'replied', 'meeting_booked') THEN 1 ELSE 0 END) > 0
        THEN ROUND(
          CAST(SUM(CASE WHEN cl.status = 'replied' THEN 1 ELSE 0 END) AS FLOAT) /
          SUM(CASE WHEN cl.status IN ('sent', 'replied', 'meeting_booked') THEN 1 ELSE 0 END) * 100, 1
        )
        ELSE 0
      END as reply_rate
    FROM campaigns c
    LEFT JOIN campaign_leads cl ON c.id = cl.campaign_id
    GROUP BY c.id
    ORDER BY c.created_at DESC
  `).all();
}

// ─── Signal Analytics ───────────────────────────────────────────────────────

function getSignalAnalytics() {
  return getDb().prepare(`
    SELECT
      ds.type,
      COUNT(ds.id) as total_signals,
      COUNT(DISTINCT ds.lead_id) as unique_leads,
      SUM(CASE WHEN l.lead_status = 'meeting_booked' THEN 1 ELSE 0 END) as meetings_from_signal,
      SUM(CASE WHEN l.lead_status = 'replied' THEN 1 ELSE 0 END) as replies_from_signal
    FROM detected_signals ds
    LEFT JOIN leads l ON ds.lead_id = l.id
    GROUP BY ds.type
    ORDER BY meetings_from_signal DESC
  `).all();
}

// ─── Reply Rate Analytics ───────────────────────────────────────────────────

function getReplyRateAnalytics() {
  // Reply rates by campaign
  const byCampaign = getDb().prepare(`
    SELECT
      c.id, c.name,
      COUNT(cl.id) as total,
      SUM(CASE WHEN cl.status IN ('sent', 'replied', 'meeting_booked') THEN 1 ELSE 0 END) as sent,
      SUM(CASE WHEN cl.status = 'replied' THEN 1 ELSE 0 END) as replied,
      CASE
        WHEN SUM(CASE WHEN cl.status IN ('sent', 'replied', 'meeting_booked') THEN 1 ELSE 0 END) > 0
        THEN ROUND(
          CAST(SUM(CASE WHEN cl.status = 'replied' THEN 1 ELSE 0 END) AS FLOAT) /
          SUM(CASE WHEN cl.status IN ('sent', 'replied', 'meeting_booked') THEN 1 ELSE 0 END) * 100, 1
        )
        ELSE 0
      END as reply_rate
    FROM campaigns c
    LEFT JOIN campaign_leads cl ON c.id = cl.campaign_id
    GROUP BY c.id
    HAVING sent > 0
    ORDER BY reply_rate DESC
  `).all();

  // Reply rates by intent tier
  const byIntentTier = getDb().prepare(`
    SELECT
      COALESCE(l.intent_tier, 'unknown') as intent_tier,
      COUNT(*) as total,
      SUM(CASE WHEN l.lead_status = 'replied' THEN 1 ELSE 0 END) as replied,
      CASE
        WHEN COUNT(*) > 0
        THEN ROUND(
          CAST(SUM(CASE WHEN l.lead_status = 'replied' THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) * 100, 1
        )
        ELSE 0
      END as reply_rate
    FROM leads l
    GROUP BY l.intent_tier
    ORDER BY reply_rate DESC
  `).all();

  return { byCampaign, byIntentTier };
}

// ─── Pipeline Analytics ─────────────────────────────────────────────────────

function getPipelineAnalytics() {
  const stages = getDb().prepare(`
    SELECT
      COALESCE(lead_status, 'new') as stage,
      COUNT(*) as count
    FROM leads
    GROUP BY lead_status
    ORDER BY
      CASE COALESCE(lead_status, 'new')
        WHEN 'new' THEN 1
        WHEN 'contacted' THEN 2
        WHEN 'replied' THEN 3
        WHEN 'meeting_booked' THEN 4
        WHEN 'converted' THEN 5
        WHEN 'dead' THEN 6
        ELSE 7
      END
  `).all();

  const totalLeads = stages.reduce((sum, s) => sum + s.count, 0);

  return {
    stages,
    totalLeads,
    conversionRate: totalLeads > 0
      ? ((stages.find(s => s.stage === 'converted')?.count || 0) / totalLeads * 100).toFixed(1)
      : '0.0',
  };
}

// ─── Dashboard Summary ──────────────────────────────────────────────────────

function getDashboardSummary() {
  const db = getDb();

  const totalLeads = db.prepare('SELECT COUNT(*) as count FROM leads').get().count;
  const totalCampaigns = db.prepare('SELECT COUNT(*) as count FROM campaigns').get().count;
  const activeCampaigns = db.prepare("SELECT COUNT(*) as count FROM campaigns WHERE status = 'active'").get().count;

  const recentSignals = db.prepare(
    "SELECT COUNT(*) as count FROM detected_signals WHERE detected_at >= datetime('now', '-7 days')"
  ).get().count;

  const meetingsBooked = db.prepare(
    "SELECT COUNT(*) as count FROM leads WHERE lead_status = 'meeting_booked'"
  ).get().count;

  const pipeline = getPipelineAnalytics();

  return {
    totalLeads,
    totalCampaigns,
    activeCampaigns,
    recentSignals,
    meetingsBooked,
    pipeline,
  };
}

// ─── Meeting Tracking ───────────────────────────────────────────────────────

module.exports = {
  getCampaignAnalytics,
  getSignalAnalytics,
  getReplyRateAnalytics,
  getPipelineAnalytics,
  getDashboardSummary,
};
