const cron = require('node-cron');
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { getDb } = require('../db/queries');

chromium.use(StealthPlugin());

/**
 * LinkedIn Invitation Withdrawal Job (D6)
 *
 * Daily cron job that checks pending LinkedIn invitations
 * and withdraws invitations older than a configurable number of days (default: 21).
 */
function startWithdrawalJob() {
  const schedule = '0 3 * * *'; // Run daily at 3 AM

  console.log(`[WithdrawalJob] Starting invitation withdrawal job with schedule: ${schedule}`);

  return cron.schedule(schedule, async () => {
    console.log(`[WithdrawalJob] Running at ${new Date().toISOString()}`);
    try {
      await withdrawStaleInvitations();
    } catch (err) {
      console.error('[WithdrawalJob] Error:', err.message);
    }
  });
}

/**
 * Withdraw LinkedIn invitations older than maxDays.
 */
async function withdrawStaleInvitations(maxDays = 21) {
  const browserProfilePath = process.env.BROWSER_PROFILE_PATH || './browser-profile';

  let context;
  try {
    context = await chromium.launchPersistentContext(browserProfilePath, {
      headless: false,
      slowMo: 800,
      viewport: { width: 1280, height: 800 },
    });

    const page = context.pages()[0] || await context.newPage();

    // Navigate to sent invitations
    await page.goto('https://www.linkedin.com/mynetwork/invitation-manager/sent/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    // Get all pending invitations
    const invitations = await page.$$eval(
      '.invitation-card',
      (cards) => cards.map(card => {
        const nameEl = card.querySelector('.invitation-card__title');
        const timeEl = card.querySelector('.invitation-card__subtitle time') || 
                       card.querySelector('.time-badge');
        const withdrawBtn = card.querySelector('button[data-control-name="withdraw"]') ||
                           card.querySelector('button:has-text("Withdraw")');

        return {
          name: nameEl?.textContent?.trim() || '',
          timeText: timeEl?.textContent?.trim() || timeEl?.getAttribute('datetime') || '',
          hasWithdrawButton: !!withdrawBtn,
        };
      })
    ).catch(() => []);

    console.log(`[WithdrawalJob] Found ${invitations.length} pending invitations`);

    let withdrawn = 0;

    for (const inv of invitations) {
      // Parse age from time text (e.g., "3 weeks ago", "1 month ago")
      const daysOld = parseDaysFromTimeText(inv.timeText);

      if (daysOld >= maxDays && inv.hasWithdrawButton) {
        try {
          // Click withdraw button
          const withdrawButton = await page.$(`button[data-control-name="withdraw"]`);
          if (withdrawButton) {
            await withdrawButton.click();
            await page.waitForTimeout(1000);

            // Confirm withdrawal dialog if present
            const confirmButton = await page.$('button[data-test-dialog-primary-btn]');
            if (confirmButton) {
              await confirmButton.click();
              await page.waitForTimeout(1000);
            }

            withdrawn++;
            console.log(`[WithdrawalJob] Withdrawn invitation to ${inv.name} (${daysOld} days old)`);
          }
        } catch (err) {
          console.error(`[WithdrawalJob] Error withdrawing ${inv.name}:`, err.message);
        }

        await page.waitForTimeout(2000); // Rate limit between withdrawals
      }
    }

    console.log(`[WithdrawalJob] Withdrawn ${withdrawn} stale invitations`);
    return { withdrawn, total: invitations.length };
  } catch (err) {
    console.error('[WithdrawalJob] Browser error:', err.message);
    return { withdrawn: 0, total: 0 };
  } finally {
    if (context) await context.close();
  }
}

/**
 * Parse approximate days from a time description string.
 */
function parseDaysFromTimeText(text) {
  if (!text) return 0;
  const lower = text.toLowerCase();

  const weekMatch = lower.match(/(\d+)\s*week/);
  if (weekMatch) return parseInt(weekMatch[1]) * 7;

  const monthMatch = lower.match(/(\d+)\s*month/);
  if (monthMatch) return parseInt(monthMatch[1]) * 30;

  const dayMatch = lower.match(/(\d+)\s*day/);
  if (dayMatch) return parseInt(dayMatch[1]);

  // Try parsing as a date
  try {
    const date = new Date(text);
    if (!isNaN(date.getTime())) {
      return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
    }
  } catch {}

  return 0;
}

module.exports = { startWithdrawalJob, withdrawStaleInvitations, parseDaysFromTimeText };
