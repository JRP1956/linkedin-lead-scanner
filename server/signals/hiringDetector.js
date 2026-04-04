const { getDb } = require('../db/queries');
const signalDetectionQueries = require('../db/signalDetectionQueries');

/**
 * Hiring Spike Detector (A6)
 *
 * Uses Apollo's company search to check estimated_num_employees changes over time.
 * Flags companies with >10% headcount growth as hiring spikes.
 */
async function detect() {
  if (!process.env.APOLLO_API_KEY) {
    console.log('[HiringDetector] APOLLO_API_KEY not set — skipping');
    return [];
  }

  const signals = [];

  // Get unique company domains from leads
  const companies = getDb().prepare(`
    SELECT DISTINCT company_domain, company
    FROM leads
    WHERE company_domain IS NOT NULL AND company_domain != ''
    ORDER BY created_at DESC
    LIMIT 50
  `).all();

  console.log(`[HiringDetector] Checking ${companies.length} companies for hiring spikes`);

  for (const company of companies) {
    try {
      // Get current headcount from Apollo
      const res = await fetch('https://api.apollo.io/v1/organizations/enrich', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': process.env.APOLLO_API_KEY,
        },
      });

      // Use domain-based enrichment
      const enrichRes = await fetch(`https://api.apollo.io/v1/organizations/enrich?domain=${company.company_domain}`, {
        headers: { 'X-Api-Key': process.env.APOLLO_API_KEY },
      });

      if (enrichRes.status === 429) {
        console.warn('[HiringDetector] Rate limited — stopping batch');
        break;
      }

      if (!enrichRes.ok) continue;

      const data = await enrichRes.json();
      const org = data.organization;
      if (!org || !org.estimated_num_employees) continue;

      const currentHeadcount = org.estimated_num_employees;

      // Get previous headcount from history
      const previousSnapshot = signalDetectionQueries.getLatestHeadcount(company.company_domain);

      // Store current snapshot
      signalDetectionQueries.insertHeadcountSnapshot({
        companyDomain: company.company_domain,
        companyName: company.company,
        headcount: currentHeadcount,
      });

      if (previousSnapshot) {
        const previousHeadcount = previousSnapshot.headcount;
        const growthRate = (currentHeadcount - previousHeadcount) / previousHeadcount;

        // Flag >10% growth
        if (growthRate > 0.10) {
          const signalData = {
            company: company.company,
            companyDomain: company.company_domain,
            previousHeadcount,
            currentHeadcount,
            growthRate: (growthRate * 100).toFixed(1) + '%',
            previousCheckDate: previousSnapshot.checked_at,
          };

          signalDetectionQueries.insertSignal({
            type: 'hiring_spike',
            companyDomain: company.company_domain,
            data: signalData,
          });

          signals.push(signalData);
          console.log(`[HiringDetector] 📈 ${company.company}: ${previousHeadcount} → ${currentHeadcount} (${signalData.growthRate} growth)`);
        }
      }

      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.error(`[HiringDetector] Error checking ${company.company}:`, err.message);
    }
  }

  return signals;
}

module.exports = { detect };
