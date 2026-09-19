const Anthropic = require('@anthropic-ai/sdk');
const { recordUsage } = require('../db/usageQueries');

const client = new Anthropic();

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';

// USD per million tokens [input, output]; unknown models are tracked at $0.
const PRICES = {
  'claude-opus-5': [5, 25],
  'claude-sonnet-5': [2, 10],
  'claude-haiku-4-5': [1, 5],
};

function estimateCost(model, inputTokens, outputTokens) {
  const [inPrice, outPrice] = PRICES[model] || [0, 0];
  return (inputTokens * inPrice + outputTokens * outPrice) / 1e6;
}

/**
 * Single Claude call used by every AI feature.
 *
 * With `schema`, the API's structured output mode guarantees the reply is JSON
 * matching the schema, so callers get a parsed object back instead of scraping text.
 *
 * @param {Object} params
 * @param {string} params.prompt
 * @param {Object} [params.schema] - JSON Schema (root must be an object)
 * @param {string} params.tag - Label for logs and usage tracking
 * @param {number} [params.maxTokens=16000]
 * @returns {Promise<Object|string>} Parsed object when schema is given, otherwise text
 */
async function ask({ prompt, schema, tag, maxTokens = 16000 }) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
    ...(schema && { output_config: { format: { type: 'json_schema', schema } } }),
  });

  const inputTokens = response.usage?.input_tokens || 0;
  const outputTokens = response.usage?.output_tokens || 0;
  const costUsd = estimateCost(MODEL, inputTokens, outputTokens);
  recordUsage({ kind: 'claude', units: inputTokens + outputTokens, costUsd, detail: tag });
  console.log(`[Claude:${tag}] tokens in ${inputTokens} / out ${outputTokens}, ~$${costUsd.toFixed(4)}`);

  if (response.stop_reason === 'refusal') throw new Error('Claude declined this request');
  if (response.stop_reason === 'max_tokens') throw new Error('Claude response was cut off (max_tokens)');

  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  return schema ? JSON.parse(text) : text;
}

/** Shorthand for an object schema where every listed property is required. */
function objectSchema(properties) {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

module.exports = { ask, objectSchema, estimateCost, MODEL };
