const { ask, objectSchema } = require('../ai/claude');
const fs = require('fs');
const path = require('path');

const CLAUDE_API_ERROR = 'CLAUDE_API_ERROR';

// Read the intent classification prompt template at module load
const intentPromptPath = path.join(__dirname, '..', '..', 'prompts', 'intent-classification.md');
let intentPromptTemplate = '';
try {
  intentPromptTemplate = fs.readFileSync(intentPromptPath, 'utf-8');
} catch (err) {
  console.error(`[IntentClassifier] Could not read prompt template at ${intentPromptPath}:`, err.message);
}

const INTENT_SCHEMA = objectSchema({
  results: {
    type: 'array',
    items: objectSchema({
      id: { type: 'integer' },
      tier: { type: 'string', enum: ['T1', 'T2', 'T3', 'T4', 'T5'] },
      score: { type: 'integer' },
      reasoning: { type: 'string' },
      signals: { type: 'array', items: { type: 'string' } },
    }),
  },
});

/**
 * Classify the intent of a batch of LinkedIn comments using Claude API.
 *
 * All comments from a single post are processed in ONE API call to minimize cost.
 * Claude classifies each comment into tiers T1–T5 with a score of 0–45.
 *
 * @param {Array<{id: number, text: string}>} comments - Array of comments with ids
 * @returns {Promise<Array<{id: number, tier: string, score: number, reasoning: string, signals: string[]}>>}
 */
async function classifyComments(comments) {
  if (!comments || comments.length === 0) {
    return [];
  }

  // Format comments for the prompt
  const commentsBlock = comments
    .map((c) => `ID:${c.id} | "${c.text}"`)
    .join('\n');

  const fullPrompt = `${intentPromptTemplate}\n\nComments:\n${commentsBlock}`;

  console.log(`[IntentClassifier] Classifying ${comments.length} comments in single batch`);

  try {
    const { results } = await ask({ prompt: fullPrompt, schema: INTENT_SCHEMA, tag: 'intent' });
    return normalizeIntentResults(results);
  } catch (err) {
    if (err.code === CLAUDE_API_ERROR) throw err;

    console.error('[IntentClassifier] Claude API error:', err.message);
    const error = new Error(`Intent classification failed: ${err.message}`);
    error.code = CLAUDE_API_ERROR;
    throw error;
  }
}

/**
 * Clamp model output to the ranges the ranker expects (tier T1–T5, score 0–45).
 */
function normalizeIntentResults(results) {
  return results.map((r) => ({
    id: r.id,
    tier: ['T1', 'T2', 'T3', 'T4', 'T5'].includes(r.tier) ? r.tier : 'T4',
    score: Math.min(45, Math.max(0, parseInt(r.score, 10) || 10)),
    reasoning: r.reasoning || '',
    signals: Array.isArray(r.signals) ? r.signals : [],
  }));
}

module.exports = { classifyComments, normalizeIntentResults };
