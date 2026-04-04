/**
 * Proxycurl Client (C3)
 *
 * Optional deep LinkedIn profile enrichment using Proxycurl API.
 * Fetches: headline, summary, connections count, education, experience.
 * Gracefully skips if PROXYCURL_API_KEY is not set.
 */

const PROXYCURL_BASE = 'https://nubela.co/proxycurl/api/v2';

/**
 * Enrich a LinkedIn profile using Proxycurl.
 *
 * @param {string} linkedinUrl - LinkedIn profile URL
 * @returns {Object|null} Enriched profile data or null if skipped/failed
 */
async function enrichProfile(linkedinUrl) {
  if (!process.env.PROXYCURL_API_KEY) {
    return null;
  }

  const timestamp = new Date().toISOString();
  console.log(`[Proxycurl] ${timestamp} | Enriching: ${linkedinUrl}`);

  try {
    const res = await fetch(
      `${PROXYCURL_BASE}/linkedin?url=${encodeURIComponent(linkedinUrl)}&skills=skip&inferred_salary=skip&personal_email=skip&personal_contact_number=skip`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PROXYCURL_API_KEY}`,
        },
        signal: AbortSignal.timeout(15000),
      }
    );

    if (res.status === 429) {
      console.warn('[Proxycurl] Rate limited (429) — skipping');
      return null;
    }

    if (res.status === 404) {
      console.log(`[Proxycurl] Profile not found: ${linkedinUrl}`);
      return null;
    }

    if (!res.ok) {
      console.error(`[Proxycurl] HTTP ${res.status}: ${await res.text()}`);
      return null;
    }

    const profile = await res.json();

    const result = {
      headline: profile.headline || null,
      summary: profile.summary || null,
      connections: profile.connections || null,
      country: profile.country_full_name || null,
      city: profile.city || null,
      education: (profile.education || []).map(edu => ({
        school: edu.school,
        degree: edu.degree_name,
        field: edu.field_of_study,
        startYear: edu.starts_at?.year,
        endYear: edu.ends_at?.year,
      })),
      experience: (profile.experiences || []).slice(0, 5).map(exp => ({
        title: exp.title,
        company: exp.company,
        startDate: exp.starts_at ? `${exp.starts_at.year}-${String(exp.starts_at.month || 1).padStart(2, '0')}` : null,
        endDate: exp.ends_at ? `${exp.ends_at.year}-${String(exp.ends_at.month || 1).padStart(2, '0')}` : 'Present',
        description: exp.description?.substring(0, 200),
      })),
      languages: profile.languages || [],
      certifications: (profile.certifications || []).map(c => c.name),
    };

    console.log(
      `[Proxycurl] ${timestamp} | Enriched: ${profile.first_name} ${profile.last_name} | ` +
      `Headline: ${result.headline ? 'yes' : 'no'} | Connections: ${result.connections || 'unknown'}`
    );

    return result;
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn(`[Proxycurl] Timeout enriching ${linkedinUrl}`);
    } else {
      console.error(`[Proxycurl] Error enriching ${linkedinUrl}:`, err.message);
    }
    return null;
  }
}

module.exports = { enrichProfile };
