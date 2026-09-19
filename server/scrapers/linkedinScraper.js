const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Apply stealth plugin to avoid detection
chromium.use(StealthPlugin());

// ─── Error Constants ─────────────────────────────────────────────────────────

const LINKEDIN_LOGIN_REQUIRED = 'LINKEDIN_LOGIN_REQUIRED';
const LINKEDIN_SELECTOR_FAILED = 'LINKEDIN_SELECTOR_FAILED';
const LINKEDIN_RATE_LIMITED = 'LINKEDIN_RATE_LIMITED';

// ─── Selector Definitions ────────────────────────────────────────────────────
// LinkedIn frequently changes selectors. Define primary and fallback selectors
// as named constants so they're easy to update in one place.

const SELECTORS = {
  // Comment item containers
  commentItem: {
    primary: '.comments-comment-item',
    fallback: '[data-id*="comment"]',
    fallback2: '.comments-comment-list__comment',
  },
  // Commenter name
  commenterName: {
    primary: '.comments-post-meta__name-text',
    fallback: '.comments-comment-item__post-meta .artdeco-entity-lockup__title',
    fallback2: '[data-anonymize="person-name"]',
  },
  // Commenter profile link
  commenterLink: {
    primary: '.comments-post-meta__name-text a',
    fallback: '.comments-comment-item a.app-aware-link',
    fallback2: '.comments-post-meta a',
  },
  // Comment text body
  commentText: {
    primary: '.comments-comment-item__main-content',
    fallback: '.comments-comment-texteditor .update-components-text',
    fallback2: '[data-anonymize="comment-body"]',
  },
  // Comment date
  commentDate: {
    primary: '.comments-comment-item__timestamp',
    fallback: '.comments-comment-meta__description-wrapper time',
    fallback2: 'time.comments-comment-item__timestamp',
  },
  // Load more comments button
  loadMoreButton: {
    primary: 'button.comments-comments-list__load-more-comments-button',
    fallback: 'button[aria-label*="Load more comments"]',
    fallback2: 'button[aria-label*="more comments"]',
  },
  // Login wall indicator
  loginWall: {
    primary: '.join-form',
    fallback: '[data-tracking-control-name="public_post_contextual-sign-in"]',
    fallback2: '.authwall-join-form',
  },
  // Reaction count button under the post (opens the reactors modal)
  reactionsButton: {
    primary: 'button.social-details-social-counts__count-value',
    fallback: 'button[aria-label*="reaction"]',
    fallback2: '.social-details-social-counts__reactions button',
  },
  // One person row inside the reactors modal
  reactorItem: {
    primary: '.social-details-reactors-tab-body-list-item',
    fallback: '[role="dialog"] li.artdeco-list__item',
    fallback2: '[role="dialog"] li',
  },
  // "Show more results" inside the reactors modal
  reactorsLoadMore: {
    primary: '[role="dialog"] button.scaffold-finite-scroll__load-button',
    fallback: '[role="dialog"] button[aria-label*="more"]',
  },
  // Rate limit / challenge page
  challengePage: {
    primary: '#captcha-internal',
    fallback: '.challenge-dialog',
    fallback2: '[data-test="challenge"]',
  },
};

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Random human-like delay between actions (200ms–1200ms).
 * Never call page.click() without a preceding humanDelay().
 */
function humanDelay() {
  const delay = Math.floor(200 + Math.random() * 1000);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Try multiple selectors in order, returning elements from the first that matches.
 * Logs a warning if the primary selector fails and a fallback is used.
 */
async function queryWithFallback(page, selectorGroup, method = '$$') {
  for (const [key, selector] of Object.entries(selectorGroup)) {
    try {
      const elements = method === '$$'
        ? await page.$$(selector)
        : await page.$(selector);

      if (method === '$$' && elements.length > 0) {
        if (key !== 'primary') {
          console.warn(`[Scraper] Primary selector failed, using fallback: ${key} → ${selector}`);
        }
        return elements;
      }
      if (method === '$' && elements) {
        if (key !== 'primary') {
          console.warn(`[Scraper] Primary selector failed, using fallback: ${key} → ${selector}`);
        }
        return elements;
      }
    } catch {
      // Selector didn't match, try next
    }
  }
  return method === '$$' ? [] : null;
}

/**
 * Normalize a LinkedIn profile URL to the canonical format:
 * https://www.linkedin.com/in/[slug]
 */
function normalizeProfileUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url, 'https://www.linkedin.com');
    const match = parsed.pathname.match(/\/in\/([^/]+)/);
    if (match) {
      return `https://www.linkedin.com/in/${match[1]}`;
    }
    return url;
  } catch {
    return url;
  }
}

