require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');
const multer = require('multer');

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
const campaignQueries = require('./db/campaignQueries');
const webhookQueries = require('./db/webhookQueries');
const icpQueries = require('./db/icpQueries');
const { dispatchEvent } = require('./integrations/webhookDispatcher');
const { generateICP } = require('./ai/icpGenerator');
const { importCSV } = require('./import/csvImporter');

// Multer config for CSV upload
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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
  try {
    const dbCampaigns = campaignQueries.getAllCampaigns();
    if (dbCampaigns.length > 0) {
      return res.json(dbCampaigns);
    }
    // Fallback to file-based campaigns if no DB campaigns exist
    res.json(getAvailableCampaigns());
  } catch {
    res.json(getAvailableCampaigns());
  }
});

/**
 * POST /api/campaigns
 * Create a new campaign.
 */
app.post('/api/campaigns', (req, res) => {
  const { name, status, icpProfileId, description } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'MISSING_NAME', message: 'Campaign name is required' });
  }
  try {
    const campaign = campaignQueries.createCampaign({ name, status, icpProfileId, description });
    dispatchEvent('campaign.created', campaign);
    res.json(campaign);
  } catch (err) {
    res.status(500).json({ error: 'CREATE_FAILED', message: err.message });
  }
});

/**
 * GET /api/campaigns/:id
 * Get a single campaign with metrics.
 */
app.get('/api/campaigns/:id', (req, res) => {
  const campaign = campaignQueries.getCampaignById(parseInt(req.params.id, 10));
  if (!campaign) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Campaign not found' });
  }
  campaign.metrics = campaignQueries.getCampaignMetrics(campaign.id);
  res.json(campaign);
});

/**
 * PATCH /api/campaigns/:id
 * Update a campaign.
 */
app.patch('/api/campaigns/:id', (req, res) => {
  try {
    const campaign = campaignQueries.updateCampaign(parseInt(req.params.id, 10), req.body);
    if (!campaign) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Campaign not found' });
    }
    res.json(campaign);
  } catch (err) {
    res.status(500).json({ error: 'UPDATE_FAILED', message: err.message });
  }
});

/**
 * DELETE /api/campaigns/:id
 * Delete a campaign.
 */
app.delete('/api/campaigns/:id', (req, res) => {
  campaignQueries.deleteCampaign(parseInt(req.params.id, 10));
  res.json({ success: true });
});

/**
 * POST /api/campaigns/:id/variants
 * Add a variant to a campaign.
 */
app.post('/api/campaigns/:id/variants', (req, res) => {
  const { name, messageTemplate, isControl } = req.body;
  try {
    const variant = campaignQueries.addVariant({
      campaignId: parseInt(req.params.id, 10),
      name,
      messageTemplate,
      isControl,
    });
    res.json(variant);
  } catch (err) {
    res.status(500).json({ error: 'CREATE_FAILED', message: err.message });
  }
});

/**
 * POST /api/campaigns/:id/leads
 * Assign leads to a campaign.
 */
app.post('/api/campaigns/:id/leads', (req, res) => {
  const { leadIds, variantId } = req.body;
  if (!leadIds || !Array.isArray(leadIds)) {
    return res.status(400).json({ error: 'INVALID_LEAD_IDS', message: 'leadIds must be an array' });
  }
  try {
    const assigned = campaignQueries.assignLeadsToCampaign(
      parseInt(req.params.id, 10),
      leadIds,
      variantId
    );
    res.json({ assigned, success: true });
  } catch (err) {
    res.status(500).json({ error: 'ASSIGN_FAILED', message: err.message });
  }
});

/**
 * GET /api/campaigns/:id/leads
 * Get leads assigned to a campaign.
 */
app.get('/api/campaigns/:id/leads', (req, res) => {
  const leads = campaignQueries.getCampaignLeads(
    parseInt(req.params.id, 10),
    { status: req.query.status }
  );
  res.json(leads);
});

/**
 * GET /api/campaigns/:id/metrics
 * Get metrics for a campaign.
 */
app.get('/api/campaigns/:id/metrics', (req, res) => {
  const metrics = campaignQueries.getCampaignMetrics(parseInt(req.params.id, 10));
  res.json(metrics);
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

// ─── ICP Profile Routes ─────────────────────────────────────────────────────

/**
 * POST /api/icp
 * Create a new ICP profile in the database.
 */
app.post('/api/icp', (req, res) => {
  const { name, config } = req.body;
  if (!name || !config) {
    return res.status(400).json({ error: 'MISSING_FIELDS', message: 'name and config are required' });
  }
  try {
    const profile = icpQueries.createICPProfile({ name, config });
    res.json(profile);
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'DUPLICATE', message: 'An ICP profile with this name already exists' });
    }
    res.status(500).json({ error: 'CREATE_FAILED', message: err.message });
  }
});

