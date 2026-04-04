const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const signalDetectionQueries = require('../db/signalDetectionQueries');
const { getDb } = require('../db/queries');

chromium.use(StealthPlugin());

/**
 * Event & Group Tracker (A5)
 *
 * Scrapes LinkedIn group pages and event pages using Playwright
 * to detect when monitored leads join new groups or RSVP to events.
 *
 * Note: This is a heavy Playwright automation feature that carries
 * LinkedIn rate-limiting risk. Use with caution.
 */
async function detect() {
  const browserProfilePath = process.env.BROWSER_PROFILE_PATH || './browser-profile';
  const signals = [];

  // Get leads with LinkedIn URLs to check
  const leads = getDb().prepare(`
    SELECT id, linkedin_url, name
    FROM leads
    WHERE linkedin_url IS NOT NULL
    ORDER BY total_score DESC
    LIMIT 20
  `).all();

  if (leads.length === 0) {
    console.log('[EventGroupTracker] No leads to track');
    return signals;
  }

  console.log(`[EventGroupTracker] Checking ${leads.length} leads for group/event activity`);

  let context;
  try {
    context = await chromium.launchPersistentContext(browserProfilePath, {
      headless: false,
      slowMo: 800,
      viewport: { width: 1280, height: 800 },
    });

    const page = context.pages()[0] || await context.newPage();

    for (const lead of leads) {
      try {
        // Navigate to the lead's profile interests page
        const profileUrl = lead.linkedin_url.endsWith('/')
          ? lead.linkedin_url
          : `${lead.linkedin_url}/`;
        
        const interestsUrl = `${profileUrl}details/interests/`;
        await page.goto(interestsUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);

        // Look for group memberships
        const groups = await page.$$eval(
          '[data-view-name="profile-component-entity"]',
          (elements) => elements.map(el => ({
            name: el.querySelector('.t-bold')?.textContent?.trim() || '',
            description: el.querySelector('.t-normal')?.textContent?.trim() || '',
          })).filter(g => g.name)
        ).catch(() => []);

        if (groups.length > 0) {
          const signalData = {
            leadId: lead.id,
            leadName: lead.name,
            linkedinUrl: lead.linkedin_url,
            groups: groups.slice(0, 10),
            type: 'group_membership',
          };

          signalDetectionQueries.insertSignal({
            type: 'group_activity',
            leadId: lead.id,
            linkedinUrl: lead.linkedin_url,
            data: signalData,
          });

          signals.push(signalData);
          console.log(`[EventGroupTracker] 👥 ${lead.name}: Found ${groups.length} groups`);
        }

        await page.waitForTimeout(1500); // Rate limit
      } catch (err) {
        console.error(`[EventGroupTracker] Error checking ${lead.name}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[EventGroupTracker] Browser launch error:', err.message);
  } finally {
    if (context) await context.close();
  }

  return signals;
}

module.exports = { detect };
