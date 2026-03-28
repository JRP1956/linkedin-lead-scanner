const Anthropic = require('@anthropic-ai/sdk');
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

// Initialize Anthropic client
const anthropic = new Anthropic();

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

  const timestamp = new Date().toISOString();
  console.log(`[DraftGenerator] ${timestamp} | Generating drafts for ${leadProfile.name}`);

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: fullPrompt }],
    });

    // Log token usage for cost monitoring
    const inputTokens = response.usage?.input_tokens || 0;
    const outputTokens = response.usage?.output_tokens || 0;
    console.log(
      `[DraftGenerator] ${timestamp} | Tokens — input: ${inputTokens}, output: ${outputTokens}, ` +
      `estimated cost: $${((inputTokens * 0.003 + outputTokens * 0.015) / 1000).toFixed(4)}`
    );

    const responseText = response.content[0].text.trim();

    // Parse JSON response
    let drafts;
    try {
      drafts = JSON.parse(responseText);
    } catch {
      // Handle markdown-wrapped JSON
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        drafts = JSON.parse(jsonMatch[0]);
      } else {
        console.error('[DraftGenerator] Failed to parse Claude response:', responseText);
        throw new Error('Failed to parse outreach draft response');
      }
    }

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
