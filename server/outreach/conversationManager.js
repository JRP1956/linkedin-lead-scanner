const { ask, objectSchema } = require('../ai/claude');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { getDb } = require('../db/queries');
const campaignQueries = require('../db/campaignQueries');
const statusQueries = require('../db/statusQueries');
const { dispatchEvent } = require('../integrations/webhookDispatcher');

chromium.use(StealthPlugin());

// Read reply classifier prompt
const classifierPromptPath = path.join(__dirname, '..', '..', 'prompts', 'reply-classifier.md');
let classifierPrompt = '';
try {
  classifierPrompt = fs.readFileSync(classifierPromptPath, 'utf-8');
} catch (err) {
  console.warn(`[ConversationManager] Could not read classifier prompt: ${err.message}`);
}

const REPLY_SCHEMA = objectSchema({
  sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
  intent: {
    type: 'string',
    enum: ['interested', 'meeting_request', 'more_info', 'not_interested', 'out_of_office', 'wrong_person', 'unsubscribe'],
  },
  action: { type: 'string', enum: ['stop_sequence', 'continue_sequence', 'pause_sequence', 'escalate'] },
  confidence: { type: 'number' },
  reason: { type: 'string' },
});

/**
 * Conversation Manager (D4)
 *
 * Polls LinkedIn inbox for replies to sent messages.
 * Classifies reply sentiment and updates lead/campaign status accordingly.
 */
async function checkForReplies() {
  const browserProfilePath = process.env.BROWSER_PROFILE_PATH || './browser-profile';

  console.log('[ConversationManager] Checking LinkedIn inbox for replies...');

  let context;
  try {
    context = await chromium.launchPersistentContext(browserProfilePath, {
      headless: false,
      slowMo: 800,
      viewport: { width: 1280, height: 800 },
    });

    const page = context.pages()[0] || await context.newPage();

    // Navigate to LinkedIn messaging
    await page.goto('https://www.linkedin.com/messaging/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    // Get recent conversations with unread indicator
    const conversations = await page.$$eval(
      '.msg-conversation-listitem',
      (items) => items.slice(0, 20).map(item => {
        const nameEl = item.querySelector('.msg-conversation-listitem__participant-names');
        const snippetEl = item.querySelector('.msg-conversation-card__message-snippet-body');
        const unread = item.querySelector('.msg-conversation-card__unread-count');
        const link = item.querySelector('a');

        return {
          name: nameEl?.textContent?.trim() || '',
          snippet: snippetEl?.textContent?.trim() || '',
          hasUnread: !!unread,
          href: link?.getAttribute('href') || '',
        };
      }).filter(c => c.hasUnread && c.name)
    ).catch(() => []);

    console.log(`[ConversationManager] Found ${conversations.length} unread conversations`);

    const replies = [];

    for (const conv of conversations) {
      try {
        // Cross-reference with known leads
        const lead = getDb().prepare(
          "SELECT * FROM leads WHERE name LIKE ? LIMIT 1"
        ).get(`%${conv.name}%`);

        if (!lead) continue;

        // Classify the reply using Claude
        const classification = await classifyReply(conv.snippet, lead);

        if (classification) {
          const reply = {
            leadId: lead.id,
            leadName: lead.name,
            replySnippet: conv.snippet,
            ...classification,
          };

          replies.push(reply);

          // Update lead status based on classification
          if (classification.intent === 'meeting_request') {
            statusQueries.updateLeadStatus(lead.id, 'meeting_booked');
            await dispatchEvent('lead.status_changed', {
              leadId: lead.id,
              newStatus: 'meeting_booked',
              trigger: 'reply_detected',
            });
          } else if (classification.sentiment === 'positive') {
            statusQueries.updateLeadStatus(lead.id, 'replied');
            await dispatchEvent('lead.status_changed', {
              leadId: lead.id,
              newStatus: 'replied',
              trigger: 'reply_detected',
            });
          } else if (classification.sentiment === 'negative') {
            statusQueries.updateLeadStatus(lead.id, 'dead');
          }

          // Stop sequence for this lead if action says so
          if (classification.action === 'stop_sequence') {
            getDb().prepare(`
              UPDATE sequence_tracking SET status = 'cancelled'
              WHERE campaign_lead_id IN (
                SELECT id FROM campaign_leads WHERE lead_id = ?
              ) AND status = 'pending'
            `).run(lead.id);
          }

          console.log(
            `[ConversationManager] ${lead.name}: ${classification.sentiment} reply (${classification.intent}) → ${classification.action}`
          );
        }
      } catch (err) {
        console.error(`[ConversationManager] Error processing ${conv.name}:`, err.message);
      }
    }

    return replies;
  } catch (err) {
    console.error('[ConversationManager] Error:', err.message);
    return [];
  } finally {
    if (context) await context.close();
  }
}

/**
 * Classify a reply using Claude.
 */
async function classifyReply(replyText, lead) {
  if (!replyText) return null;

  const prompt = `${classifierPrompt}\n\n--- REPLY ---\nFrom: ${lead.name} (${lead.title} @ ${lead.company})\nReply text: "${replyText}"`;

  try {
    return await ask({ prompt, schema: REPLY_SCHEMA, tag: 'reply-classifier', maxTokens: 4000 });
  } catch (err) {
    console.error(`[ConversationManager] Classification error:`, err.message);
    return null;
  }
}

module.exports = { checkForReplies, classifyReply };
