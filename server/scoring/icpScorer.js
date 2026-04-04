const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

/**
 * Load and parse the ICP configuration from a YAML file.
 * Always reads from disk at runtime — never uses hardcoded values.
 *
 * @param {string} [profileName='icp'] - Name of the ICP profile file (without extension)
 * @returns {Object} Parsed ICP configuration
 */
function loadICP(profileName = 'icp') {
  const icpPath = path.join(__dirname, '..', '..', 'config', `${profileName}.yaml`);
  const raw = fs.readFileSync(icpPath, 'utf-8');
  return yaml.load(raw);
}

/**
 * Load ICP configuration from the database by profile ID or name.
 * Falls back to YAML file if DB profile is not found.
 *
 * @param {number|string} profileIdOrName - DB profile ID or name
 * @returns {Object} Parsed ICP configuration
 */
function loadICPFromDb(profileIdOrName) {
  try {
    const icpQueries = require('../db/icpQueries');
    let profile;

    if (typeof profileIdOrName === 'number') {
      profile = icpQueries.getICPProfileById(profileIdOrName);
    } else {
      profile = icpQueries.getICPProfileByName(profileIdOrName);
    }

    if (profile && profile.config) {
      return profile.config;
    }
  } catch (err) {
    console.warn(`[ICPScorer] DB lookup failed for "${profileIdOrName}", falling back to YAML:`, err.message);
  }

  // Fallback to YAML
  const name = typeof profileIdOrName === 'number' ? 'icp' : profileIdOrName;
  return loadICP(name);
}

/**
 * Score a lead against the ICP definition.
 *
 * Scoring breakdown (max 55 points):
 * - Title match: 0–25 pts
 * - Company fit: 0–20 pts
 *   - Industry match: +6 pts
 *   - Headcount in range: +5 pts
 *   - Revenue in range: +5 pts
 *   - Funding stage match: +4 pts
 * - Profile completeness: 0–10 pts
 *
 * @param {Object} person - Enriched person data
 * @param {Object} icp - Parsed ICP configuration from icp.yaml
 * @returns {Object} { icpScore, titleScore, companyFitScore, completenessScore, dataConfidence, excluded }
 */
