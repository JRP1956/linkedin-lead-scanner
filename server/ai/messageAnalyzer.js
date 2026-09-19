const { ask, objectSchema } = require('./claude');
const fs = require('fs');
const path = require('path');

const promptPath = path.join(__dirname, '..', '..', 'prompts', 'message-analyzer.md');
let promptTemplate = '';
try {
  promptTemplate = fs.readFileSync(promptPath, 'utf-8');
} catch (err) {
  console.warn(`[MessageAnalyzer] Could not read prompt: ${err.message}`);
}

const ANALYSIS_SCHEMA = objectSchema({
  scores: objectSchema({
    personalization: { type: 'integer' },
    clarity: { type: 'integer' },
    cta_strength: { type: 'integer' },
    tone: { type: 'integer' },
    length: { type: 'integer' },
    overall: { type: 'integer' },
  }),
  strengths: { type: 'array', items: { type: 'string' } },
  improvements: { type: 'array', items: { type: 'string' } },
  rewritten: { type: 'string' },
  tips: { type: 'array', items: { type: 'string' } },
});

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
    const analysis = await ask({ prompt, schema: ANALYSIS_SCHEMA, tag: 'analyze-message' });
    return { success: true, analysis };
  } catch (err) {
    console.error('[MessageAnalyzer] Error:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { analyzeMessage };
