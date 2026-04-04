const { getDb } = require('../db/queries');
const signalDetectionQueries = require('../db/signalDetectionQueries');

/**
 * Funding Detector (A4)
 * 
 * Detects funding events for companies in the leads table.
 * Uses configurable approach:
 * 1. Crunchbase API if CRUNCHBASE_API_KEY is set
 * 2. Google News RSS search as free fallback
 */
async function detect() {
  const signals = [];

  // Get unique companies from leads
  const companies = getDb().prepare(`
    SELECT DISTINCT company, company_domain
    FROM leads
    WHERE company IS NOT NULL AND company != ''
    ORDER BY created_at DESC
    LIMIT 50
  `).all();

  console.log(`[FundingDetector] Checking ${companies.length} companies for funding events`);

  if (process.env.CRUNCHBASE_API_KEY) {
    return await detectViaCrunchbase(companies, signals);
  }

  // Fallback: Google News RSS
  return await detectViaNewsRSS(companies, signals);
}

/**
 * Detect funding via Crunchbase API
 */
async function detectViaCrunchbase(companies, signals) {
  for (const company of companies) {
    try {
      const domain = company.company_domain;
      if (!domain) continue;

      const res = await fetch(
        `https://api.crunchbase.com/api/v4/entities/organizations/${domain}?field_ids=short_description,funding_total,last_funding_type,last_funding_at&user_key=${process.env.CRUNCHBASE_API_KEY}`
      );

      if (!res.ok) continue;

      const data = await res.json();
      const properties = data.properties;

      if (properties?.last_funding_at) {
        const fundingDate = new Date(properties.last_funding_at);
        const daysSinceFunding = (Date.now() - fundingDate.getTime()) / (1000 * 60 * 60 * 24);

        // Only flag funding within the last 30 days
        if (daysSinceFunding <= 30) {
          const signalData = {
            company: company.company,
            companyDomain: domain,
            fundingType: properties.last_funding_type,
            fundingTotal: properties.funding_total?.value_usd,
            fundingDate: properties.last_funding_at,
            source: 'crunchbase',
          };

          signalDetectionQueries.insertSignal({
            type: 'funding',
            companyDomain: domain,
            data: signalData,
          });

          signals.push(signalData);
          console.log(`[FundingDetector] 💰 ${company.company}: ${properties.last_funding_type} funding detected`);
        }
      }

      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.error(`[FundingDetector] Crunchbase error for ${company.company}:`, err.message);
    }
  }

  return signals;
}

/**
 * Fallback: Detect funding via Google News RSS search
 */
async function detectViaNewsRSS(companies, signals) {
  for (const company of companies) {
    try {
      const query = encodeURIComponent(`"${company.company}" funding OR raised OR series`);
      const rssUrl = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;

      const res = await fetch(rssUrl, {
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) continue;

      const xml = await res.text();
      
      // Simple XML parsing for RSS items
      const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
      
      for (const item of items.slice(0, 3)) {
        const titleMatch = item.match(/<title>(.*?)<\/title>/);
        const pubDateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/);
        const linkMatch = item.match(/<link>(.*?)<\/link>/);

        if (!titleMatch) continue;

        const title = titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1');
        const pubDate = pubDateMatch ? new Date(pubDateMatch[1]) : new Date();
        const daysSincePublished = (Date.now() - pubDate.getTime()) / (1000 * 60 * 60 * 24);

        // Only consider articles from last 7 days
        if (daysSincePublished > 7) continue;

        // Check if title mentions funding keywords
        const fundingKeywords = ['raised', 'funding', 'series a', 'series b', 'series c', 'seed round', 'investment', 'million', 'billion'];
        const hasFundingKeyword = fundingKeywords.some(kw => title.toLowerCase().includes(kw));

        if (hasFundingKeyword) {
          const signalData = {
            company: company.company,
            companyDomain: company.company_domain,
            headline: title,
            publishedAt: pubDate.toISOString(),
            link: linkMatch ? linkMatch[1] : null,
            source: 'google_news',
          };

          signalDetectionQueries.insertSignal({
            type: 'funding',
            companyDomain: company.company_domain,
            data: signalData,
          });

          signals.push(signalData);
          console.log(`[FundingDetector] 💰 ${company.company}: "${title}"`);
          break; // One signal per company is enough
        }
      }

      await new Promise(r => setTimeout(r, 1000)); // Be nice to Google
    } catch (err) {
      // Timeouts and fetch errors are expected — skip silently
      if (err.name !== 'AbortError') {
        console.error(`[FundingDetector] News RSS error for ${company.company}:`, err.message);
      }
    }
  }

  return signals;
}

module.exports = { detect };
