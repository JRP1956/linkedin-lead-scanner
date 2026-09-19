const queries = require('../db/queries');
const { recordUsage } = require('../db/usageQueries');

// ─── Error Constants ─────────────────────────────────────────────────────────

const APOLLO_RATE_LIMITED = 'APOLLO_RATE_LIMITED';
const APOLLO_NO_MATCH = 'APOLLO_NO_MATCH';

// ─── Headcount Range Conversion ──────────────────────────────────────────────

/**
 * Convert a raw employee count number to a human-readable range string.
 * Apollo returns estimated_num_employees as a number.
 */
function toHeadcountRange(count) {
  if (count == null || isNaN(count)) return null;
  const n = Number(count);
  if (n <= 10) return '1-10';
  if (n <= 50) return '11-50';
  if (n <= 200) return '51-200';
  if (n <= 500) return '201-500';
  if (n <= 1000) return '501-1000';
  if (n <= 5000) return '1001-5000';
  return '5000+';
}

// ─── Domain Extraction Helper ────────────────────────────────────────────────

/**
 * Attempt to extract a company domain from a LinkedIn profile URL.
 * This will often fail — that's expected. When it fails, we pass null
 * to Apollo and rely on name + linkedinUrl for matching.
 */
function extractDomainFromLinkedinUrl(profileUrl) {
  // LinkedIn profile URLs don't contain company domains.
  // This helper exists for cases where we might have company page URLs,
  // but for individual profiles it will return null.
  try {
    const url = new URL(profileUrl);
    // LinkedIn company pages: /company/[slug]
    const companyMatch = url.pathname.match(/\/company\/([^/]+)/);
    if (companyMatch) {
      // Company slug might hint at domain, but it's unreliable
      return `${companyMatch[1]}.com`;
    }
  } catch {
    // Not a valid URL
  }
  return null;
}

// ─── Main Enrichment Function ────────────────────────────────────────────────

/**
 * Enrich a person using Apollo.io People Match API.
 *
 * Before calling Apollo, checks SQLite cache to avoid duplicate API calls.
 * On 429 rate limit, retries up to 3 times with 30s waits.
 *
 * @param {Object} params
 * @param {string} params.fullName - Full name of the person
 * @param {string} params.linkedinUrl - LinkedIn profile URL
 * @param {string|null} params.companyDomain - Company domain (optional)
 * @returns {Object|null} Enriched person data, or null on failure
 */
async function enrichPerson({ fullName, linkedinUrl, companyDomain }) {
  // Check cache first — if we already have this person with email, skip Apollo
  const cached = queries.getLeadByLinkedinUrl(linkedinUrl);
  if (cached && cached.email) {
    console.log(`[Apollo] Cache hit for ${fullName} (${linkedinUrl})`);
    return {
      firstName: cached.first_name,
      lastName: cached.last_name,
      title: cached.title,
      email: cached.email,
      company: cached.company,
      companyDomain: cached.company_domain,
      headcountRange: cached.headcount_range,
      estimatedRevenue: cached.estimated_revenue,
      industry: cached.industry,
      fundingStage: cached.funding_stage,
      fromCache: true,
    };
  }

  // If no company domain provided, try to extract from LinkedIn URL
  const domain = companyDomain || extractDomainFromLinkedinUrl(linkedinUrl);

  const requestBody = {
    name: fullName,
    linkedin_url: linkedinUrl,
    domain: domain,
    reveal_personal_emails: false,
    reveal_phone_number: true,
  };

  const timestamp = new Date().toISOString();
  console.log(`[Apollo] ${timestamp} | Enriching: ${fullName} | URL: ${linkedinUrl} | Domain: ${domain || 'null'}`);

  let lastError = null;

  // Retry up to 3 times on 429
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch('https://api.apollo.io/v1/people/match', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'X-Api-Key': process.env.APOLLO_API_KEY,
        },
        body: JSON.stringify(requestBody),
      });

      if (res.status === 429) {
        console.warn(`[Apollo] Rate limited (429). Attempt ${attempt}/3. Waiting 30s...`);
        lastError = new Error('Apollo rate limit hit after 3 retries');
        lastError.code = APOLLO_RATE_LIMITED;
        await new Promise((r) => setTimeout(r, 30000));
        continue;
      }

      if (!res.ok) {
        console.error(`[Apollo] HTTP ${res.status} for ${fullName}: ${await res.text()}`);
        return null;
      }

      const data = await res.json();
      const person = data.person;

      if (person) {
        recordUsage({ kind: 'apollo', costUsd: parseFloat(process.env.APOLLO_COST_PER_CREDIT) || 0, detail: linkedinUrl });
      }

      if (!person) {
        console.log(`[Apollo] ${timestamp} | No match for ${fullName}`);
        return {
          firstName: null,
          lastName: null,
          title: null,
          email: null,
          company: null,
          companyDomain: null,
          headcountRange: null,
          estimatedRevenue: null,
          industry: null,
          fundingStage: null,
          noMatch: true,
        };
      }

      const result = {
        firstName: person.first_name || null,
        lastName: person.last_name || null,
        title: person.title || null,
        email: person.email || null,
        phone: person.phone_numbers?.[0]?.sanitized_number || null,
        company: person.organization?.name || null,
        companyDomain: person.organization?.primary_domain || null,
        headcountRange: toHeadcountRange(person.organization?.estimated_num_employees),
        estimatedRevenue: person.organization?.estimated_annual_revenue || null,
        industry: person.organization?.industry || null,
        fundingStage: person.organization?.latest_funding_stage || null,
        fromCache: false,
      };

      console.log(
        `[Apollo] ${timestamp} | Match: ${result.firstName} ${result.lastName} | ` +
        `${result.title || 'no title'} @ ${result.company || 'no company'} | ` +
        `Email: ${result.email ? 'yes' : 'no'}`
      );

      return result;
    } catch (err) {
      console.error(`[Apollo] Network error for ${fullName}:`, err.message);
      lastError = err;
    }
  }

  // All retries exhausted
  if (lastError && lastError.code === APOLLO_RATE_LIMITED) {
    console.error(`[Apollo] Rate limited after 3 retries for ${fullName}. Skipping.`);
  }
  return null;
}

module.exports = {
  enrichPerson,
  extractDomainFromLinkedinUrl,
  toHeadcountRange,
};
