const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let db;

/**
 * Initialize the SQLite database.
 * Creates the data directory and runs schema.sql if tables don't exist.
 */
function initDatabase(dbPath) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run schema
  const schema = fs.readFileSync(
    path.join(__dirname, 'schema.sql'),
    'utf-8'
  );
  db.exec(schema);

  // Safe ALTER TABLE migrations for existing databases
  const migrations = [
    { column: 'lead_status', sql: "ALTER TABLE leads ADD COLUMN lead_status TEXT NOT NULL DEFAULT 'new'" },
    { column: 'appearance_count', sql: 'ALTER TABLE leads ADD COLUMN appearance_count INTEGER DEFAULT 1' },
    { column: 'apollo_sequence_id', sql: 'ALTER TABLE leads ADD COLUMN apollo_sequence_id TEXT' },
    { column: 'apollo_sequenced_at', sql: 'ALTER TABLE leads ADD COLUMN apollo_sequenced_at TEXT' },
    { column: 'phone', sql: 'ALTER TABLE leads ADD COLUMN phone TEXT' },
    { column: 'engagement_type', sql: "ALTER TABLE leads ADD COLUMN engagement_type TEXT NOT NULL DEFAULT 'comment'" },
  ];

  const existingColumns = db.prepare("PRAGMA table_info('leads')").all().map((c) => c.name);
  for (const { column, sql } of migrations) {
    if (!existingColumns.includes(column)) {
      db.exec(sql);
      console.log(`[DB] Migration: added column '${column}' to leads table`);
    }
  }

  return db;
}

/**
 * Get the database instance.
 */
function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

// ─── Scanned Posts ───────────────────────────────────────────────────────────

function insertScannedPost({ postUrl, commenterCount, enrichedCount }) {
  const stmt = getDb().prepare(`
    INSERT INTO scanned_posts (post_url, scanned_at, commenter_count, enriched_count)
    VALUES (?, datetime('now'), ?, ?)
    ON CONFLICT(post_url) DO UPDATE SET
      scanned_at = datetime('now'),
      commenter_count = excluded.commenter_count,
      enriched_count = excluded.enriched_count
  `);
  return stmt.run(postUrl, commenterCount, enrichedCount);
}

function getAllScannedPosts() {
  const stmt = getDb().prepare('SELECT * FROM scanned_posts ORDER BY scanned_at DESC');
  return stmt.all();
}

// ─── Leads ───────────────────────────────────────────────────────────────────

