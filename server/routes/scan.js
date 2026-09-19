const express = require('express');
const { runScan } = require('../jobs/scanJob');

const router = express.Router();

const INVALID_POST_URL = 'INVALID_POST_URL';

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

/**
 * POST /api/scan
 * Start a scan job. Returns an SSE stream of progress events.
 */
router.post('/scan', (req, res) => {
  const { postUrl, outreachMode, icpProfile, includeReactions } = req.body;

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
    includeReactions: Boolean(includeReactions),
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

module.exports = router;
