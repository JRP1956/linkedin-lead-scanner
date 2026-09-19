const { addToSuppressionList } = require('../db/suppressionQueries');

const HUBSPOT_AUTH_FAILED = 'HUBSPOT_AUTH_FAILED';
const HUBSPOT_DUPLICATE = 'HUBSPOT_DUPLICATE';

const HUBSPOT_BASE_URL = 'https://api.hubapi.com';

/**
 * Log the custom properties that must be created manually in HubSpot.
 * HubSpot doesn't allow API-created custom properties without admin scope,
 * so we guide the user to create them.
 */
function logCustomPropertyChecklist() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  HubSpot Custom Properties — Create These Before Pushing   ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  Internal Name       │ Label             │ Field Type       ║');
  console.log('╟──────────────────────┼───────────────────┼──────────────────╢');
  console.log('║  lead_score          │ Lead Score        │ Number           ║');
  console.log('║  intent_tier         │ Intent Tier       │ Single-line text ║');
  console.log('║  source_post_url     │ Source Post URL   │ Single-line text ║');
  console.log('║  comment_text        │ LinkedIn Comment  │ Multi-line text  ║');
  console.log('║  outreach_draft      │ Outreach Draft    │ Multi-line text  ║');
  console.log('║  data_confidence     │ Data Confidence   │ Single-line text ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('  Go to: HubSpot → Settings → Properties → Create property\n');
}

/**
 * Search for an existing HubSpot contact by email.
 *
 * @param {string} email - Email to search for
 * @returns {Promise<string|null>} HubSpot contact ID if found, null otherwise
 */
async function searchContactByEmail(email) {
  if (!email) return null;

  const res = await fetch(`${HUBSPOT_BASE_URL}/crm/v3/objects/contacts/search`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [
            {
              propertyName: 'email',
              operator: 'EQ',
              value: email,
            },
          ],
        },
      ],
    }),
  });

  if (res.status === 401) {
    const err = new Error('HubSpot authentication failed. Check your access token.');
    err.code = HUBSPOT_AUTH_FAILED;
    throw err;
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot search failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  if (data.results && data.results.length > 0) {
    return data.results[0].id;
  }
  return null;
}

/**
 * Create or update a HubSpot contact.
 * First searches by email to avoid duplicates. If found, updates. If not, creates.
 *
 * @param {Object} lead - Lead data from the database
 * @returns {Promise<string>} HubSpot contact ID
 */
async function createOrUpdateContact(lead) {
  const properties = {
    firstname: lead.first_name || lead.firstName || '',
    lastname: lead.last_name || lead.lastName || '',
    email: lead.email || '',
    jobtitle: lead.title || '',
    company: lead.company || '',
    lead_score: lead.total_score || lead.totalScore || 0,
    intent_tier: lead.intent_tier || lead.intentTier || '',
    source_post_url: lead.post_url || lead.postUrl || '',
    comment_text: lead.comment_text || lead.commentText || '',
    outreach_draft: lead.outreach_draft_direct || lead.outreachDraftDirect || '',
    data_confidence: lead.data_confidence || lead.dataConfidence || '',
    lead_source: 'LinkedIn Comment Scanner',
  };

  // Search for existing contact to avoid duplicates
  const existingId = await searchContactByEmail(lead.email);

  if (existingId) {
    // Update existing contact
    console.log(`[HubSpot] Updating existing contact ${existingId} (${lead.email})`);
    const res = await fetch(`${HUBSPOT_BASE_URL}/crm/v3/objects/contacts/${existingId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ properties }),
    });

    if (res.status === 401) {
      const err = new Error('HubSpot authentication failed. Check your access token.');
      err.code = HUBSPOT_AUTH_FAILED;
      throw err;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HubSpot update failed (${res.status}): ${text}`);
    }

    // Auto-add to suppression list
    const linkedinUrl = lead.linkedin_url || lead.linkedinUrl;
    if (linkedinUrl) {
      addToSuppressionList({
        linkedinUrl,
        name: lead.name || `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
        reason: 'in_pipeline',
        source: 'hubspot_push',
      });
    }

    return existingId;
  }

  // Create new contact
  console.log(`[HubSpot] Creating new contact: ${lead.email || lead.name}`);
  const res = await fetch(`${HUBSPOT_BASE_URL}/crm/v3/objects/contacts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ properties }),
  });

  if (res.status === 401) {
    const err = new Error('HubSpot authentication failed. Check your access token.');
    err.code = HUBSPOT_AUTH_FAILED;
    throw err;
  }

  if (res.status === 409) {
    // Duplicate — this shouldn't happen if search worked, but handle gracefully
    console.warn('[HubSpot] Duplicate contact detected, attempting to find and update...');
    const retryId = await searchContactByEmail(lead.email);
    if (retryId) return retryId;
    throw new Error('HubSpot duplicate contact but could not find existing record');
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot create failed (${res.status}): ${text}`);
  }

  const data = await res.json();

  // Auto-add to suppression list on new contact creation
  const linkedinUrl = lead.linkedin_url || lead.linkedinUrl;
  if (linkedinUrl) {
    addToSuppressionList({
      linkedinUrl,
      name: lead.name || `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
      reason: 'in_pipeline',
      source: 'hubspot_push',
    });
  }

  return data.id;
}

module.exports = {
  createOrUpdateContact,
  logCustomPropertyChecklist,
};
