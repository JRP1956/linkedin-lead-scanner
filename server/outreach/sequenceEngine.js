const { ask } = require('../ai/claude');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/queries');
const campaignQueries = require('../db/campaignQueries');
const statusQueries = require('../db/statusQueries');

/**
 * Follow-up sequences never send anything themselves. When a step is due, Claude
 * writes the message and the step becomes 'ready'; you review it, send it yourself,
 * then mark it sent. Step statuses: pending → ready → sent | skipped (or cancelled on reply).
 */

// Read follow-up prompt template
const promptPath = path.join(__dirname, '..', '..', 'prompts', 'follow-up-sequence.md');
let followUpPromptTemplate = '';
try {
  followUpPromptTemplate = fs.readFileSync(promptPath, 'utf-8');
} catch (err) {
  console.warn(`[SequenceEngine] Could not read follow-up prompt: ${err.message}`);
}

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
 * Leads already in this campaign's sequence are left alone.
 * @returns {number} How many leads were newly scheduled
 */
function scheduleSequenceForLeads(campaignId, leadIds) {
  const db = getDb();
  let steps = getSequenceSteps(campaignId);
  if (steps.length === 0) steps = initializeSequence(campaignId);

  const campaignLeads = db.prepare(`
    SELECT id, lead_id FROM campaign_leads cl
    WHERE campaign_id = ? AND lead_id IN (${leadIds.map(() => '?').join(',')})
      AND NOT EXISTS (SELECT 1 FROM sequence_tracking st WHERE st.campaign_lead_id = cl.id)
  `).all(campaignId, ...leadIds);

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
  return campaignLeads.length;
}

/**
 * Add leads to a campaign and start their follow-up sequence in one go.
 * @returns {{ started: number, alreadyRunning: number }}
 */
function startFollowUps(campaignId, leadIds) {
  campaignQueries.assignLeadsToCampaign(campaignId, leadIds);
  const started = scheduleSequenceForLeads(campaignId, leadIds);
  return { started, alreadyRunning: leadIds.length - started };
}

/**
 * Get pending sequence steps that are due. A step waits until every earlier step
 * for that lead has been sent or skipped, so drafts never pile up unsent.
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
      AND datetime(st.scheduled_at) <= datetime('now')
      AND NOT EXISTS (
        SELECT 1 FROM sequence_tracking earlier
        WHERE earlier.campaign_lead_id = st.campaign_lead_id
          AND earlier.step_number < st.step_number
          AND earlier.status IN ('pending', 'ready')
      )
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
    return await ask({ prompt, tag: 'follow-up', maxTokens: 4000 });
  } catch (err) {
    console.error(`[SequenceEngine] Error generating follow-up for ${lead.lead_name}:`, err.message);
    return null;
  }
}

/**
 * Write drafts for all due sequence steps (runs on the monitor cron).
 */
let drafting = false;

async function processDueSteps() {
  // The cron and "start follow-ups" can both trigger this; don't draft the same step twice
  if (drafting) return { drafted: 0, skipped: 0 };
  drafting = true;
  try {
    return await draftDueSteps();
  } finally {
    drafting = false;
  }
}

async function draftDueSteps() {
  const dueSteps = getDueSequenceSteps();
  if (dueSteps.length === 0) {
    console.log('[SequenceEngine] No due sequence steps');
    return { drafted: 0, skipped: 0 };
  }

  console.log(`[SequenceEngine] Drafting ${dueSteps.length} due sequence steps`);

  let drafted = 0;
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

      db.prepare(`
        UPDATE sequence_tracking SET status = 'ready', message_content = ? WHERE id = ?
      `).run(message, step.id);

      drafted++;
      console.log(`[SequenceEngine] Drafted step ${step.step_number} for ${step.lead_name}`);
    } catch (err) {
      console.error(`[SequenceEngine] Error processing step for ${step.lead_name}:`, err.message);
      skipped++;
    }
  }

  return { drafted, skipped };
}

