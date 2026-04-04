const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const promptPath = path.join(__dirname, '..', '..', 'prompts', 'message-analyzer.md');
let promptTemplate = '';
try {
  promptTemplate = fs.readFileSync(promptPath, 'utf-8');
} catch (err) {
  console.warn(`[MessageAnalyzer] Could not read prompt: ${err.message}`);
}

const anthropic = new Anthropic();

/**
 * Message Analyzer (H2)
 * Analyzes an outreach message and returns improvement suggestions.
 *
 * @param {Object} params
 * @param {string} params.message - The outreach message to analyze
 * @param {string} [params.context] - Optional context (lead info, campaign type)
 * @returns {Promise<Object>} Analysis result
 */
async function analyzeMessage({ message, context }) {
  const prompt = `${promptTemplate}

--- MESSAGE TO ANALYZE ---
${message}

${context ? `--- CONTEXT ---\n${context}` : ''}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].text.trim();
    try {
      return { success: true, analysis: JSON.parse(text) };
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return { success: true, analysis: JSON.parse(jsonMatch[0]) };
      }
      return { success: true, analysis: { rawFeedback: text } };
    }
  } catch (err) {
    console.error('[MessageAnalyzer] Error:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { analyzeMessage };