/**
 * GET /api/icp
 * Get all ICP profiles (DB + YAML).
 */
app.get('/api/icp', (req, res) => {
  try {
    const dbProfiles = icpQueries.getAllICPProfiles();
    res.json(dbProfiles);
  } catch (err) {
    res.status(500).json({ error: 'FETCH_FAILED', message: err.message });
  }
});

/**
 * GET /api/icp/:id
 * Get a single ICP profile.
 */
app.get('/api/icp/:id', (req, res) => {
  const profile = icpQueries.getICPProfileById(parseInt(req.params.id, 10));
  if (!profile) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'ICP profile not found' });
  }
  res.json(profile);
});

/**
 * PUT /api/icp/:id
 * Update an ICP profile.
 */
app.put('/api/icp/:id', (req, res) => {
  const { name, config } = req.body;
  try {
    const profile = icpQueries.updateICPProfile(parseInt(req.params.id, 10), { name, config });
    if (!profile) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'ICP profile not found' });
    }
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: 'UPDATE_FAILED', message: err.message });
  }
});

/**
 * DELETE /api/icp/:id
 * Delete an ICP profile.
 */
app.delete('/api/icp/:id', (req, res) => {
  icpQueries.deleteICPProfile(parseInt(req.params.id, 10));
  res.json({ success: true });
});

/**
 * POST /api/icp/generate
 * Generate an ICP profile using AI.
 */
app.post('/api/icp/generate', async (req, res) => {
  const { productDescription, targetMarket, existingCustomers } = req.body;
  if (!productDescription) {
    return res.status(400).json({ error: 'MISSING_DESCRIPTION', message: 'productDescription is required' });
  }
  try {
    const result = await generateICP({ productDescription, targetMarket, existingCustomers });
    if (!result.success) {
      return res.status(500).json({ error: 'GENERATION_FAILED', message: result.error });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'GENERATION_FAILED', message: err.message });
  }
});

// ─── CSV Import Route ───────────────────────────────────────────────────────

/**
 * POST /api/leads/import-csv
 * Import leads from a CSV file upload.
 */
app.post('/api/leads/import-csv', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'NO_FILE', message: 'CSV file is required' });
  }

  try {
    const csvContent = req.file.buffer.toString('utf-8');
    const columnMap = req.body.columnMap ? JSON.parse(req.body.columnMap) : {};
    const postUrl = req.body.postUrl || `csv-import-${Date.now()}`;

    const result = importCSV(csvContent, { columnMap, postUrl });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'IMPORT_FAILED', message: err.message });
  }
});

// ─── Webhook Routes ─────────────────────────────────────────────────────────

/**
 * GET /api/webhooks
 * List all webhooks.
 */
app.get('/api/webhooks', (req, res) => {
  res.json(webhookQueries.getAllWebhooks());
});

/**
 * POST /api/webhooks
 * Create a new webhook.
 */
app.post('/api/webhooks', (req, res) => {
  const { url, eventTypes, secret } = req.body;
  if (!url || !eventTypes) {
    return res.status(400).json({ error: 'MISSING_FIELDS', message: 'url and eventTypes are required' });
  }
  try {
    const webhook = webhookQueries.createWebhook({ url, eventTypes, secret });
    res.json(webhook);
  } catch (err) {
    res.status(500).json({ error: 'CREATE_FAILED', message: err.message });
  }
});

/**
 * DELETE /api/webhooks/:id
 * Delete a webhook.
 */
app.delete('/api/webhooks/:id', (req, res) => {
  webhookQueries.deleteWebhook(parseInt(req.params.id, 10));
  res.json({ success: true });
});

// ─── Sender Routes (D3) ─────────────────────────────────────────────────────

const senderQueries = require('./db/senderQueries');

app.get('/api/senders', (req, res) => {
  res.json(senderQueries.getAllSenders());
});

app.post('/api/senders', (req, res) => {
  const { name, email, browserProfilePath, dailyLimit } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'MISSING_NAME', message: 'Sender name is required' });
  }
  try {
    const sender = senderQueries.createSender({ name, email, browserProfilePath, dailyLimit });
    res.json(sender);
  } catch (err) {
    res.status(500).json({ error: 'CREATE_FAILED', message: err.message });
  }
});

