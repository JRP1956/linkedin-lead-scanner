const express = require('express');
const queries = require('../db/queries');
const suppressionQueries = require('../db/suppressionQueries');
const { createOrUpdateContact } = require('../integrations/hubspotClient');
const { listSequences, addContactToSequence } = require('../integrations/apolloSequencer');

const router = express.Router();

/**
 * POST /api/leads/:id/push-hubspot
 * Push a single lead to HubSpot.
 */
router.post('/leads/:id/push-hubspot', async (req, res) => {
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
router.post('/leads/push-hubspot-batch', async (req, res) => {
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

// ─── Apollo Sequence Routes ──────────────────────────────────────────────────

/**
 * GET /api/apollo/sequences
 * List available Apollo email sequences.
 */
router.get('/apollo/sequences', async (req, res) => {
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
router.post('/leads/:id/push-apollo', async (req, res) => {
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
router.post('/leads/push-apollo-batch', async (req, res) => {
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

module.exports = router;
