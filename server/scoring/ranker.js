/**
 * Combine intent scores and ICP scores into a total score (0–100),
 * then rank leads by descending total score.
 *
 * Total score = intent_score + icp_score + appearance_bonus, capped at 100.
 * Appearance bonus: +5 per additional appearance (capped at +20).
 */

/**
 * Rank an array of leads by combining their intent, ICP, and appearance scores.
 *
 * @param {Array} leads - Array of lead objects with intentScore, icpScore, and optional appearanceCount
 * @returns {Array} Sorted array of leads with totalScore added
 */
function rankLeads(leads) {
  return leads
    .map((lead) => {
      const intentScore = lead.intentScore || 0;
      const icpScore = lead.icpScore || 0;
      const appearanceCount = lead.appearanceCount || 1;

      // +5 per additional appearance beyond the first, capped at +20
      const appearanceBonus = Math.min(20, Math.max(0, (appearanceCount - 1) * 5));

      const totalScore = Math.min(100, intentScore + icpScore + appearanceBonus);

      return {
        ...lead,
        intentScore,
        icpScore,
        appearanceCount,
        appearanceBonus,
        totalScore,
      };
    })
    .sort((a, b) => b.totalScore - a.totalScore);
}

module.exports = { rankLeads };