app.patch('/api/senders/:id', (req, res) => {
  try {
    const sender = senderQueries.updateSender(parseInt(req.params.id, 10), req.body);
    res.json(sender);
  } catch (err) {
    res.status(500).json({ error: 'UPDATE_FAILED', message: err.message });
  }
});

app.delete('/api/senders/:id', (req, res) => {
  senderQueries.deleteSender(parseInt(req.params.id, 10));
  res.json({ success: true });
});

// ─── Sequence Routes (D2) ───────────────────────────────────────────────────

const { initializeSequence, getSequenceSteps, scheduleSequenceForLeads } = require('./outreach/sequenceEngine');

app.post('/api/campaigns/:id/sequence', (req, res) => {
  const { steps } = req.body;
  try {
    const sequence = initializeSequence(parseInt(req.params.id, 10), steps);
    res.json(sequence);
  } catch (err) {
    res.status(500).json({ error: 'INIT_FAILED', message: err.message });
  }
});

app.get('/api/campaigns/:id/sequence', (req, res) => {
  const steps = getSequenceSteps(parseInt(req.params.id, 10));
  res.json(steps);
});

app.post('/api/campaigns/:id/sequence/schedule', (req, res) => {
  const { leadIds } = req.body;
  if (!leadIds || !Array.isArray(leadIds)) {
    return res.status(400).json({ error: 'INVALID_LEAD_IDS', message: 'leadIds must be an array' });
  }
  try {
    scheduleSequenceForLeads(parseInt(req.params.id, 10), leadIds);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'SCHEDULE_FAILED', message: err.message });
  }
});

// ─── Analytics Routes (F1, F2, F3) ──────────────────────────────────────────

const analyticsQueries = require('./db/analyticsQueries');

app.get('/api/analytics/dashboard', (req, res) => {
  try {
    res.json(analyticsQueries.getDashboardSummary());
  } catch (err) {
    res.status(500).json({ error: 'ANALYTICS_FAILED', message: err.message });
  }
});

app.get('/api/analytics/campaigns', (req, res) => {
  try {
    res.json(analyticsQueries.getCampaignAnalytics());
  } catch (err) {
    res.status(500).json({ error: 'ANALYTICS_FAILED', message: err.message });
  }
});

app.get('/api/analytics/signals', (req, res) => {
  try {
    res.json(analyticsQueries.getSignalAnalytics());
  } catch (err) {
    res.status(500).json({ error: 'ANALYTICS_FAILED', message: err.message });
  }
});

app.get('/api/analytics/reply-rates', (req, res) => {
  try {
    res.json(analyticsQueries.getReplyRateAnalytics());
  } catch (err) {
    res.status(500).json({ error: 'ANALYTICS_FAILED', message: err.message });
  }
});

app.get('/api/analytics/pipeline', (req, res) => {
  try {
    res.json(analyticsQueries.getPipelineAnalytics());
  } catch (err) {
    res.status(500).json({ error: 'ANALYTICS_FAILED', message: err.message });
  }
});

// ─── Meeting Routes (E5) ────────────────────────────────────────────────────

app.post('/api/meetings', (req, res) => {
  const { leadId, campaignId, signalType, notes } = req.body;
  if (!leadId) {
    return res.status(400).json({ error: 'MISSING_LEAD_ID', message: 'leadId is required' });
  }
  try {
    analyticsQueries.recordMeeting({ leadId, campaignId, signalType, notes });
    statusQueries.updateLeadStatus(leadId, 'meeting_booked');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'CREATE_FAILED', message: err.message });
  }
});

app.get('/api/meetings', (req, res) => {
  const { campaignId, limit } = req.query;
  res.json(analyticsQueries.getMeetings({ campaignId: campaignId ? parseInt(campaignId) : undefined, limit: limit ? parseInt(limit) : undefined }));
});

// ─── Signal Detection Routes ────────────────────────────────────────────────

const signalDetectionQueries = require('./db/signalDetectionQueries');

app.get('/api/signals', (req, res) => {
  const { type, limit } = req.query;
  if (type) {
    res.json(signalDetectionQueries.getSignalsByType(type, { limit: limit ? parseInt(limit) : 50 }));
  } else {
    res.json(signalDetectionQueries.getRecentSignals({ limit: limit ? parseInt(limit) : 100 }));
  }
});

app.get('/api/signals/stats', (req, res) => {
  res.json(signalDetectionQueries.getSignalStats());
});

app.get('/api/leads/:id/signals', (req, res) => {
  res.json(signalDetectionQueries.getSignalsByLead(parseInt(req.params.id, 10)));
});

