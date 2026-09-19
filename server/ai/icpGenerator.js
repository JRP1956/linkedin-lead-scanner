const { ask, objectSchema } = require('./claude');
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

const stringList = { type: 'array', items: { type: 'string' } };
const ICP_SCHEMA = objectSchema({
  titles: objectSchema({
    exact_match: stringList,
    keyword_match: stringList,
    seniority_keywords: stringList,
    exclude_keywords: stringList,
  }),
  industries: objectSchema({ include: stringList }),
  company_size: objectSchema({ min_headcount: { type: 'integer' }, max_headcount: { type: 'integer' } }),
  revenue: objectSchema({ min_annual_revenue_usd: { type: 'integer' }, max_annual_revenue_usd: { type: 'integer' } }),
  funding: objectSchema({ stages: stringList }),
  description: { type: 'string' },
});

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

  console.log(`[ICPGenerator] Generating ICP for: ${productDescription.substring(0, 80)}...`);

  try {
    const icpConfig = await ask({ prompt: fullPrompt, schema: ICP_SCHEMA, tag: 'icp' });

    return {
      success: true,
      icp: icpConfig,
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
