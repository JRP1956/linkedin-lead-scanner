const jobChangeDetector = require('./jobChangeDetector');
const fundingDetector = require('./fundingDetector');
const hiringDetector = require('./hiringDetector');
const keywordMonitor = require('./keywordMonitor');
const { dispatchEvent } = require('../integrations/webhookDispatcher');
const { sendLeadAlert } = require('../integrations/slackNotifier');

/**
 * Central signal detection engine.
 * Runs all signal detectors and dispatches results to webhooks and Slack.
 */
async function runSignalDetection() {
  const timestamp = new Date().toISOString();
  console.log(`[SignalEngine] ${timestamp} | Starting signal detection cycle`);

  const results = {
    jobChanges: 0,
    fundingEvents: 0,
    hiringSpikes: 0,
    keywordMatches: 0,
    errors: [],
  };

  // 1. Job Change Detection
  try {
    const changes = await jobChangeDetector.detect();
    results.jobChanges = changes.length;
    for (const signal of changes) {
      await dispatchEvent('signal.detected', { type: 'job_change', ...signal });
    }
    console.log(`[SignalEngine] Job changes detected: ${changes.length}`);
  } catch (err) {
    results.errors.push(`jobChange: ${err.message}`);
    console.error('[SignalEngine] Job change detection error:', err.message);
  }

  // 2. Funding Detection
  try {
    const events = await fundingDetector.detect();
    results.fundingEvents = events.length;
    for (const signal of events) {
      await dispatchEvent('signal.detected', { type: 'funding', ...signal });
    }
    console.log(`[SignalEngine] Funding events detected: ${events.length}`);
  } catch (err) {
    results.errors.push(`funding: ${err.message}`);
    console.error('[SignalEngine] Funding detection error:', err.message);
  }

  // 3. Hiring Spike Detection
  try {
    const spikes = await hiringDetector.detect();
    results.hiringSpikes = spikes.length;
    for (const signal of spikes) {
      await dispatchEvent('signal.detected', { type: 'hiring_spike', ...signal });
    }
    console.log(`[SignalEngine] Hiring spikes detected: ${spikes.length}`);
  } catch (err) {
    results.errors.push(`hiring: ${err.message}`);
    console.error('[SignalEngine] Hiring detection error:', err.message);
  }

  // 4. Keyword Monitoring
  try {
    const matches = await keywordMonitor.detect();
    results.keywordMatches = matches.length;
    for (const signal of matches) {
      await dispatchEvent('signal.detected', { type: 'keyword_match', ...signal });
    }
    console.log(`[SignalEngine] Keyword matches: ${matches.length}`);
  } catch (err) {
    results.errors.push(`keyword: ${err.message}`);
    console.error('[SignalEngine] Keyword monitoring error:', err.message);
  }

  const totalSignals = results.jobChanges + results.fundingEvents + results.hiringSpikes + results.keywordMatches;
  console.log(`[SignalEngine] ${timestamp} | Cycle complete — ${totalSignals} total signals detected`);

  return results;
}

module.exports = { runSignalDetection };
