const cron = require('node-cron');
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const queries = require('../db/queries');
const { runScan } = require('./scanJob');
const { sendLeadAlert } = require('../integrations/slackNotifier');
const { runSignalDetection } = require('../signals/signalEngine');
const { processDueSteps } = require('../outreach/sequenceEngine');

chromium.use(StealthPlugin());

let cronJob = null;

/**
 * Start the monitor cron job that checks monitored LinkedIn accounts for new posts.
 *
 * On each tick:
 * 1. Fetch all active monitored accounts from SQLite
 * 2. For each account, visit profile and extract most recent post URL
 * 3. Compare against last_post_id
 * 4. If new post detected → run full scanJob → send Slack alert with top leads
 * 5. Update last_checked_at and last_post_id
 * 6. Run signal detection engine (job changes, funding, hiring, keywords)
 * 7. Draft follow-up messages that are due, for review
 */
function startMonitorJob() {
  const schedule = process.env.MONITOR_CRON_SCHEDULE || '0 */6 * * *';

  // Validate cron schedule
  if (!cron.validate(schedule)) {
    console.error(`[Monitor] Invalid cron schedule: ${schedule}. Using default.`);
    return startMonitorJobWithSchedule('0 */6 * * *');
  }

  return startMonitorJobWithSchedule(schedule);
}

function startMonitorJobWithSchedule(schedule) {
  console.log(`[Monitor] Starting monitor job with schedule: ${schedule}`);

  cronJob = cron.schedule(schedule, async () => {
    console.log(`[Monitor] Running scheduled check at ${new Date().toISOString()}`);

    try {
      const accounts = queries.getActiveMonitoredAccounts();

      if (accounts.length === 0) {
        console.log('[Monitor] No active accounts to monitor');
      } else {
        console.log(`[Monitor] Checking ${accounts.length} accounts`);

        for (const account of accounts) {
          try {
            await checkAccount(account);
          } catch (err) {
            console.error(
              `[Monitor] Error checking account ${account.label || account.linkedin_profile_url}:`,
              err.message
            );
          }
        }
      }

      // Run signal detection after account monitoring
      try {
        console.log('[Monitor] Running signal detection...');
        await runSignalDetection();
      } catch (err) {
        console.error('[Monitor] Signal detection error:', err.message);
      }

      // Draft any follow-ups that are now due (they wait in the review queue; nothing is sent)
      try {
        await processDueSteps();
      } catch (err) {
        console.error('[Monitor] Follow-up drafting error:', err.message);
      }
    } catch (err) {
      console.error('[Monitor] Job error:', err.message);
    }
  });

  return cronJob;
}

/**
 * Check a single monitored account for new posts.
 * Supports both 'own' and 'competitor' monitor types.
 */
async function checkAccount(account) {
  const browserProfilePath = process.env.BROWSER_PROFILE_PATH || './browser-profile';
  const monitorType = account.monitor_type || 'own';

  console.log(`[Monitor] Checking [${monitorType}]: ${account.label || account.linkedin_profile_url}`);

  const context = await chromium.launchPersistentContext(browserProfilePath, {
    headless: false,
    slowMo: 600,
    viewport: { width: 1280, height: 800 },
  });

  const page = context.pages()[0] || await context.newPage();

  try {
    // Navigate to the profile's recent activity / posts
    const profileUrl = account.linkedin_profile_url;
    const recentActivityUrl = profileUrl.endsWith('/')
      ? `${profileUrl}recent-activity/all/`
      : `${profileUrl}/recent-activity/all/`;

    await page.goto(recentActivityUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Extract the most recent post URL
    const postLink = await page.$('a[href*="/posts/"]');
    let latestPostUrl = null;

    if (postLink) {
      const href = await postLink.getAttribute('href');
      if (href) {
        latestPostUrl = href.startsWith('http') ? href : `https://www.linkedin.com${href}`;
      }
    }

    // Also try feed-shared-update format
    if (!latestPostUrl) {
      const updateLink = await page.$('[data-urn*="activity"] a[href*="linkedin.com"]');
      if (updateLink) {
        latestPostUrl = await updateLink.getAttribute('href');
      }
    }

    // Update last checked timestamp regardless
    queries.updateMonitoredAccountLastCheck(account.id, latestPostUrl || account.last_post_id);

    if (!latestPostUrl) {
      console.log(`[Monitor] No post found for ${account.label || account.linkedin_profile_url}`);
      return;
    }

    // Check if this is a new post
    if (latestPostUrl === account.last_post_id) {
      console.log(`[Monitor] No new posts for ${account.label || account.linkedin_profile_url}`);
      return;
    }

    // ─── New post detected! ─────────────────────────────────────────
    console.log(`[Monitor] 🆕 New post detected for ${account.label}: ${latestPostUrl}`);

    if (monitorType === 'competitor') {
      // For competitor accounts: scrape engagement and cross-reference with leads
      await trackCompetitorEngagement(page, latestPostUrl, account);
    } else {
      // For own accounts: run full scan
      const { emitter, promise } = runScan({
        postUrl: latestPostUrl,
        outreachMode: 'topic',
        icpProfileName: 'icp',
      });

      // Log scan progress
      emitter.on('progress', (event) => {
        console.log(`[Monitor/Scan] ${event.step}: ${event.message || ''}`);
      });

      const leads = await promise;

      // Send Slack alert with top leads
      if (leads && leads.length > 0) {
        await sendLeadAlert(leads, latestPostUrl);
      }
    }
  } finally {
    await context.close();
  }
}

/**
 * Track competitor engagement (A2)
 * Scrapes reactions/comments on a competitor's post and cross-references with existing leads.
 */
async function trackCompetitorEngagement(page, postUrl, account) {
  try {
    await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Extract commenters
    const commenters = await page.$$eval(
      '.comments-comment-item__post-meta a[href*="/in/"]',
      (links) => links.map(a => ({
        name: a.textContent?.trim() || '',
        linkedinUrl: a.getAttribute('href')?.split('?')[0] || '',
      })).filter(c => c.name && c.linkedinUrl)
    ).catch(() => []);

    if (commenters.length === 0) {
      console.log(`[Monitor/Competitor] No commenters found on ${postUrl}`);
      return;
    }

    console.log(`[Monitor/Competitor] Found ${commenters.length} commenters on ${account.label}'s post`);

    // Cross-reference with existing leads
    const db = queries.getDb();
    const existingLeads = db.prepare(
      `SELECT id, linkedin_url, name FROM leads WHERE linkedin_url IN (${commenters.map(() => '?').join(',')})`
    ).all(commenters.map(c => c.linkedinUrl.startsWith('http') ? c.linkedinUrl : `https://www.linkedin.com${c.linkedinUrl}`));

    if (existingLeads.length > 0) {
      console.log(`[Monitor/Competitor] 🎯 ${existingLeads.length} existing leads engaging with competitor ${account.label}`);
      
      const { dispatchEvent } = require('../integrations/webhookDispatcher');
      for (const lead of existingLeads) {
        await dispatchEvent('signal.detected', {
          type: 'competitor_engagement',
          leadId: lead.id,
          leadName: lead.name,
          competitorAccount: account.label,
          postUrl,
        });
      }
    }
  } catch (err) {
    console.error(`[Monitor/Competitor] Error tracking engagement:`, err.message);
  }
}

/**
 * Stop the monitor cron job.
 */
function stopMonitorJob() {
  if (cronJob) {
    cronJob.stop();
    console.log('[Monitor] Job stopped');
  }
}

module.exports = { startMonitorJob, stopMonitorJob, checkAccount };
