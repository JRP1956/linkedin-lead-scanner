require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

const { initDatabase } = require('./db/queries');
const queries = require('./db/queries');
const { runScan } = require('./jobs/scanJob');
const { startMonitorJob } = require('./jobs/monitorJob');
const { createOrUpdateContact, logCustomPropertyChecklist } = require('./integrations/hubspotClient');
const { getAvailableCampaigns } = require('./outreach/draftGenerator');
const suppressionQueries = require('./db/suppressionQueries');
const statusQueries = require('./db/statusQueries');
const signalQueries = require('./db/signalQueries');
const { listSequences, addContactToSequence } = require('./integrations/apolloSequencer');

// ─── Error Constants ─────────────────────────────────────────────────────────

const INVALID_POST_URL = 'INVALID_POST_URL';

// ─── Validate Environment Variables ──────────────────────────────────────────

// Only Anthropic is strictly required to start the server
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('\n❌ Missing required environment variable: ANTHROPIC_API_KEY');
  console.error('   Get your key from https://console.anthropic.com\n');
  process.exit(1);
}

// Warn about optional keys — features will fail gracefully at runtime
if (!process.env.APOLLO_API_KEY) {
  console.warn('⚠️  APOLLO_API_KEY not set — lead enrichment will be skipped');
}
if (!process.env.HUBSPOT_ACCESS_TOKEN) {
  console.warn('⚠️  HUBSPOT_ACCESS_TOKEN not set — HubSpot push will be unavailable');
}

// ─── Validate ICP Config ─────────────────────────────────────────────────────

const icpPath = path.join(__dirname, '..', 'config', 'icp.yaml');
try {
  const icpRaw = fs.readFileSync(icpPath, 'utf-8');
  yaml.load(icpRaw);
  console.log('✅ ICP config loaded: config/icp.yaml');
} catch (err) {
  console.error(`\n❌ Failed to load ICP config at ${icpPath}:`);
  console.error(`   ${err.message}\n`);
  process.exit(1);
}

// ─── Initialize Database ─────────────────────────────────────────────────────

const dbPath = process.env.DB_PATH || './data/leads.db';
initDatabase(path.resolve(__dirname, '..', dbPath));
console.log(`✅ SQLite database initialized: ${dbPath}`);

// ─── Log HubSpot Custom Properties Checklist ─────────────────────────────────

logCustomPropertyChecklist();

// ─── Express App Setup ───────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

// ─── LinkedIn Post URL Validation ────────────────────────────────────────────

function isValidLinkedInPostUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      (parsed.hostname === 'www.linkedin.com' || parsed.hostname === 'linkedin.com') &&
      parsed.pathname.includes('/posts/')
    );
  } catch {
    return false;
  }
}

// ─── API Routes ──────────────────────────────────────────────────────────────

/**
 * POST /api/scan
 * Start a scan job. Returns an SSE stream of progress events.
 */
app.post('/api/scan', (req, res) => {
  const { postUrl, outreachMode, icpProfile } = req.body;

  if (!postUrl || !isValidLinkedInPostUrl(postUrl)) {
    return res.status(400).json({
      error: INVALID_POST_URL,
      message: 'Please provide a valid LinkedIn post URL (must contain linkedin.com/posts/)',
    });
  }

  // Set up SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const { emitter, promise } = runScan({
    postUrl,
    outreachMode: outreachMode || 'direct',
    icpProfileName: icpProfile || 'icp',
  });

  // Stream progress events to client
  emitter.on('progress', (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  // Handle completion
  promise
    .then(() => {
      res.write(`data: ${JSON.stringify({ step: 'done' })}\n\n`);
      res.end();
    })
    .catch((err) => {
      res.write(`data: ${JSON.stringify({ step: 'error', code: err.code || 'UNKNOWN', message: err.message })}\n\n`);
      res.end();
    });

  // Handle client disconnect
  req.on('close', () => {
    // Client disconnected — job continues in background
    console.log('[API] Client disconnected from SSE stream');
  });
});

