const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/queries');
const campaignQueries = require('../db/campaignQueries');

// Read follow-up prompt template
const promptPath = path.join(__dirname, '..', '..', 'prompts', 'follow-up-sequence.md');
let followUpPromptTemplate = '';
try {
  followUpPromptTemplate = fs.readFileSync(promptPath, 'utf-8');
} catch (err) {
  console.warn(`[SequenceEngine] Could not read follow-up prompt: ${err.message}`);
}

const anthropic = new Anthropic();

// Default sequence steps
const DEFAULT_STEPS = [
  { stepNumber: 1, delayDays: 0, label: 'Initial Message' },
  { stepNumber: 2, delayDays: 3, label: 'Follow-up 1' },
  { stepNumber: 3, delayDays: 7, label: 'Follow-up 2' },
  { stepNumber: 4, delayDays: 14, label: 'Break-up Message' },
];

/**
 * Initialize sequence steps for a campaign.
 */
function initializeSequence(campaignId, steps = DEFAULT_STEPS) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO sequence_steps (campaign_id, step_number, delay_days)
    VALUES (?, ?, ?)
  `);

  const insertMany = db.transaction((stepsToInsert) => {
    for (const step of stepsToInsert) {
      stmt.run(campaignId, step.stepNumber, step.delayDays);
    }
  });

  insertMany(steps);
  return getSequenceSteps(campaignId);
}

/**
 * Get sequence steps for a campaign.
 */
function getSequenceSteps(campaignId) {
  return getDb().prepare(
    'SELECT * FROM sequence_steps WHERE campaign_id = ? ORDER BY step_number'
  ).all(campaignId);
}

/**
 * Schedule sequence tracking entries for campaign leads.
 */
function scheduleSequenceForLeads(campaignId, leadIds) {
  const db = getDb();
  const steps = getSequenceSteps(campaignId);
  if (steps.length === 0) return;

  const campaignLeads = db.prepare(
    `SELECT id, lead_id FROM campaign_leads WHERE campaign_id = ? AND lead_id IN (${leadIds.map(() => '?').join(',')})`
  ).all(campaignId, ...leadIds);

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO sequence_tracking (campaign_lead_id, step_number, status, scheduled_at)
    VALUES (?, ?, 'pending', ?)
  `);

  const now = new Date();

  const scheduleAll = db.transaction(() => {
    for (const cl of campaignLeads) {
      for (const step of steps) {
        const scheduledDate = new Date(now.getTime() + step.delay_days * 24 * 60 * 60 * 1000);
        stmt.run(cl.id, step.step_number, scheduledDate.toISOString());
      }
    }
  });

  scheduleAll();
}

/**
 * Get pending sequence steps that are due.
 */
function getDueSequenceSteps() {
  return getDb().prepare(`
    SELECT st.*, cl.lead_id, cl.campaign_id, cl.variant_id,
           l.name as lead_name, l.title as lead_title, l.company as lead_company,
           l.email as lead_email, l.linkedin_url as lead_linkedin_url,
           l.comment_text as lead_comment, l.lead_status
    FROM sequence_tracking st
    JOIN campaign_leads cl ON st.campaign_lead_id = cl.id
    JOIN leads l ON cl.lead_id = l.id
    WHERE st.status = 'pending'
      AND st.scheduled_at <= datetime('now')
      AND l.lead_status NOT IN ('replied', 'meeting_booked', 'converted', 'dead')
    ORDER BY st.scheduled_at ASC
    LIMIT 50
  `).all();
}

/**
 * Generate a follow-up message for a specific sequence step.
 */
async function generateFollowUpMessage(lead, stepNumber, previousMessages = []) {
  const prompt = `${followUpPromptTemplate}

--- CONTEXT ---
Lead: ${lead.lead_name}
Title: ${lead.lead_title || 'Unknown'}
Company: ${lead.lead_company || 'Unknown'}
Original Comment: ${lead.lead_comment || 'N/A'}
Step Number: ${stepNumber} of 4
Previous Messages:
${previousMessages.map((m, i) => `Step ${i + 1}: ${m}`).join('\n') || 'None'}

Generate ONLY the follow-up message for step ${stepNumber}. Return just the message text.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });

    return response.content[0].text.trim();
  } catch (err) {
    console.error(`[SequenceEngine] Error generating follow-up for ${lead.lead_name}:`, err.message);
    return null;
  }
}

/**
 * Process all due sequence steps.
 */
async function processDueSteps() {
  const dueSteps = getDueSequenceSteps();
  if (dueSteps.length === 0) {
    console.log('[SequenceEngine] No due sequence steps');
    return { processed: 0, skipped: 0 };
  }

  console.log(`[SequenceEngine] Processing ${dueSteps.length} due sequence steps`);

  let processed = 0;
  let skipped = 0;
  const db = getDb();

  for (const step of dueSteps) {
    try {
      // Get previous messages for context
      const previousMessages = db.prepare(`
        SELECT message_content FROM sequence_tracking
        WHERE campaign_lead_id = ? AND step_number < ? AND status = 'sent'
        ORDER BY step_number
      `).all(step.campaign_lead_id, step.step_number)
        .map(m => m.message_content)
        .filter(Boolean);

      // Generate the message
      const message = await generateFollowUpMessage(step, step.step_number, previousMessages);

      if (!message) {
        skipped++;
        continue;
      }

      // Mark as sent and store message
      db.prepare(`
        UPDATE sequence_tracking
        SET status = 'sent', sent_at = datetime('now'), message_content = ?
        WHERE id = ?
      `).run(message, step.id);

      // Update campaign lead status
      campaignQueries.updateCampaignLeadStatus(step.campaign_id, step.lead_id, 'sent');

      processed++;
      console.log(`[SequenceEngine] Sent step ${step.step_number} to ${step.lead_name}`);
    } catch (err) {
      console.error(`[SequenceEngine] Error processing step for ${step.lead_name}:`, err.message);
      skipped++;
    }
  }

  return { processed, skipped };
}

module.exports = {
  initializeSequence,
  getSequenceSteps,
  scheduleSequenceForLeads,
  getDueSequenceSteps,
  generateFollowUpMessage,
  processDueSteps,
  DEFAULT_STEPS,
};