function upsertLead(lead) {
  const stmt = getDb().prepare(`
    INSERT INTO leads (
      post_url, linkedin_url, name, first_name, last_name, title, company,
      company_domain, email, headcount_range, estimated_revenue, industry, funding_stage,
      comment_text, comment_date, intent_tier, intent_score, intent_reasoning,
      intent_signals, icp_score, total_score, data_confidence,
      outreach_draft_direct, outreach_draft_topic, outreach_draft_pain,
      outreach_draft_campaign, hubspot_contact_id, hubspot_pushed_at,
      appearance_count, apollo_sequence_id, apollo_sequenced_at, engagement_type
    ) VALUES (
      @post_url, @linkedin_url, @name, @first_name, @last_name, @title, @company,
      @company_domain, @email, @headcount_range, @estimated_revenue, @industry, @funding_stage,
      @comment_text, @comment_date, @intent_tier, @intent_score, @intent_reasoning,
      @intent_signals, @icp_score, @total_score, @data_confidence,
      @outreach_draft_direct, @outreach_draft_topic, @outreach_draft_pain,
      @outreach_draft_campaign, @hubspot_contact_id, @hubspot_pushed_at,
      @appearance_count, @apollo_sequence_id, @apollo_sequenced_at, @engagement_type
    )
    ON CONFLICT(linkedin_url) DO UPDATE SET
      post_url = excluded.post_url,
      name = excluded.name,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      title = COALESCE(excluded.title, leads.title),
      company = COALESCE(excluded.company, leads.company),
      company_domain = COALESCE(excluded.company_domain, leads.company_domain),
      email = COALESCE(excluded.email, leads.email),
      headcount_range = COALESCE(excluded.headcount_range, leads.headcount_range),
      estimated_revenue = COALESCE(excluded.estimated_revenue, leads.estimated_revenue),
      industry = COALESCE(excluded.industry, leads.industry),
      funding_stage = COALESCE(excluded.funding_stage, leads.funding_stage),
      comment_text = COALESCE(excluded.comment_text, leads.comment_text),
      comment_date = COALESCE(excluded.comment_date, leads.comment_date),
      intent_tier = COALESCE(excluded.intent_tier, leads.intent_tier),
      intent_score = COALESCE(excluded.intent_score, leads.intent_score),
      intent_reasoning = COALESCE(excluded.intent_reasoning, leads.intent_reasoning),
      intent_signals = COALESCE(excluded.intent_signals, leads.intent_signals),
      icp_score = COALESCE(excluded.icp_score, leads.icp_score),
      total_score = COALESCE(excluded.total_score, leads.total_score),
      data_confidence = COALESCE(excluded.data_confidence, leads.data_confidence),
      outreach_draft_direct = COALESCE(excluded.outreach_draft_direct, leads.outreach_draft_direct),
      outreach_draft_topic = COALESCE(excluded.outreach_draft_topic, leads.outreach_draft_topic),
      outreach_draft_pain = COALESCE(excluded.outreach_draft_pain, leads.outreach_draft_pain),
      outreach_draft_campaign = COALESCE(excluded.outreach_draft_campaign, leads.outreach_draft_campaign),
      hubspot_contact_id = COALESCE(excluded.hubspot_contact_id, leads.hubspot_contact_id),
      hubspot_pushed_at = COALESCE(excluded.hubspot_pushed_at, leads.hubspot_pushed_at),
      appearance_count = COALESCE(excluded.appearance_count, leads.appearance_count),
      apollo_sequence_id = COALESCE(excluded.apollo_sequence_id, leads.apollo_sequence_id),
      apollo_sequenced_at = COALESCE(excluded.apollo_sequenced_at, leads.apollo_sequenced_at),
      engagement_type = CASE WHEN leads.engagement_type = 'comment' THEN 'comment' ELSE excluded.engagement_type END
  `);

  return stmt.run({
    post_url: lead.postUrl || lead.post_url,
    linkedin_url: lead.linkedinUrl || lead.linkedin_url,
    name: lead.name || null,
    first_name: lead.firstName || lead.first_name || null,
    last_name: lead.lastName || lead.last_name || null,
    title: lead.title || null,
    company: lead.company || null,
    company_domain: lead.companyDomain || lead.company_domain || null,
    email: lead.email || null,
    headcount_range: lead.headcountRange || lead.headcount_range || null,
    estimated_revenue: lead.estimatedRevenue || lead.estimated_revenue || null,
    industry: lead.industry || null,
    funding_stage: lead.fundingStage || lead.funding_stage || null,
    comment_text: lead.commentText || lead.comment_text || null,
    comment_date: lead.commentDate || lead.comment_date || null,
    intent_tier: lead.intentTier || lead.intent_tier || null,
    intent_score: lead.intentScore != null ? lead.intentScore : (lead.intent_score != null ? lead.intent_score : null),
    intent_reasoning: lead.intentReasoning || lead.intent_reasoning || null,
    intent_signals: lead.intentSignals || lead.intent_signals || null,
    icp_score: lead.icpScore != null ? lead.icpScore : (lead.icp_score != null ? lead.icp_score : null),
    total_score: lead.totalScore != null ? lead.totalScore : (lead.total_score != null ? lead.total_score : null),
    data_confidence: lead.dataConfidence || lead.data_confidence || null,
    outreach_draft_direct: lead.outreachDraftDirect || lead.outreach_draft_direct || null,
    outreach_draft_topic: lead.outreachDraftTopic || lead.outreach_draft_topic || null,
    outreach_draft_pain: lead.outreachDraftPain || lead.outreach_draft_pain || null,
    outreach_draft_campaign: lead.outreachDraftCampaign || lead.outreach_draft_campaign || null,
    hubspot_contact_id: lead.hubspotContactId || lead.hubspot_contact_id || null,
    hubspot_pushed_at: lead.hubspotPushedAt || lead.hubspot_pushed_at || null,
    appearance_count: lead.appearanceCount || lead.appearance_count || 1,
    apollo_sequence_id: lead.apolloSequenceId || lead.apollo_sequence_id || null,
    apollo_sequenced_at: lead.apolloSequencedAt || lead.apollo_sequenced_at || null,
    engagement_type: lead.engagementType || lead.engagement_type || 'comment',
  });
}

