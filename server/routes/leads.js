const express = require('express');
const multer = require('multer');
const queries = require('../db/queries');
const statusQueries = require('../db/statusQueries');
const signalQueries = require('../db/signalQueries');
const { importCSV } = require('../import/csvImporter');

const router = express.Router();

// Multer config for CSV upload
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/**
 * GET /api/leads
 * Get leads for a specific post URL with optional filtering and sorting.
 */
router.get('/leads', (req, res) => {
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
router.get('/leads/export-csv', (req, res) => {
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
router.get('/leads/multi-signal', (req, res) => {
  const minAppearances = parseInt(req.query.min, 10) || 2;
  const leads = signalQueries.getMultiSignalLeads(minAppearances);
  res.json(leads);
});

/**
 * GET /api/leads/:id
 * Get a single lead by ID.
 */
router.get('/leads/:id', (req, res) => {
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
router.patch('/leads/:id/draft', (req, res) => {
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

// ─── Lead Status Routes ──────────────────────────────────────────────────────

/**
 * PATCH /api/leads/:id/status
 * Update a lead's status.
 */
router.patch('/leads/:id/status', (req, res) => {
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
router.post('/leads/batch-status', (req, res) => {
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
router.get('/leads/:id/history', (req, res) => {
  const history = statusQueries.getLeadStatusHistory(parseInt(req.params.id, 10));
  res.json(history);
});

/**
 * GET /api/stats/funnel
 * Get conversion funnel stats.
 */
router.get('/stats/funnel', (req, res) => {
  const funnel = statusQueries.getStatusFunnel();
  res.json(funnel);
});

// ─── Signal Stacking Routes ──────────────────────────────────────────────────

/**
 * GET /api/leads/:id/appearances
 * Get appearance history for a lead.
 */
router.get('/leads/:id/appearances', (req, res) => {
  const lead = queries.getLeadById(parseInt(req.params.id, 10));
  if (!lead) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Lead not found' });
  }
  const appearances = signalQueries.getAppearanceHistory(lead.linkedin_url);
  res.json(appearances);
});

// (multi-signal moved above /api/leads/:id for correct route matching)

// ─── CSV Import Route ───────────────────────────────────────────────────────

/**
 * POST /api/leads/import-csv
 * Import leads from a CSV file upload.
 */
router.post('/leads/import-csv', upload.single('file'), (req, res) => {
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

module.exports = router;
