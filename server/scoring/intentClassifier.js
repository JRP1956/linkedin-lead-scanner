const Anthropic = require('@anthropic-ai/sdk');
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

// Initialize Anthropic client
const anthropic = new Anthropic();

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

  const timestamp = new Date().toISOString();
  console.log(`[IntentClassifier] ${timestamp} | Classifying ${comments.length} comments in single batch`);

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: fullPrompt }],
    });

    // Log token usage for cost monitoring
    const inputTokens = response.usage?.input_tokens || 0;
    const outputTokens = response.usage?.output_tokens || 0;
    console.log(
      `[IntentClassifier] ${timestamp} | Tokens — input: ${inputTokens}, output: ${outputTokens}, ` +
      `estimated cost: $${((inputTokens * 0.003 + outputTokens * 0.015) / 1000).toFixed(4)}`
    );

    const responseText = response.content[0].text.trim();

    // Parse the JSON response — Claude should return only a JSON array
    let results;
    try {
      results = JSON.parse(responseText);
    } catch (parseErr) {
      // Sometimes Claude wraps in markdown fences despite instructions
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        results = JSON.parse(jsonMatch[0]);
      } else {
        console.error('[IntentClassifier] Failed to parse Claude response:', responseText);
        throw parseErr;
      }
    }

    // Validate and normalize results
    return results.map((r) => ({
      id: r.id,
      tier: ['T1', 'T2', 'T3', 'T4', 'T5'].includes(r.tier) ? r.tier : 'T4',
      score: Math.min(45, Math.max(0, parseInt(r.score, 10) || 10)),
      reasoning: r.reasoning || '',
      signals: Array.isArray(r.signals) ? r.signals : [],
    }));
  } catch (err) {
    if (err.code === CLAUDE_API_ERROR) throw err;

    console.error('[IntentClassifier] Claude API error:', err.message);
    const error = new Error(`Intent classification failed: ${err.message}`);
    error.code = CLAUDE_API_ERROR;
    throw error;
  }
}

module.exports = { classifyComments };
