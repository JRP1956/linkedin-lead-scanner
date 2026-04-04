const { getDb } = require('../db/queries');
const signalDetectionQueries = require('../db/signalDetectionQueries');

/**
 * Job Change Detector (A3)
 * 
 * Uses Apollo's People Search API to detect title/company changes
 * for monitored leads. Compares current title/company against stored values.
 */
async function detect() {
  if (!process.env.APOLLO_API_KEY) {
    console.log('[JobChangeDetector] APOLLO_API_KEY not set — skipping');
    return [];
  }

  const signals = [];

  // Get all leads that have been enriched (have title + company)
  const leads = getDb().prepare(`
    SELECT id, linkedin_url, name, title, company, company_domain
    FROM leads
    WHERE title IS NOT NULL AND company IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 100
  `).all();

  console.log(`[JobChangeDetector] Checking ${leads.length} leads for job changes`);

  for (const lead of leads) {
    try {
      // Query Apollo for current data
      const res = await fetch('https://api.apollo.io/v1/people/match', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': process.env.APOLLO_API_KEY,
        },
        body: JSON.stringify({
          linkedin_url: lead.linkedin_url,
        }),
      });

      if (res.status === 429) {
        console.warn('[JobChangeDetector] Rate limited — stopping batch');
        break;
      }

      if (!res.ok) continue;

      const data = await res.json();
      const person = data.person;
      if (!person) continue;

      const currentTitle = person.title || '';
      const currentCompany = person.organization?.name || '';

      // Detect title change
      const titleChanged = lead.title && currentTitle && 
        currentTitle.toLowerCase() !== lead.title.toLowerCase();
      
      // Detect company change
      const companyChanged = lead.company && currentCompany && 
        currentCompany.toLowerCase() !== lead.company.toLowerCase();

      if (titleChanged || companyChanged) {
        const signalData = {
          leadId: lead.id,
          leadName: lead.name,
          previousTitle: lead.title,
          currentTitle,
          previousCompany: lead.company,
          currentCompany,
          titleChanged,
          companyChanged,
        };

        signalDetectionQueries.insertSignal({
          type: 'job_change',
          leadId: lead.id,
          linkedinUrl: lead.linkedin_url,
          companyDomain: person.organization?.primary_domain,
          data: signalData,
        });

        // Update the lead with new data
        getDb().prepare(`
          UPDATE leads SET title = ?, company = ?, company_domain = COALESCE(?, company_domain)
          WHERE id = ?
        `).run(currentTitle, currentCompany, person.organization?.primary_domain, lead.id);

        signals.push(signalData);
        console.log(`[JobChangeDetector] 🔄 ${lead.name}: ${lead.title} @ ${lead.company} → ${currentTitle} @ ${currentCompany}`);
      }

      // Rate limit: 200ms between requests
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.error(`[JobChangeDetector] Error checking ${lead.name}:`, err.message);
    }
  }

  return signals;
}

module.exports = { detect };
