const express = require('express');
const statusQueries = require('../db/statusQueries');
const analyticsQueries = require('../db/analyticsQueries');
const signalDetectionQueries = require('../db/signalDetectionQueries');
const { getUsageSummary } = require('../db/usageQueries');
const { analyzeMessage } = require('../ai/messageAnalyzer');
const { generateContent } = require('../ai/contentGenerator');

const router = express.Router();

// ─── Analytics Routes (F1, F2, F3) ──────────────────────────────────────────

router.get('/analytics/dashboard', (req, res) => {
  try {
    res.json(analyticsQueries.getDashboardSummary());
  } catch (err) {
    res.status(500).json({ error: 'ANALYTICS_FAILED', message: err.message });
  }
});

router.get('/analytics/campaigns', (req, res) => {
  try {
    res.json(analyticsQueries.getCampaignAnalytics());
  } catch (err) {
    res.status(500).json({ error: 'ANALYTICS_FAILED', message: err.message });
  }
});

router.get('/analytics/signals', (req, res) => {
  try {
    res.json(analyticsQueries.getSignalAnalytics());
  } catch (err) {
    res.status(500).json({ error: 'ANALYTICS_FAILED', message: err.message });
  }
});

router.get('/analytics/reply-rates', (req, res) => {
  try {
    res.json(analyticsQueries.getReplyRateAnalytics());
  } catch (err) {
    res.status(500).json({ error: 'ANALYTICS_FAILED', message: err.message });
  }
});

router.get('/analytics/pipeline', (req, res) => {
  try {
    res.json(analyticsQueries.getPipelineAnalytics());
  } catch (err) {
    res.status(500).json({ error: 'ANALYTICS_FAILED', message: err.message });
  }
});

// ─── Meeting Routes (E5) ────────────────────────────────────────────────────

router.post('/meetings', (req, res) => {
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

router.get('/meetings', (req, res) => {
  const { campaignId, limit } = req.query;
  res.json(analyticsQueries.getMeetings({ campaignId: campaignId ? parseInt(campaignId) : undefined, limit: limit ? parseInt(limit) : undefined }));
});

// ─── Signal Detection Routes ────────────────────────────────────────────────

router.get('/signals', (req, res) => {
  const { type, limit } = req.query;
  if (type) {
    res.json(signalDetectionQueries.getSignalsByType(type, { limit: limit ? parseInt(limit) : 50 }));
  } else {
    res.json(signalDetectionQueries.getRecentSignals({ limit: limit ? parseInt(limit) : 100 }));
  }
});

router.get('/signals/stats', (req, res) => {
  res.json(signalDetectionQueries.getSignalStats());
});

router.get('/leads/:id/signals', (req, res) => {
  res.json(signalDetectionQueries.getSignalsByLead(parseInt(req.params.id, 10)));
});

// ─── AI Tools Routes (H1, H2, H3) ──────────────────────────────────────────

router.post('/tools/analyze-message', async (req, res) => {
  const { message, context } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'MISSING_MESSAGE', message: 'message is required' });
  }
  const result = await analyzeMessage({ message, context });
  res.json(result);
});

router.post('/tools/generate-content', async (req, res) => {
  const { topic, tone, audience, format } = req.body;
  if (!topic) {
    return res.status(400).json({ error: 'MISSING_TOPIC', message: 'topic is required' });
  }
  const result = await generateContent({ topic, tone, audience, format });
  res.json(result);
});

// ─── Usage & Cost ───────────────────────────────────────────────────────────

/**
 * GET /api/usage
 * Daily caps status, per-day usage/cost, and per-scan cost for the last N days.
 */
router.get('/usage', (req, res) => {
  res.json(getUsageSummary({ days: parseInt(req.query.days, 10) || 30 }));
});

module.exports = router;
