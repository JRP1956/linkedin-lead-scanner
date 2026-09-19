const express = require('express');
const analyticsQueries = require('../db/analyticsQueries');
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