function getLeadsByPostUrl(postUrl, { minScore = 0, sortBy = 'total_score', status } = {}) {
  const validSortColumns = ['total_score', 'intent_score', 'icp_score', 'name', 'company', 'created_at', 'appearance_count'];
  const sort = validSortColumns.includes(sortBy) ? sortBy : 'total_score';

  let sql = `SELECT * FROM leads WHERE post_url = ? AND (total_score >= ? OR total_score IS NULL)`;
  const params = [postUrl, minScore];

  if (status) {
    sql += ` AND COALESCE(lead_status, 'new') = ?`;
    params.push(status);
  }

  sql += ` ORDER BY ${sort} DESC`;

  const stmt = getDb().prepare(sql);
  return stmt.all(...params);
}

function getLeadById(id) {
  const stmt = getDb().prepare('SELECT * FROM leads WHERE id = ?');
  return stmt.get(id);
}

function getLeadByLinkedinUrl(linkedinUrl) {
  const stmt = getDb().prepare('SELECT * FROM leads WHERE linkedin_url = ?');
  return stmt.get(linkedinUrl);
}

function updateLeadDraft(id, mode, content) {
  const columnMap = {
    direct: 'outreach_draft_direct',
    topic: 'outreach_draft_topic',
    pain: 'outreach_draft_pain',
    campaign: 'outreach_draft_campaign',
  };
  const column = columnMap[mode];
  if (!column) throw new Error(`Invalid draft mode: ${mode}`);

  const stmt = getDb().prepare(`UPDATE leads SET ${column} = ? WHERE id = ?`);
  return stmt.run(content, id);
}

function updateLeadHubspot(id, hubspotContactId) {
  const stmt = getDb().prepare(`
    UPDATE leads SET hubspot_contact_id = ?, hubspot_pushed_at = datetime('now') WHERE id = ?
  `);
  return stmt.run(hubspotContactId, id);
}

function updateLeadApolloSequence(id, sequenceId) {
  const stmt = getDb().prepare(`
    UPDATE leads SET apollo_sequence_id = ?, apollo_sequenced_at = datetime('now') WHERE id = ?
  `);
  return stmt.run(sequenceId, id);
}

function getLeadsForExport(postUrl) {
  const stmt = getDb().prepare(`
    SELECT l.*, sp.scanned_at
    FROM leads l
    LEFT JOIN scanned_posts sp ON l.post_url = sp.post_url
    WHERE l.post_url = ?
    ORDER BY l.total_score DESC
  `);
  return stmt.all(postUrl);
}

// ─── Monitored Accounts ─────────────────────────────────────────────────────

function getAllMonitoredAccounts() {
  const stmt = getDb().prepare('SELECT * FROM monitored_accounts ORDER BY id DESC');
  return stmt.all();
}

function getActiveMonitoredAccounts() {
  const stmt = getDb().prepare('SELECT * FROM monitored_accounts WHERE active = 1');
  return stmt.all();
}

function insertMonitoredAccount({ linkedinProfileUrl, label, checkFrequencyHours }) {
  const stmt = getDb().prepare(`
    INSERT INTO monitored_accounts (linkedin_profile_url, label, check_frequency_hours)
    VALUES (?, ?, ?)
  `);
  return stmt.run(linkedinProfileUrl, label || null, checkFrequencyHours || 6);
}

function deleteMonitoredAccount(id) {
  const stmt = getDb().prepare('DELETE FROM monitored_accounts WHERE id = ?');
  return stmt.run(id);
}

function updateMonitoredAccountLastCheck(id, lastPostId) {
  const stmt = getDb().prepare(`
    UPDATE monitored_accounts
    SET last_checked_at = datetime('now'), last_post_id = ?
    WHERE id = ?
  `);
  return stmt.run(lastPostId, id);
}

module.exports = {
  initDatabase,
  getDb,
  // Scanned Posts
  insertScannedPost,
  getAllScannedPosts,
  // Leads
  upsertLead,
  getLeadsByPostUrl,
  getLeadById,
  getLeadByLinkedinUrl,
  updateLeadDraft,
  updateLeadHubspot,
  updateLeadApolloSequence,
  getLeadsForExport,
  // Monitored Accounts
  getAllMonitoredAccounts,
  getActiveMonitoredAccounts,
  insertMonitoredAccount,
  deleteMonitoredAccount,
  updateMonitoredAccountLastCheck,
};