// ─── Review queue ───────────────────────────────────────────────────────────

/**
 * Drafts waiting for you to send, oldest first.
 */
function getReadyDrafts() {
  return getDb().prepare(`
    SELECT st.id, st.step_number, st.scheduled_at, st.message_content,
           cl.campaign_id, c.name AS campaign_name,
           l.id AS lead_id, l.name AS lead_name, l.title AS lead_title, l.company AS lead_company,
           l.linkedin_url AS lead_linkedin_url, l.email AS lead_email,
           (SELECT COUNT(*) FROM sequence_steps ss WHERE ss.campaign_id = cl.campaign_id) AS total_steps
    FROM sequence_tracking st
    JOIN campaign_leads cl ON st.campaign_lead_id = cl.id
    JOIN campaigns c ON cl.campaign_id = c.id
    JOIN leads l ON cl.lead_id = l.id
    WHERE st.status = 'ready'
    ORDER BY st.scheduled_at ASC
  `).all();
}

function getReadyStep(id) {
  const step = getDb().prepare(`
    SELECT st.*, cl.campaign_id, cl.lead_id, cl.status AS campaign_lead_status
    FROM sequence_tracking st JOIN campaign_leads cl ON st.campaign_lead_id = cl.id
    WHERE st.id = ?
  `).get(id);
  if (!step) throw Object.assign(new Error('Follow-up not found'), { code: 'NOT_FOUND' });
  if (step.status !== 'ready') {
    throw Object.assign(new Error(`Follow-up is already ${step.status}`), { code: 'INVALID_STATE' });
  }
  return step;
}

function updateDraftMessage(id, message) {
  getReadyStep(id);
  getDb().prepare('UPDATE sequence_tracking SET message_content = ? WHERE id = ?').run(message, id);
}

/**
 * Remaining steps keep their spacing relative to when this one was actually sent,
 * so sending late doesn't make the next follow-up due immediately.
 */
function rescheduleLaterSteps(step) {
  getDb().prepare(`
    UPDATE sequence_tracking
    SET scheduled_at = datetime('now', '+' || (
      (SELECT delay_days FROM sequence_steps WHERE campaign_id = ? AND step_number = sequence_tracking.step_number)
      - (SELECT delay_days FROM sequence_steps WHERE campaign_id = ? AND step_number = ?)
    ) || ' days')
    WHERE campaign_lead_id = ? AND status = 'pending' AND step_number > ?
  `).run(step.campaign_id, step.campaign_id, step.step_number, step.campaign_lead_id, step.step_number);
}

/**
 * Record that you sent this follow-up yourself.
 */
function markStepSent(id) {
  const step = getReadyStep(id);
  const db = getDb();
  db.transaction(() => {
    db.prepare("UPDATE sequence_tracking SET status = 'sent', sent_at = datetime('now') WHERE id = ?").run(id);
    // Only advance; never overwrite 'replied' / 'meeting_booked'
    if (step.campaign_lead_status === 'pending') {
      campaignQueries.updateCampaignLeadStatus(step.campaign_id, step.lead_id, 'sent');
    }
    const lead = db.prepare('SELECT lead_status FROM leads WHERE id = ?').get(step.lead_id);
    if (lead.lead_status === 'new') statusQueries.updateLeadStatus(step.lead_id, 'contacted');
    rescheduleLaterSteps(step);
  })();
}

function skipStep(id) {
  const step = getReadyStep(id);
  getDb().prepare("UPDATE sequence_tracking SET status = 'skipped' WHERE id = ?").run(id);
  rescheduleLaterSteps(step);
}

module.exports = {
  initializeSequence,
  getSequenceSteps,
  scheduleSequenceForLeads,
  startFollowUps,
  getDueSequenceSteps,
  generateFollowUpMessage,
  processDueSteps,
  getReadyDrafts,
  updateDraftMessage,
  markStepSent,
  skipStep,
  DEFAULT_STEPS,
};
