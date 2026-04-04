const { getDb } = require('../db/queries');

/**
 * Parse a CSV string and import leads into the database.
 *
 * @param {string} csvContent - Raw CSV file content
 * @param {Object} [options]
 * @param {Object} [options.columnMap] - Custom column name mapping { csvHeader: dbField }
 * @param {string} [options.postUrl] - Optional post URL to associate imported leads with
 * @returns {{ imported: number, skipped: number, errors: Array }}
 */
function importCSV(csvContent, options = {}) {
  const { columnMap = {}, postUrl = 'csv-import' } = options;

  const lines = csvContent.split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) {
    return { imported: 0, skipped: 0, errors: ['CSV must have a header row and at least one data row'] };
  }

  const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase());

  // Default column mapping — maps common CSV header names to DB field names
  const defaultMap = {
    'linkedin_url': 'linkedin_url',
    'linkedin url': 'linkedin_url',
    'linkedinurl': 'linkedin_url',
    'linkedin': 'linkedin_url',
    'profile_url': 'linkedin_url',
    'profile url': 'linkedin_url',
    'name': 'name',
    'full_name': 'name',
    'full name': 'name',
    'first_name': 'first_name',
    'first name': 'first_name',
    'firstname': 'first_name',
    'last_name': 'last_name',
    'last name': 'last_name',
    'lastname': 'last_name',
    'title': 'title',
    'job_title': 'title',
    'job title': 'title',
    'company': 'company',
    'company_name': 'company',
    'company name': 'company',
    'organization': 'company',
    'email': 'email',
    'email_address': 'email',
    'email address': 'email',
    'industry': 'industry',
    'headcount': 'headcount_range',
    'headcount_range': 'headcount_range',
    'company_size': 'headcount_range',
    'company size': 'headcount_range',
    'employees': 'headcount_range',
    'revenue': 'estimated_revenue',
    'estimated_revenue': 'estimated_revenue',
    'annual_revenue': 'estimated_revenue',
    'funding': 'funding_stage',
    'funding_stage': 'funding_stage',
    'funding stage': 'funding_stage',
    'phone': 'phone',
    'phone_number': 'phone',
    'phone number': 'phone',
    'company_domain': 'company_domain',
    'domain': 'company_domain',
    'website': 'company_domain',
  };

  // Merge custom map over defaults
  const finalMap = { ...defaultMap, ...columnMap };

  // Map CSV headers to DB fields
  const headerMapping = headers.map(h => finalMap[h] || null);

  // Check we have a linkedin_url column
  if (!headerMapping.includes('linkedin_url')) {
    return {
      imported: 0,
      skipped: 0,
      errors: ['CSV must contain a LinkedIn URL column (accepted headers: linkedin_url, linkedin, profile_url)'],
    };
  }

  const stmt = getDb().prepare(`
    INSERT INTO leads (
      post_url, linkedin_url, name, first_name, last_name, title, company,
      company_domain, email, headcount_range, estimated_revenue, industry,
      funding_stage
    ) VALUES (
      @post_url, @linkedin_url, @name, @first_name, @last_name, @title, @company,
      @company_domain, @email, @headcount_range, @estimated_revenue, @industry,
      @funding_stage
    )
    ON CONFLICT(linkedin_url) DO UPDATE SET
      name = COALESCE(excluded.name, leads.name),
      first_name = COALESCE(excluded.first_name, leads.first_name),
      last_name = COALESCE(excluded.last_name, leads.last_name),
      title = COALESCE(excluded.title, leads.title),
      company = COALESCE(excluded.company, leads.company),
      company_domain = COALESCE(excluded.company_domain, leads.company_domain),
      email = COALESCE(excluded.email, leads.email),
      headcount_range = COALESCE(excluded.headcount_range, leads.headcount_range),
      estimated_revenue = COALESCE(excluded.estimated_revenue, leads.estimated_revenue),
      industry = COALESCE(excluded.industry, leads.industry),
      funding_stage = COALESCE(excluded.funding_stage, leads.funding_stage)
  `);

  let imported = 0;
  let skipped = 0;
  const errors = [];

  const importTransaction = getDb().transaction(() => {
    for (let i = 1; i < lines.length; i++) {
      try {
        const values = parseCSVLine(lines[i]);
        const row = {};

        for (let j = 0; j < headers.length; j++) {
          const dbField = headerMapping[j];
          if (dbField && values[j]) {
            row[dbField] = values[j].trim();
          }
        }

        if (!row.linkedin_url) {
          skipped++;
          continue;
        }

        // Ensure linkedin_url looks valid
        if (!row.linkedin_url.includes('linkedin.com')) {
          skipped++;
          errors.push(`Row ${i + 1}: Invalid LinkedIn URL: ${row.linkedin_url}`);
          continue;
        }

        // Auto-generate name from first + last if not provided
        if (!row.name && (row.first_name || row.last_name)) {
          row.name = `${row.first_name || ''} ${row.last_name || ''}`.trim();
        }

        stmt.run({
          post_url: postUrl,
          linkedin_url: row.linkedin_url,
          name: row.name || null,
          first_name: row.first_name || null,
          last_name: row.last_name || null,
          title: row.title || null,
          company: row.company || null,
          company_domain: row.company_domain || null,
          email: row.email || null,
          headcount_range: row.headcount_range || null,
          estimated_revenue: row.estimated_revenue || null,
          industry: row.industry || null,
          funding_stage: row.funding_stage || null,
        });

        imported++;
      } catch (err) {
        skipped++;
        errors.push(`Row ${i + 1}: ${err.message}`);
      }
    }
  });

  importTransaction();

  console.log(`[CSVImporter] Imported ${imported}, skipped ${skipped}, errors: ${errors.length}`);
  return { imported, skipped, errors: errors.slice(0, 20) }; // Cap error list
}

/**
 * Parse a single CSV line, handling quoted fields with commas.
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        current += '"';
        i++; // skip escaped quote
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
  }

  result.push(current);
  return result;
}

module.exports = { importCSV, parseCSVLine };
