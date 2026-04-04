const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const promptPath = path.join(__dirname, '..', '..', 'prompts', 'content-generator.md');
let promptTemplate = '';
try {
  promptTemplate = fs.readFileSync(promptPath, 'utf-8');
} catch (err) {
  console.warn(`[ContentGenerator] Could not read prompt: ${err.message}`);
}

const anthropic = new Anthropic();

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
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].text.trim();
    try {
      return { success: true, content: JSON.parse(text) };
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return { success: true, content: JSON.parse(jsonMatch[0]) };
      }
      return { success: true, content: { post: text } };
    }
  } catch (err) {
    console.error('[ContentGenerator] Error:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { generateContent };