// Keyword monitor CRUD
app.get('/api/keyword-monitors', (req, res) => {
  res.json(signalDetectionQueries.getAllKeywordMonitors());
});

app.post('/api/keyword-monitors', (req, res) => {
  const { keyword } = req.body;
  if (!keyword) {
    return res.status(400).json({ error: 'MISSING_KEYWORD', message: 'keyword is required' });
  }
  try {
    signalDetectionQueries.createKeywordMonitor(keyword);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'CREATE_FAILED', message: err.message });
  }
});

app.delete('/api/keyword-monitors/:id', (req, res) => {
  signalDetectionQueries.deleteKeywordMonitor(parseInt(req.params.id, 10));
  res.json({ success: true });
});

// ─── AI Tools Routes (H1, H2, H3) ──────────────────────────────────────────

const { analyzeMessage } = require('./ai/messageAnalyzer');
const { generateContent } = require('./ai/contentGenerator');

app.post('/api/tools/analyze-message', async (req, res) => {
  const { message, context } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'MISSING_MESSAGE', message: 'message is required' });
  }
  const result = await analyzeMessage({ message, context });
  res.json(result);
});

app.post('/api/tools/generate-content', async (req, res) => {
  const { topic, tone, audience, format } = req.body;
  if (!topic) {
    return res.status(400).json({ error: 'MISSING_TOPIC', message: 'topic is required' });
  }
  const result = await generateContent({ topic, tone, audience, format });
  res.json(result);
});

// ─── Pipedrive Routes (G2) ──────────────────────────────────────────────────

const { createOrUpdatePerson: pipedriveCreatePerson } = require('./integrations/pipedriveClient');

app.post('/api/leads/:id/push-pipedrive', async (req, res) => {
  try {
    const lead = queries.getLeadById(parseInt(req.params.id, 10));
    if (!lead) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Lead not found' });
    }

    const person = await pipedriveCreatePerson(lead);

    // Update lead with Pipedrive ID
    queries.getDb().prepare(
      "UPDATE leads SET pipedrive_person_id = ?, pipedrive_pushed_at = datetime('now') WHERE id = ?"
    ).run(String(person.id), lead.id);

    res.json({ pipedrivePersonId: person.id, success: true });
  } catch (err) {
    res.status(err.code === 'PIPEDRIVE_NOT_CONFIGURED' ? 400 : 500).json({
      error: err.code || 'PIPEDRIVE_ERROR',
      message: err.message,
      success: false,
    });
  }
});

app.post('/api/leads/push-pipedrive-batch', async (req, res) => {
  const { leadIds } = req.body;
  if (!leadIds || !Array.isArray(leadIds)) {
    return res.status(400).json({ error: 'INVALID_LEAD_IDS', message: 'leadIds must be an array' });
  }

  let pushed = 0;
  let failed = 0;
  const errors = [];

  for (const id of leadIds) {
    const lead = queries.getLeadById(id);
    if (!lead) { failed++; continue; }

    try {
      const person = await pipedriveCreatePerson(lead);
      queries.getDb().prepare(
        "UPDATE leads SET pipedrive_person_id = ?, pipedrive_pushed_at = datetime('now') WHERE id = ?"
      ).run(String(person.id), lead.id);
      pushed++;
    } catch (err) {
      failed++;
      errors.push({ leadId: id, error: err.message });
    }
  }

  res.json({ pushed, failed, errors });
});

// ─── Auth Routes (I1) ───────────────────────────────────────────────────────

const authRoutes = require('./auth/authRoutes');
const { authenticate } = require('./auth/authMiddleware');

app.use('/api/auth', authenticate, authRoutes);

// ─── Email Routes (D5) ──────────────────────────────────────────────────────

const { sendEmail } = require('./integrations/emailSender');

app.post('/api/leads/:id/send-email', async (req, res) => {
  const { subject, text, html } = req.body;
  const lead = queries.getLeadById(parseInt(req.params.id, 10));
  if (!lead) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Lead not found' });
  }
  if (!lead.email) {
    return res.status(400).json({ error: 'NO_EMAIL', message: 'Lead has no email address' });
  }
  try {
    const result = await sendEmail({ to: lead.email, subject, text, html });
    statusQueries.updateLeadStatus(lead.id, 'contacted');
    res.json(result);
  } catch (err) {
    res.status(err.code === 'SMTP_NOT_CONFIGURED' ? 400 : 500).json({
      error: err.code || 'EMAIL_ERROR',
      message: err.message,
    });
  }
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
