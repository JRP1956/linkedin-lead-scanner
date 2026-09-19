const jobChangeDetector = require('./jobChangeDetector');
const fundingDetector = require('./fundingDetector');
const hiringDetector = require('./hiringDetector');

const DETECTORS = { jobChanges: jobChangeDetector, fundingEvents: fundingDetector, hiringSpikes: hiringDetector };

/**
 * Central signal detection engine. Each detector stores its own signals;
 * one failing detector doesn't stop the others.
 */
async function runSignalDetection() {
  const timestamp = new Date().toISOString();
  console.log(`[SignalEngine] ${timestamp} | Starting signal detection cycle`);

  const results = { errors: [] };
  for (const [name, detector] of Object.entries(DETECTORS)) {
    try {
      results[name] = (await detector.detect()).length;
      console.log(`[SignalEngine] ${name}: ${results[name]}`);
    } catch (err) {
      results[name] = 0;
      results.errors.push(`${name}: ${err.message}`);
      console.error(`[SignalEngine] ${name} error:`, err.message);
    }
  }

  return results;
}

module.exports = { runSignalDetection };
