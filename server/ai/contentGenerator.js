const { ask, objectSchema } = require('./claude');
const fs = require('fs');
const path = require('path');

const promptPath = path.join(__dirname, '..', '..', 'prompts', 'content-generator.md');
let promptTemplate = '';
try {
  promptTemplate = fs.readFileSync(promptPath, 'utf-8');
} catch (err) {
  console.warn(`[ContentGenerator] Could not read prompt: ${err.message}`);
}

const CONTENT_SCHEMA = objectSchema({
  post: { type: 'string' },
  hook: { type: 'string' },
  hashtags: { type: 'array', items: { type: 'string' } },
  estimated_engagement: { type: 'string', enum: ['low', 'medium', 'high'] },
  best_posting_time: { type: 'string' },
  content_type: {
    type: 'string',
    enum: ['thought_leadership', 'case_study', 'tip', 'story', 'question', 'controversial_take'],
  },
});

/**
 * Content Generator (H3)
 * Generates LinkedIn posts based on topic, tone, and target audience.
 *
 * @param {Object} params
 * @param {string} params.topic - The topic/theme for the post
 * @param {string} [params.tone] - Tone: "professional", "casual", "inspirational", "educational"
 * @param {string} [params.audience] - Target audience description
 * @param {string} [params.format] - Format: "short", "story", "listicle", "question"
 * @returns {Promise<Object>} Generated content
 */
async function generateContent({ topic, tone, audience, format }) {
  const prompt = `${promptTemplate}

--- INPUT ---
Topic: ${topic}
Tone: ${tone || 'professional'}
Audience: ${audience || 'B2B professionals'}
Format: ${format || 'story'}`;

  try {
    const content = await ask({ prompt, schema: CONTENT_SCHEMA, tag: 'generate-content' });
    return { success: true, content };
  } catch (err) {
    console.error('[ContentGenerator] Error:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { generateContent };