function scoreICP(person, icp) {
  let titleScore = 0;
  let companyFitScore = 0;
  let completenessScore = 0;
  let excluded = false;

  const title = (person.title || '').toLowerCase();
  const industry = (person.industry || '').toLowerCase();

  // ─── Title Match (max 25 pts) ──────────────────────────────────────────────

  // Check exclusion first — if title contains any exclude keyword, score is 0
  if (icp.titles.exclude_keywords) {
    for (const kw of icp.titles.exclude_keywords) {
      if (title.includes(kw.toLowerCase())) {
        titleScore = 0;
        excluded = true;
        break;
      }
    }
  }

  if (!excluded) {
    // Exact match against titles.exact_match → 25 pts
    const exactMatch = (icp.titles.exact_match || []).some(
      (t) => title === t.toLowerCase()
    );

    if (exactMatch) {
      titleScore = 25;
    } else {
      // Check for combined seniority + department keyword match → 22 pts
      // This catches titles like "VP of Marketing", "Head of Growth", "Director, Demand Gen"
      const keywordMatch = (icp.titles.keyword_match || []).some(
        (kw) => title.includes(kw.toLowerCase())
      );

      const seniorityMatch = (icp.titles.seniority_keywords || []).some(
        (kw) => title.includes(kw.toLowerCase())
      );

      if (seniorityMatch && keywordMatch) {
        // Both seniority AND department match — near-exact ICP fit
        titleScore = 22;
      } else if (keywordMatch) {
        // Department keyword only (e.g. "Marketing Manager") → 15 pts
        titleScore = 15;
      } else if (seniorityMatch) {
        // Seniority keyword only (e.g. "VP of Operations") → 8 pts
        titleScore = 8;
      }
    }
  }

  // ─── Company Fit (max 20 pts) ──────────────────────────────────────────────

  // Industry in industries.include → +6 pts
  if (person.industry && icp.industries && icp.industries.include) {
    const industryMatch = icp.industries.include.some(
      (ind) => industry.includes(ind.toLowerCase())
    );
    if (industryMatch) {
      companyFitScore += 6;
    }
  }

  // Headcount within range → +5 pts
  if (person.headcountRange && icp.company_size) {
    const headcount = parseHeadcountRange(person.headcountRange);
    if (headcount !== null) {
      const min = icp.company_size.min_headcount || 0;
      const max = icp.company_size.max_headcount || Infinity;
      if (headcount >= min && headcount <= max) {
        companyFitScore += 5;
      }
    }
  }

  // Revenue within range → +5 pts
  if (person.estimatedRevenue && icp.revenue) {
    const revenue = parseRevenue(person.estimatedRevenue);
    if (revenue !== null) {
      const min = icp.revenue.min_annual_revenue_usd || 0;
      const max = icp.revenue.max_annual_revenue_usd || Infinity;
      if (revenue >= min && revenue <= max) {
        companyFitScore += 5;
      }
    }
  }

  // Funding stage in funding.stages → +4 pts
  if (person.fundingStage && icp.funding && icp.funding.stages) {
    const fundingMatch = icp.funding.stages.some(
      (stage) => (person.fundingStage || '').toLowerCase().includes(stage.toLowerCase())
    );
    if (fundingMatch) {
      companyFitScore += 4;
    }
  }

  // ─── Profile Completeness (max 10 pts) ─────────────────────────────────────

  if (person.email) completenessScore += 4;
  if (person.title) completenessScore += 2;
  if (person.company) completenessScore += 2;
  if (person.headcountRange) completenessScore += 1;
  if (person.industry) completenessScore += 1;

  // ─── Data Confidence ──────────────────────────────────────────────────────

  let dataConfidence = 'low';
  const hasEmail = !!person.email;
  const hasTitle = !!person.title;
  const hasCompany = !!person.company;
  const hasHeadcount = !!person.headcountRange;
  const hasIndustry = !!person.industry;

  if (hasEmail && hasTitle && hasCompany && hasHeadcount && hasIndustry) {
    dataConfidence = 'full';
  } else if (hasEmail && hasTitle && hasCompany) {
    dataConfidence = 'partial';
  } else {
    dataConfidence = 'low';
  }

  const icpScore = titleScore + companyFitScore + completenessScore;

  return {
    icpScore,
    titleScore,
    companyFitScore,
    completenessScore,
    dataConfidence,
    excluded,
  };
}

/**
 * Parse a headcount range string (e.g. "51-200") to a midpoint number
 * for comparison against ICP min/max headcount.
 */
function parseHeadcountRange(range) {
  if (!range) return null;

  // Handle "5000+" format
  if (range.includes('+')) {
    const num = parseInt(range.replace('+', ''), 10);
    return isNaN(num) ? null : num;
  }

  // Handle "51-200" format — use midpoint
  const parts = range.split('-').map((s) => parseInt(s.trim(), 10));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return Math.round((parts[0] + parts[1]) / 2);
  }

  // Try parsing as plain number
  const num = parseInt(range, 10);
  return isNaN(num) ? null : num;
}

/**
 * Parse a revenue value to a number in USD.
 * Handles formats from Apollo like: 6000000, "6000000", "$6M", "6M", "10000000", etc.
 */
function parseRevenue(revenue) {
  if (revenue == null) return null;

  // If already a number, return directly
  if (typeof revenue === 'number') return revenue;

  const str = String(revenue).trim().toLowerCase().replace(/[$,]/g, '');

  // Handle "6m", "1.5b" style shorthand
  const multiplierMatch = str.match(/^([\d.]+)\s*(b|m|k)?$/);
  if (multiplierMatch) {
    const num = parseFloat(multiplierMatch[1]);
    const suffix = multiplierMatch[2];
    if (isNaN(num)) return null;
    if (suffix === 'b') return num * 1_000_000_000;
    if (suffix === 'm') return num * 1_000_000;
    if (suffix === 'k') return num * 1_000;
    return num;
  }

  // Try parsing as plain number
  const num = parseFloat(str);
  return isNaN(num) ? null : num;
}

module.exports = { scoreICP, loadICP, loadICPFromDb, parseHeadcountRange, parseRevenue };