// ─── Main Scraper Function ───────────────────────────────────────────────────

const MAX_REACTORS = 50;

/**
 * Open the reactors modal and collect up to MAX_REACTORS people who reacted.
 * Returns [] (never throws) if the modal can't be found, so comment results still come through.
 */
async function scrapeReactions(page) {
  const button = await queryWithFallback(page, SELECTORS.reactionsButton, '$');
  if (!button) {
    console.warn('[Scraper] Reactions button not found — skipping reactions');
    return [];
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await humanDelay();
  await button.click();
  await page.waitForTimeout(2000);

  // Load more reactors until we hit the cap or run out
  for (let i = 0; i < 10; i++) {
    const items = await queryWithFallback(page, SELECTORS.reactorItem);
    if (items.length >= MAX_REACTORS) break;
    const more = await queryWithFallback(page, SELECTORS.reactorsLoadMore, '$');
    if (!more) break;
    await humanDelay();
    await more.click().catch(() => {});
    await page.waitForTimeout(1500);
  }

  const items = (await queryWithFallback(page, SELECTORS.reactorItem)).slice(0, MAX_REACTORS);
  const reactors = [];
  for (const item of items) {
    const link = await item.$('a[href*="/in/"]');
    if (!link) continue;
    const profileUrl = normalizeProfileUrl(await link.getAttribute('href'));
    const nameEl = await item.$('.artdeco-entity-lockup__title, [data-anonymize="person-name"]');
    const name = nameEl ? (await nameEl.innerText()).split('\n')[0].trim() : 'Unknown';
    reactors.push({ name, profileUrl, commentText: '', commentDate: '', engagementType: 'reaction' });
  }

  await page.keyboard.press('Escape').catch(() => {});
  console.log(`[Scraper] Extracted ${reactors.length} reactors`);
  return reactors;
}

/**
 * Scrape all comments (and optionally reactions) from a LinkedIn post URL.
 *
 * @param {string} postUrl - Full LinkedIn post URL
 * @param {Object} [options]
 * @param {boolean} [options.includeReactions=false] - Also collect people who reacted
 * @returns {Promise<Array<{name: string, profileUrl: string, commentText: string, commentDate: string, engagementType: string}>>}
 */
async function scrapeComments(postUrl, { includeReactions = false } = {}) {
  const browserProfilePath = process.env.BROWSER_PROFILE_PATH || './browser-profile';

  console.log(`[Scraper] Launching browser with profile: ${browserProfilePath}`);
  console.log(`[Scraper] Target URL: ${postUrl}`);

  const context = await chromium.launchPersistentContext(browserProfilePath, {
    headless: false,
    slowMo: 600,
    viewport: { width: 1280, height: 800 },
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
    ],
  });

  const page = context.pages()[0] || await context.newPage();

  try {
    // Navigate to the post
    await humanDelay();
    console.log('[Scraper] Navigating to post...');
    await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanDelay();

    // Check for rate limiting / challenge page
    const challengeEl = await queryWithFallback(page, SELECTORS.challengePage, '$');
    if (challengeEl) {
      const err = new Error('LinkedIn is showing a challenge/captcha page. Wait 1-2 hours before retrying.');
      err.code = LINKEDIN_RATE_LIMITED;
      throw err;
    }

    // Check for login wall redirect
    const loginEl = await queryWithFallback(page, SELECTORS.loginWall, '$');
    if (loginEl) {
      const err = new Error(
        'LinkedIn login required. Please log into LinkedIn via the browser profile and retry.'
      );
      err.code = LINKEDIN_LOGIN_REQUIRED;
      throw err;
    }

    // Wait a bit for the page to fully load comments section
    await page.waitForTimeout(2000);

    // Scroll down to load all comments
    console.log('[Scraper] Loading all comments...');
    let clickCount = 0;
    const maxClicks = 20;
    let prevCommentCount = 0;

    while (clickCount < maxClicks) {
      // Scroll down gradually
      await page.evaluate(() => window.scrollBy(0, 600));
      await humanDelay();

      // Look for "Load more comments" button
      const loadMoreBtn = await queryWithFallback(page, SELECTORS.loadMoreButton, '$');
      if (loadMoreBtn) {
        await humanDelay();
        try {
          await loadMoreBtn.click();
          clickCount++;
          console.log(`[Scraper] Clicked "Load more comments" (${clickCount}/${maxClicks})`);
        } catch {
          // Button may have disappeared
          break;
        }
        await page.waitForTimeout(1500);
      } else {
        // No more "load more" button — check if we have new comments
        const currentCount = (await queryWithFallback(page, SELECTORS.commentItem)).length;
        if (currentCount === prevCommentCount) {
          // No new comments loaded, we're done
          break;
        }
        prevCommentCount = currentCount;
        // Scroll more to see if there's another load button
        await page.evaluate(() => window.scrollBy(0, 800));
        await humanDelay();
      }
    }

    // Extract all comment elements
    console.log('[Scraper] Extracting comments...');
    const commentElements = await queryWithFallback(page, SELECTORS.commentItem);

    if (commentElements.length === 0 && !includeReactions) {
      const err = new Error(
        'No comments found. LinkedIn may have updated its DOM structure, or the post has no comments.'
      );
      err.code = LINKEDIN_SELECTOR_FAILED;
      throw err;
    }

    console.log(`[Scraper] Found ${commentElements.length} comment elements`);

    // Extract data from each comment
    const comments = [];
    const seenUrls = new Set();
    let profilesProcessed = 0;

    for (const commentEl of commentElements) {
      // Anti-detection: pause every 20 profiles for 5-8 seconds
      if (profilesProcessed > 0 && profilesProcessed % 20 === 0) {
        const pauseMs = 5000 + Math.random() * 3000;
        console.log(`[Scraper] Anti-detection pause (${Math.round(pauseMs / 1000)}s) after ${profilesProcessed} profiles`);
        await page.waitForTimeout(pauseMs);
      }

      // Hard cap: never process more than 50 profiles in a session
      if (profilesProcessed >= 50) {
        console.log('[Scraper] Reached 50 profile limit for this session');
        break;
      }

      try {
        // Extract commenter name
        let name = null;
        for (const selector of Object.values(SELECTORS.commenterName)) {
          const nameEl = await commentEl.$(selector);
          if (nameEl) {
            name = (await nameEl.innerText()).trim();
            break;
          }
        }

        // Extract profile URL
        let profileUrl = null;
        for (const selector of Object.values(SELECTORS.commenterLink)) {
          const linkEl = await commentEl.$(selector);
          if (linkEl) {
            profileUrl = await linkEl.getAttribute('href');
            profileUrl = normalizeProfileUrl(profileUrl);
            break;
          }
        }

        // Extract comment text
        let commentText = null;
        for (const selector of Object.values(SELECTORS.commentText)) {
          const textEl = await commentEl.$(selector);
          if (textEl) {
            commentText = (await textEl.innerText()).trim();
            break;
          }
        }

        // Extract comment date
        let commentDate = null;
        for (const selector of Object.values(SELECTORS.commentDate)) {
          const dateEl = await commentEl.$(selector);
          if (dateEl) {
            commentDate = (await dateEl.innerText()).trim();
            break;
          }
        }

        // Deduplicate by profile URL
        if (profileUrl && !seenUrls.has(profileUrl)) {
          seenUrls.add(profileUrl);
          comments.push({
            name: name || 'Unknown',
            profileUrl,
            commentText: commentText || '',
            commentDate: commentDate || '',
            engagementType: 'comment',
          });
          profilesProcessed++;
        }
      } catch (err) {
        console.warn('[Scraper] Failed to extract data from a comment element:', err.message);
      }
    }

    console.log(`[Scraper] Extracted ${comments.length} unique comments`);

    if (includeReactions) {
      const reactors = await scrapeReactions(page);
      // A commenter who also reacted stays a commenter (stronger signal)
      comments.push(...reactors.filter((r) => r.profileUrl && !seenUrls.has(r.profileUrl)));
    }

    if (comments.length === 0) {
      const err = new Error('No comments or reactions found. LinkedIn may have updated its DOM structure.');
      err.code = LINKEDIN_SELECTOR_FAILED;
      throw err;
    }

    return comments;
  } finally {
    await context.close();
  }
}

module.exports = { scrapeComments };
