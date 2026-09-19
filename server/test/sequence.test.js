const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ANTHROPIC_API_KEY ||= 'test';

// Stub Claude before the engine grabs it
const claude = require('../ai/claude');
claude.ask = async ({ prompt }) => `draft for ${prompt.match(/Step Number: (\d)/)[1]}`;

const queries = require('../db/queries');
const campaignQueries = require('../db/campaignQueries');
const engine = require('../outreach/sequenceEngine');

const db = queries.initDatabase(':memory:');

queries.upsertLead({ postUrl: 'p', linkedinUrl: 'https://www.linkedin.com/in/ada', name: 'Ada' });
const leadId = queries.getLeadByLinkedinUrl('https://www.linkedin.com/in/ada').id;
const campaign = campaignQueries.createCampaign({ name: 'Q3' });
campaignQueries.assignLeadsToCampaign(campaign.id, [leadId]);
engine.scheduleSequenceForLeads(campaign.id, [leadId]); // default 4 steps: day 0, 3, 7, 14

const steps = () => db.prepare('SELECT step_number, status, scheduled_at FROM sequence_tracking ORDER BY step_number').all();
const makeAllDue = () => db.prepare("UPDATE sequence_tracking SET scheduled_at = datetime('now', '-1 minute') WHERE status = 'pending'").run();

test('due steps become drafts one at a time and nothing is marked sent', async () => {
  makeAllDue();
  assert.deepEqual(await engine.processDueSteps(), { drafted: 1, skipped: 0 });
  assert.deepEqual(steps().map((s) => s.status), ['ready', 'pending', 'pending', 'pending']);

  // Step 2 is due but waits while step 1 is unsent
  assert.deepEqual(await engine.processDueSteps(), { drafted: 0, skipped: 0 });

  const [draft] = engine.getReadyDrafts();
  assert.equal(draft.message_content, 'draft for 1');
  assert.equal(draft.total_steps, 4);
  assert.equal(campaignQueries.getCampaignLeads(campaign.id)[0].status, 'pending');
});

test('marking sent records it and re-spaces later steps from now', () => {
  const [draft] = engine.getReadyDrafts();
  engine.updateDraftMessage(draft.id, 'edited');
  engine.markStepSent(draft.id);

  const rows = steps();
  assert.equal(rows[0].status, 'sent');
  const daysFromNow = (s) => db.prepare("SELECT ROUND(julianday(?) - julianday('now')) AS d").get(s.scheduled_at).d;
  assert.deepEqual(rows.slice(1).map(daysFromNow), [3, 7, 14]);
  assert.equal(campaignQueries.getCampaignLeads(campaign.id)[0].status, 'sent');
  assert.equal(queries.getLeadById(leadId).lead_status, 'contacted');
  assert.throws(() => engine.markStepSent(draft.id), { code: 'INVALID_STATE' });
});

test('skip moves on to the next step', async () => {
  makeAllDue();
  await engine.processDueSteps();
  engine.skipStep(engine.getReadyDrafts()[0].id);
  makeAllDue();
  await engine.processDueSteps();
  assert.deepEqual(steps().map((s) => s.status), ['sent', 'skipped', 'ready', 'pending']);
});

test('replied leads get no more drafts', async () => {
  engine.markStepSent(engine.getReadyDrafts()[0].id);
  db.prepare("UPDATE leads SET lead_status = 'replied' WHERE id = ?").run(leadId);
  makeAllDue();
  assert.deepEqual(await engine.processDueSteps(), { drafted: 0, skipped: 0 });
});

test('starting follow-ups twice does not duplicate the sequence', () => {
  queries.upsertLead({ postUrl: 'p', linkedinUrl: 'https://www.linkedin.com/in/grace', name: 'Grace' });
  const graceId = queries.getLeadByLinkedinUrl('https://www.linkedin.com/in/grace').id;
  const other = campaignQueries.createCampaign({ name: 'Q4' });

  assert.deepEqual(engine.startFollowUps(other.id, [graceId]), { started: 1, alreadyRunning: 0 });
  assert.deepEqual(engine.startFollowUps(other.id, [graceId, leadId]), { started: 1, alreadyRunning: 1 });
  const count = db.prepare(`
    SELECT COUNT(*) AS n FROM sequence_tracking st JOIN campaign_leads cl ON st.campaign_lead_id = cl.id
    WHERE cl.campaign_id = ?`).get(other.id).n;
  assert.equal(count, 8); // 2 leads × 4 default steps
});

test('they replied stops the rest of the sequence', async () => {
  const graceId = queries.getLeadByLinkedinUrl('https://www.linkedin.com/in/grace').id;
  const graceSteps = () => db.prepare(`
    SELECT st.status FROM sequence_tracking st JOIN campaign_leads cl ON st.campaign_lead_id = cl.id
    WHERE cl.lead_id = ? ORDER BY st.step_number`).all(graceId).map((r) => r.status);

  makeAllDue();
  await engine.processDueSteps();
  const [draft] = engine.getReadyDrafts(); // Ada already replied, so only Grace's draft
  assert.equal(draft.lead_id, graceId);

  engine.markReplied(draft.id);
  assert.deepEqual(graceSteps(), ['cancelled', 'cancelled', 'cancelled', 'cancelled']);
  assert.equal(queries.getLeadById(graceId).lead_status, 'replied');
  assert.equal(engine.getReadyDrafts().length, 0);
  makeAllDue();
  assert.deepEqual(await engine.processDueSteps(), { drafted: 0, skipped: 0 });
  assert.throws(() => engine.markReplied(9999), { code: 'NOT_FOUND' });
});
