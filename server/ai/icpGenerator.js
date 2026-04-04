const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

// Read the ICP generator prompt template
const promptPath = path.join(__dirname, '..', '..', 'prompts', 'icp-generator.md');
let promptTemplate = '';
try {
  promptTemplate = fs.readFileSync(promptPath, 'utf-8');
} catch (err) {
  console.warn(`[ICPGenerator] Could not read prompt template at ${promptPath}:`, err.message);
}

// Initialize Anthropic client
const anthropic = new Anthropic();

/**
 * Generate an ICP (Ideal Customer Profile) using Claude based on a product description.
 *
 * @param {Object} params
 * @param {string} params.productDescription - Description of the product/service
 * @param {string} [params.targetMarket] - Optional target market hint
 * @param {string} [params.existingCustomers] - Optional description of existing customers
 * @returns {Promise<Object>} Generated ICP configuration
 */
async function generateICP({ productDescription, targetMarket, existingCustomers }) {
  const input = {
    product_description: productDescription,
    target_market: targetMarket || 'Not specified',
    existing_customers: existingCustomers || 'Not specified',
  };

  const fullPrompt = `${promptTemplate}\n\n--- INPUT ---\n${JSON.stringify(input, null, 2)}`;

  const timestamp = new Date().toISOString();
  console.log(`[ICPGenerator] ${timestamp} | Generating ICP for: ${productDescription.substring(0, 80)}...`);

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3000,
      messages: [{ role: 'user', content: fullPrompt }],
    });

    const inputTokens = response.usage?.input_tokens || 0;
    const outputTokens = response.usage?.output_tokens || 0;
    console.log(
      `[ICPGenerator] ${timestamp} | Tokens — input: ${inputTokens}, output: ${outputTokens}, ` +
      `estimated cost: $${((inputTokens * 0.003 + outputTokens * 0.015) / 1000).toFixed(4)}`
    );

    const responseText = response.content[0].text.trim();

    // Parse JSON response
    let icpConfig;
    try {
      icpConfig = JSON.parse(responseText);
    } catch {
      const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        icpConfig = JSON.parse(jsonMatch[1].trim());
      } else {
        const objectMatch = responseText.match(/\{[\s\S]*\}/);
        if (objectMatch) {
          icpConfig = JSON.parse(objectMatch[0]);
        } else {
          throw new Error('Failed to parse ICP response as JSON');
        }
      }
    }

    return {
      success: true,
      icp: icpConfig,
      usage: { inputTokens, outputTokens },
    };
  } catch (err) {
    console.error('[ICPGenerator] Claude API error:', err.message);
    return {
      success: false,
      error: err.message,
    };
  }
}

module.exports = { generateICP };
