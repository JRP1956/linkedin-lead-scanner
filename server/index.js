try {
  process.loadEnvFile(require('path').join(__dirname, '..', '.env'));
} catch (err) {
  if (err.code !== 'ENOENT') throw err; // no .env is fine; env vars may come from the shell
}

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

const { initDatabase } = require('./db/queries');
const { startMonitorJob } = require('./jobs/monitorJob');
const { logCustomPropertyChecklist } = require('./integrations/hubspotClient');
const { authenticate } = require('./auth/authMiddleware');

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
if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET not set — running in single-user mode with NO login. Only run this on your own machine.');
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
// The dashboard talks to the API through the Vite proxy (same origin), so only
// explicitly allowed origins get CORS access. This stops random websites open in
// your browser from calling the API.
app.use(cors({ origin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',') }));
app.use(express.json());

// ─── Routes ──────────────────────────────────────────────────────────────────

// Login/signup handle their own auth; every other /api route requires a token
// (a no-op in single-user mode, when JWT_SECRET is unset).
app.use('/api/auth', require('./auth/authRoutes'));
app.use('/api', authenticate);

app.use('/api', require('./routes/scan'));
app.use('/api', require('./routes/leads'));
app.use('/api', require('./routes/crm'));
app.use('/api', require('./routes/campaigns'));
app.use('/api', require('./routes/settings'));
app.use('/api', require('./routes/insights'));



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