/**
 * GET /api/leads
 * Get leads for a specific post URL with optional filtering and sorting.
 */
app.get('/api/leads', (req, res) => {
  const { postUrl, minScore, sortBy, status } = req.query;

  if (!postUrl) {
    return res.status(400).json({ error: 'MISSING_POST_URL', message: 'postUrl query parameter is required' });
  }

  const leads = queries.getLeadsByPostUrl(postUrl, {
    minScore: parseInt(minScore, 10) || 0,
    sortBy: sortBy || 'total_score',
    status: status || undefined,
  });

  res.json(leads);
});

/**
 * GET /api/leads/export-csv
 * Export leads as CSV file download.
 * (Must be defined before /api/leads/:id to avoid route conflict)
 */
app.get('/api/leads/export-csv', (req, res) => {
  const { postUrl } = req.query;

  if (!postUrl) {
    return res.status(400).json({ error: 'MISSING_POST_URL', message: 'postUrl query parameter is required' });
  }

  const leads = queries.getLeadsForExport(postUrl);

  const headers = [
    'rank', 'name', 'title', 'company', 'email', 'linkedin_url', 'total_score',
    'intent_tier', 'intent_score', 'icp_score', 'data_confidence', 'headcount_range',
    'estimated_revenue', 'industry', 'funding_stage', 'comment_text', 'comment_date',
    'outreach_draft_direct', 'outreach_draft_topic', 'outreach_draft_pain',
    'hubspot_pushed', 'lead_status', 'appearance_count', 'source_post_url', 'scanned_at',
  ];

  function escapeCSV(val) {
    if (val == null) return '""';
    const str = String(val);
    return `"${str.replace(/"/g, '""')}"`;
  }

  const rows = leads.map((lead, index) => [
    index + 1,
    escapeCSV(lead.name),
    escapeCSV(lead.title),
    escapeCSV(lead.company),
    escapeCSV(lead.email),
    escapeCSV(lead.linkedin_url),
    lead.total_score || 0,
    escapeCSV(lead.intent_tier),
    lead.intent_score || 0,
    lead.icp_score || 0,
    escapeCSV(lead.data_confidence),
    escapeCSV(lead.headcount_range),
    escapeCSV(lead.estimated_revenue),
    escapeCSV(lead.industry),
    escapeCSV(lead.funding_stage),
    escapeCSV(lead.comment_text),
    escapeCSV(lead.comment_date),
    escapeCSV(lead.outreach_draft_direct),
    escapeCSV(lead.outreach_draft_topic),
    escapeCSV(lead.outreach_draft_pain),
    escapeCSV(lead.hubspot_pushed_at ? 'Yes' : 'No'),
    escapeCSV(lead.lead_status || 'new'),
    lead.appearance_count || 1,
    escapeCSV(lead.post_url),
    escapeCSV(lead.scanned_at),
  ].join(','));

  const csv = [headers.join(','), ...rows].join('\n');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="leads-${timestamp}.csv"`);
  res.send(csv);
});

/**
 * GET /api/leads/multi-signal
 * Get leads that appeared in multiple posts.
 * (Must be defined before /api/leads/:id to avoid route conflict)
 */
app.get('/api/leads/multi-signal', (req, res) => {
  const minAppearances = parseInt(req.query.min, 10) || 2;
  const leads = signalQueries.getMultiSignalLeads(minAppearances);
  res.json(leads);
});

/**
 * GET /api/leads/:id
 * Get a single lead by ID.
 */
app.get('/api/leads/:id', (req, res) => {
  const lead = queries.getLeadById(parseInt(req.params.id, 10));
  if (!lead) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Lead not found' });
  }
  res.json(lead);
});

/**
 * PATCH /api/leads/:id/draft
 * Update the outreach draft for a specific mode.
 */
app.patch('/api/leads/:id/draft', (req, res) => {
  const { mode, content } = req.body;

  if (!mode || !['direct', 'topic', 'pain', 'campaign'].includes(mode)) {
    return res.status(400).json({ error: 'INVALID_MODE', message: 'Mode must be one of: direct, topic, pain, campaign' });
  }

  try {
    queries.updateLeadDraft(parseInt(req.params.id, 10), mode, content);
    const lead = queries.getLeadById(parseInt(req.params.id, 10));
    res.json(lead);
  } catch (err) {
    res.status(500).json({ error: 'UPDATE_FAILED', message: err.message });
  }
});

/**
 * POST /api/leads/:id/push-hubspot
 * Push a single lead to HubSpot.
 */
app.post('/api/leads/:id/push-hubspot', async (req, res) => {
  try {
    const lead = queries.getLeadById(parseInt(req.params.id, 10));
    if (!lead) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Lead not found' });
    }

    const hubspotContactId = await createOrUpdateContact(lead);
    queries.updateLeadHubspot(lead.id, hubspotContactId);

    res.json({ hubspotContactId, success: true });
  } catch (err) {
    res.status(err.code === 'HUBSPOT_AUTH_FAILED' ? 401 : 500).json({
      error: err.code || 'HUBSPOT_ERROR',
      message: err.message,
      success: false,
    });
  }
});

/**
 * POST /api/leads/push-hubspot-batch
 * Push multiple leads to HubSpot.
 */
app.post('/api/leads/push-hubspot-batch', async (req, res) => {
  const { leadIds, minScore } = req.body;

  let leadsToProcess = [];

  if (leadIds && Array.isArray(leadIds)) {
    leadsToProcess = leadIds.map((id) => queries.getLeadById(id)).filter(Boolean);
  } else if (minScore != null) {
    // Push all leads above minScore from all posts
    const posts = queries.getAllScannedPosts();
    for (const post of posts) {
      const leads = queries.getLeadsByPostUrl(post.post_url, { minScore });
      leadsToProcess.push(...leads);
    }
  }

  let pushed = 0;
  let failed = 0;
  const errors = [];

  for (const lead of leadsToProcess) {
    try {
      const hubspotContactId = await createOrUpdateContact(lead);
      queries.updateLeadHubspot(lead.id, hubspotContactId);
      pushed++;
    } catch (err) {
      failed++;
      errors.push({ leadId: lead.id, name: lead.name, error: err.message });
    }
  }

  res.json({ pushed, failed, errors });
});

// (export-csv and multi-signal moved above /api/leads/:id for correct route matching)

/**
 * GET /api/monitor
 * Get all monitored accounts.
 */
app.get('/api/monitor', (req, res) => {
  const accounts = queries.getAllMonitoredAccounts();
  res.json(accounts);
});

/**
 * POST /api/monitor
 * Add a new account to monitor.
 */
app.post('/api/monitor', (req, res) => {
  const { linkedinProfileUrl, label, checkFrequencyHours } = req.body;

  if (!linkedinProfileUrl) {
    return res.status(400).json({ error: 'MISSING_URL', message: 'LinkedIn profile URL is required' });
  }

  try {
    const result = queries.insertMonitoredAccount({
      linkedinProfileUrl,
      label,
      checkFrequencyHours: parseInt(checkFrequencyHours, 10) || 6,
    });
    res.json({ id: result.lastInsertRowid, success: true });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'DUPLICATE', message: 'This account is already being monitored' });
    }
    res.status(500).json({ error: 'INSERT_FAILED', message: err.message });
  }
});

/**
 * DELETE /api/monitor/:id
 * Remove a monitored account.
 */
app.delete('/api/monitor/:id', (req, res) => {
  queries.deleteMonitoredAccount(parseInt(req.params.id, 10));
  res.json({ success: true });
});

/**
 * GET /api/icp-profiles
 * Get list of available ICP profile names.
 */
app.get('/api/icp-profiles', (req, res) => {
  const configDir = path.join(__dirname, '..', 'config');
  try {
    const files = fs.readdirSync(configDir)
      .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
      .map((f) => f.replace(/\.(yaml|yml)$/, ''));
    res.json(files);
  } catch {
    res.json(['icp']);
  }
});

/**
 * GET /api/campaigns
 * Get list of available campaign names.
 */
app.get('/api/campaigns', (req, res) => {
  res.json(getAvailableCampaigns());
});

// ─── Suppression List Routes ─────────────────────────────────────────────────

/**
 * GET /api/suppression
 * Get all suppressed leads with optional filtering.
 */
app.get('/api/suppression', (req, res) => {
  const { reason, search } = req.query;
  const items = suppressionQueries.getAllSuppressed({ reason, search });
  res.json(items);
});

/**
 * GET /api/suppression/count
 * Get total suppressed count.
 */
app.get('/api/suppression/count', (req, res) => {
  res.json({ count: suppressionQueries.getSuppressionCount() });
});

/**
 * POST /api/suppression
 * Add a single entry to the suppression list.
 */
app.post('/api/suppression', (req, res) => {
  const { linkedinUrl, name, reason } = req.body;

  if (!linkedinUrl) {
    return res.status(400).json({ error: 'MISSING_URL', message: 'linkedinUrl is required' });
  }

  try {
    suppressionQueries.addToSuppressionList({
      linkedinUrl,
      name,
      reason: reason || 'manual_exclude',
      source: 'manual',
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'INSERT_FAILED', message: err.message });
  }
});

/**
 * POST /api/suppression/bulk
 * Bulk import entries to the suppression list.
 */
app.post('/api/suppression/bulk', (req, res) => {
  const { entries } = req.body;

  if (!entries || !Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: 'INVALID_ENTRIES', message: 'entries must be a non-empty array of { linkedinUrl, name? }' });
  }

  const result = suppressionQueries.bulkAddToSuppressionList(entries);
  res.json(result);
});

/**
 * DELETE /api/suppression/:id
 * Remove an entry from the suppression list.
 */
app.delete('/api/suppression/:id', (req, res) => {
  suppressionQueries.removeFromSuppressionList(parseInt(req.params.id, 10));
  res.json({ success: true });
});

// ─── Lead Status Routes ──────────────────────────────────────────────────────

/**
 * PATCH /api/leads/:id/status
 * Update a lead's status.
 */
app.patch('/api/leads/:id/status', (req, res) => {
  const { status } = req.body;

  try {
    const lead = statusQueries.updateLeadStatus(parseInt(req.params.id, 10), status);
    res.json(lead);
  } catch (err) {
    res.status(400).json({ error: 'STATUS_UPDATE_FAILED', message: err.message });
  }
});

/**
 * POST /api/leads/batch-status
 * Batch update status for multiple leads.
 */
app.post('/api/leads/batch-status', (req, res) => {
  const { leadIds, status } = req.body;

  if (!leadIds || !Array.isArray(leadIds)) {
    return res.status(400).json({ error: 'INVALID_LEAD_IDS', message: 'leadIds must be an array' });
  }

  try {
    const result = statusQueries.batchUpdateStatus(leadIds, status);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: 'BATCH_STATUS_FAILED', message: err.message });
  }
});

/**
 * GET /api/leads/:id/history
 * Get status change history for a lead.
 */
app.get('/api/leads/:id/history', (req, res) => {
  const history = statusQueries.getLeadStatusHistory(parseInt(req.params.id, 10));
  res.json(history);
});

/**
 * GET /api/stats/funnel
 * Get conversion funnel stats.
 */
app.get('/api/stats/funnel', (req, res) => {
  const funnel = statusQueries.getStatusFunnel();
  res.json(funnel);
});

// ─── Signal Stacking Routes ──────────────────────────────────────────────────

/**
 * GET /api/leads/:id/appearances
 * Get appearance history for a lead.
 */
app.get('/api/leads/:id/appearances', (req, res) => {
  const lead = queries.getLeadById(parseInt(req.params.id, 10));
  if (!lead) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Lead not found' });
  }
  const appearances = signalQueries.getAppearanceHistory(lead.linkedin_url);
  res.json(appearances);
});

// (multi-signal moved above /api/leads/:id for correct route matching)

// ─── Apollo Sequence Routes ──────────────────────────────────────────────────

/**
 * GET /api/apollo/sequences
 * List available Apollo email sequences.
 */
app.get('/api/apollo/sequences', async (req, res) => {
  try {
    const sequences = await listSequences();
    res.json(sequences);
  } catch (err) {
    res.status(err.code === 'APOLLO_SEQUENCE_AUTH_FAILED' ? 401 : 500).json({
      error: err.code || 'APOLLO_ERROR',
      message: err.message,
    });
  }
});

/**
 * POST /api/leads/:id/push-apollo
 * Push a single lead to an Apollo email sequence.
 */
app.post('/api/leads/:id/push-apollo', async (req, res) => {
  const { sequenceId } = req.body;

  try {
    const lead = queries.getLeadById(parseInt(req.params.id, 10));
    if (!lead) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Lead not found' });
    }

    if (!lead.email) {
      return res.status(400).json({ error: 'NO_EMAIL', message: 'Lead has no email address' });
    }

    const targetSequence = sequenceId || process.env.APOLLO_SEQUENCE_DEFAULT_ID;
    if (!targetSequence) {
      return res.status(400).json({ error: 'NO_SEQUENCE', message: 'No sequence ID provided and APOLLO_SEQUENCE_DEFAULT_ID not set' });
    }

    await addContactToSequence({
      email: lead.email,
      firstName: lead.first_name,
      lastName: lead.last_name,
      sequenceId: targetSequence,
    });

    queries.updateLeadApolloSequence(lead.id, targetSequence);

    // Also add to suppression list
    suppressionQueries.addToSuppressionList({
      linkedinUrl: lead.linkedin_url,
      name: lead.name,
      reason: 'in_pipeline',
      source: 'apollo_sequence',
    });

    res.json({ success: true, sequenceId: targetSequence });
  } catch (err) {
    res.status(err.code === 'APOLLO_SEQUENCE_AUTH_FAILED' ? 401 : 500).json({
      error: err.code || 'APOLLO_ERROR',
      message: err.message,
      success: false,
    });
  }
});

/**
 * POST /api/leads/push-apollo-batch
 * Push multiple leads to an Apollo email sequence.
 */
app.post('/api/leads/push-apollo-batch', async (req, res) => {
  const { leadIds, sequenceId } = req.body;

  const targetSequence = sequenceId || process.env.APOLLO_SEQUENCE_DEFAULT_ID;
  if (!targetSequence) {
    return res.status(400).json({ error: 'NO_SEQUENCE', message: 'No sequence ID provided and APOLLO_SEQUENCE_DEFAULT_ID not set' });
  }

  if (!leadIds || !Array.isArray(leadIds)) {
    return res.status(400).json({ error: 'INVALID_LEAD_IDS', message: 'leadIds must be an array' });
  }

  let pushed = 0;
  let failed = 0;
  const errors = [];

  for (const id of leadIds) {
    const lead = queries.getLeadById(id);
    if (!lead || !lead.email) {
      failed++;
      errors.push({ leadId: id, error: 'No email address' });
      continue;
    }

    try {
      await addContactToSequence({
        email: lead.email,
        firstName: lead.first_name,
        lastName: lead.last_name,
        sequenceId: targetSequence,
      });
      queries.updateLeadApolloSequence(lead.id, targetSequence);
      suppressionQueries.addToSuppressionList({
        linkedinUrl: lead.linkedin_url,
        name: lead.name,
        reason: 'in_pipeline',
        source: 'apollo_sequence',
      });
      pushed++;
    } catch (err) {
      failed++;
      errors.push({ leadId: id, name: lead.name, error: err.message });
    }
  }

  res.json({ pushed, failed, errors });
});

// ─── Global Error Handler ────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('[API Error]', err);
  res.status(500).json({
    error: err.code || 'INTERNAL_ERROR',
    message: err.message || 'An unexpected error occurred',
  });
});

// ─── Start Server ────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT, 10) || 3001;

// Start the monitor cron job
startMonitorJob();

app.listen(PORT, () => {
  console.log(`\n🚀 LinkedIn Lead Scanner running on http://localhost:${PORT}\n`);
});

module.exports = app;
