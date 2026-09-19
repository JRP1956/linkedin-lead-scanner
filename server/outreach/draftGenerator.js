const { ask, objectSchema } = require('../ai/claude');
const fs = require('fs');
const path = require('path');

const CLAUDE_API_ERROR = 'CLAUDE_API_ERROR';

// Read the outreach prompt template at module load
const outreachPromptPath = path.join(__dirname, '..', '..', 'prompts', 'outreach-drafts.md');
let outreachPromptTemplate = '';
try {
  outreachPromptTemplate = fs.readFileSync(outreachPromptPath, 'utf-8');
} catch (err) {
  console.error(`[DraftGenerator] Could not read prompt template at ${outreachPromptPath}:`, err.message);
}

const DRAFTS_SCHEMA = objectSchema({
  direct: { type: 'string' },
  topic: { type: 'string' },
  pain: { type: 'string' },
  campaign: { type: 'string' },
});

/**
 * Generate all 4 outreach draft modes for a single lead using Claude API.
 *
 * Modes: direct (comment ref), topic (post topic ref), pain (cold), campaign (custom).
 * The campaign mode is populated from a campaign file if specified, otherwise uses a placeholder.
 *
 * @param {Object} lead - Lead profile data
 * @param {Object} postContext - Context about the source post
 * @param {string} [campaignName] - Optional campaign name to load custom prompt
 * @returns {Promise<{direct: string, topic: string, pain: string, campaign: string}>}
 */
async function generateDrafts(lead, postContext, campaignName) {
  const leadProfile = {
    name: lead.name || `${lead.firstName || ''} ${lead.lastName || ''}`.trim(),
    firstName: lead.firstName || lead.name?.split(' ')[0] || 'there',
    title: lead.title || 'Professional',
    company: lead.company || 'their company',
    industry: lead.industry || 'technology',
    headcount: lead.headcountRange || 'unknown',
    commentText: lead.commentText || '',
    postTopic: postContext.postTopic || 'a relevant industry topic',
    competitorName: postContext.competitorName || 'a company in the space',
  };

  const fullPrompt = `${outreachPromptTemplate}\n\nLead profile:\n${JSON.stringify(leadProfile, null, 2)}`;

  console.log(`[DraftGenerator] Generating drafts for ${leadProfile.name}`);

  try {
    const drafts = await ask({ prompt: fullPrompt, schema: DRAFTS_SCHEMA, tag: 'drafts' });

    // Handle campaign mode — load custom prompt if campaign name specified
    if (campaignName) {
      const campaignPath = path.join(__dirname, '..', '..', 'config', 'campaigns', `${campaignName}.md`);
      try {
        const campaignPrompt = fs.readFileSync(campaignPath, 'utf-8');

        // Replace template variables in campaign prompt
        let campaignDraft = campaignPrompt
          .replace(/{firstName}/g, leadProfile.firstName)
          .replace(/{company}/g, leadProfile.company)
          .replace(/{title}/g, leadProfile.title)
          .replace(/{industry}/g, leadProfile.industry);

        drafts.campaign = campaignDraft;
      } catch {
        console.warn(`[DraftGenerator] Campaign file not found: ${campaignPath}`);
        drafts.campaign = `CAMPAIGN_MODE: load from /config/campaigns/${campaignName}.md`;
      }
    } else {
      drafts.campaign = drafts.campaign || 'CAMPAIGN_MODE: load from /config/campaigns/[name].md';
    }

    return {
      direct: drafts.direct || '',
      topic: drafts.topic || '',
      pain: drafts.pain || '',
      campaign: drafts.campaign || '',
    };
  } catch (err) {
    if (err.code === CLAUDE_API_ERROR) throw err;

    console.error('[DraftGenerator] Claude API error:', err.message);
    const error = new Error(`Draft generation failed: ${err.message}`);
    error.code = CLAUDE_API_ERROR;
    throw error;
  }
}

/**
 * Get list of available campaign names from the campaigns directory.
 * @returns {string[]} Array of campaign names (without .md extension)
 */
function getAvailableCampaigns() {
  const campaignsDir = path.join(__dirname, '..', '..', 'config', 'campaigns');
  try {
    return fs.readdirSync(campaignsDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace('.md', ''));
  } catch {
    return [];
  }
}

module.exports = { generateDrafts, getAvailableCampaigns };
