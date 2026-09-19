const express = require('express');
const fs = require('fs');
const path = require('path');
const queries = require('../db/queries');
const suppressionQueries = require('../db/suppressionQueries');
const { generateICP } = require('../ai/icpGenerator');

const router = express.Router();

/**
 * GET /api/monitor
 * Get all monitored accounts.
 */
router.get('/monitor', (req, res) => {
  const accounts = queries.getAllMonitoredAccounts();
  res.json(accounts);
});

/**
 * POST /api/monitor
 * Add a new account to monitor.
 */
router.post('/monitor', (req, res) => {
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
router.delete('/monitor/:id', (req, res) => {
  queries.deleteMonitoredAccount(parseInt(req.params.id, 10));
  res.json({ success: true });
});

/**
 * GET /api/icp-profiles
 * Get list of available ICP profile names.
 */
router.get('/icp-profiles', (req, res) => {
  const configDir = path.join(__dirname, '..', '..', 'config');
  try {
    const files = fs.readdirSync(configDir)
      .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
      .map((f) => f.replace(/\.(yaml|yml)$/, ''));
    res.json(files);
  } catch {
    res.json(['icp']);
  }
});

// ─── Suppression List Routes ─────────────────────────────────────────────────

/**
 * GET /api/suppression
 * Get all suppressed leads with optional filtering.
 */
router.get('/suppression', (req, res) => {
  const { reason, search } = req.query;
  const items = suppressionQueries.getAllSuppressed({ reason, search });
  res.json(items);
});

/**
 * POST /api/suppression
 * Add a single entry to the suppression list.
 */
router.post('/suppression', (req, res) => {
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
router.post('/suppression/bulk', (req, res) => {
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
router.delete('/suppression/:id', (req, res) => {
  suppressionQueries.removeFromSuppressionList(parseInt(req.params.id, 10));
  res.json({ success: true });
});

// ─── ICP Generation ─────────────────────────────────────────────────────────

/**
 * POST /api/icp/generate
 * Generate an ICP profile using AI.
 */
router.post('/icp/generate', async (req, res) => {
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

module.exports = router;
