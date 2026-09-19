const express = require('express');
const campaignQueries = require('../db/campaignQueries');
const { getAvailableCampaigns } = require('../outreach/draftGenerator');
const { dispatchEvent } = require('../integrations/webhookDispatcher');
const {
  initializeSequence, getSequenceSteps, scheduleSequenceForLeads, startFollowUps, processDueSteps,
  getReadyDrafts, updateDraftMessage, markStepSent, skipStep,
} = require('../outreach/sequenceEngine');

const router = express.Router();

/**
 * GET /api/campaigns
 * Get list of available campaign names.
 */
router.get('/campaigns', (req, res) => {
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
router.post('/campaigns', (req, res) => {
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
router.get('/campaigns/:id', (req, res) => {
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
router.patch('/campaigns/:id', (req, res) => {
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
router.delete('/campaigns/:id', (req, res) => {
  campaignQueries.deleteCampaign(parseInt(req.params.id, 10));
  res.json({ success: true });
});

/**
 * POST /api/campaigns/:id/variants
 * Add a variant to a campaign.
 */
router.post('/campaigns/:id/variants', (req, res) => {
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
router.post('/campaigns/:id/leads', (req, res) => {
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
router.get('/campaigns/:id/leads', (req, res) => {
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
router.get('/campaigns/:id/metrics', (req, res) => {
  const metrics = campaignQueries.getCampaignMetrics(parseInt(req.params.id, 10));
  res.json(metrics);
});

// ─── Sequence Routes (D2) ───────────────────────────────────────────────────

router.post('/campaigns/:id/sequence', (req, res) => {
  const { steps } = req.body;
  try {
    const sequence = initializeSequence(parseInt(req.params.id, 10), steps);
    res.json(sequence);
  } catch (err) {
    res.status(500).json({ error: 'INIT_FAILED', message: err.message });
  }
});

router.get('/campaigns/:id/sequence', (req, res) => {
  const steps = getSequenceSteps(parseInt(req.params.id, 10));
  res.json(steps);
});

router.post('/campaigns/:id/sequence/schedule', (req, res) => {
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

// ─── Follow-up Review Queue ─────────────────────────────────────────────────
// Due follow-ups are drafted by the monitor job; you send them and mark them here.

function followUpError(res, err) {
  const status = { NOT_FOUND: 404, INVALID_STATE: 409 }[err.code] || 500;
  res.status(status).json({ error: err.code || 'FOLLOW_UP_ERROR', message: err.message });
}

/**
 * POST /api/campaigns/:id/follow-ups/start
 * Add leads to the campaign, start their sequence, and draft the day-0 step right away.
 */
router.post('/campaigns/:id/follow-ups/start', (req, res) => {
  const { leadIds } = req.body;
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return res.status(400).json({ error: 'INVALID_LEAD_IDS', message: 'leadIds must be a non-empty array' });
  }
  const campaignId = parseInt(req.params.id, 10);
  if (!campaignQueries.getCampaignById(campaignId)) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Campaign not found' });
  }
  try {
    const result = startFollowUps(campaignId, leadIds);
    // Drafting calls Claude per lead, so don't make the request wait for it
    processDueSteps().catch((err) => console.error('[FollowUps] Drafting error:', err.message));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'START_FAILED', message: err.message });
  }
});

router.get('/follow-ups', (req, res) => {
  res.json(getReadyDrafts());
});

router.patch('/follow-ups/:id', (req, res) => {
  const { message } = req.body;
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'MISSING_MESSAGE', message: 'message is required' });
  }
  try {
    updateDraftMessage(parseInt(req.params.id, 10), message);
    res.json({ success: true });
  } catch (err) { followUpError(res, err); }
});

router.post('/follow-ups/:id/sent', (req, res) => {
  try {
    markStepSent(parseInt(req.params.id, 10));
    res.json({ success: true });
  } catch (err) { followUpError(res, err); }
});

router.post('/follow-ups/:id/skip', (req, res) => {
  try {
    skipStep(parseInt(req.params.id, 10));
    res.json({ success: true });
  } catch (err) { followUpError(res, err); }
});

module.exports = router;
