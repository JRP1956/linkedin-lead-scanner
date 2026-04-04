/**
 * Pipedrive Client (G2)
 *
 * Create/update Pipedrive persons and deals.
 * Follows the same graceful degradation pattern as HubSpot client.
 */

const PIPEDRIVE_BASE = 'https://api.pipedrive.com/v1';

function getApiToken() {
  return process.env.PIPEDRIVE_API_TOKEN;
}

/**
 * Create or update a person in Pipedrive.
 *
 * @param {Object} lead - Lead data
 * @returns {Promise<Object>} Pipedrive person data
 */
async function createOrUpdatePerson(lead) {
  const token = getApiToken();
  if (!token) {
    const err = new Error('PIPEDRIVE_API_TOKEN not configured');
    err.code = 'PIPEDRIVE_NOT_CONFIGURED';
    throw err;
  }

  // Search for existing person by email
  if (lead.email) {
    try {
      const searchRes = await fetch(
        `${PIPEDRIVE_BASE}/persons/search?term=${encodeURIComponent(lead.email)}&fields=email&api_token=${token}`
      );
      const searchData = await searchRes.json();

      if (searchData.data?.items?.length > 0) {
        const existingId = searchData.data.items[0].item.id;
        // Update existing person
        return await updatePerson(existingId, lead, token);
      }
    } catch (err) {
      console.warn(`[Pipedrive] Search error: ${err.message}`);
    }
  }

  // Create new person
  const personData = {
    name: lead.name || `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
    email: lead.email ? [{ value: lead.email, primary: true }] : undefined,
    phone: lead.phone ? [{ value: lead.phone, primary: true }] : undefined,
    org_id: null, // Would need org lookup
  };

  // Add custom fields
  const res = await fetch(`${PIPEDRIVE_BASE}/persons?api_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(personData),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(`Pipedrive API error: ${errData.error || res.statusText}`);
  }

  const data = await res.json();
  console.log(`[Pipedrive] Created person: ${personData.name} (ID: ${data.data.id})`);
  return data.data;
}

/**
 * Update an existing person.
 */
async function updatePerson(personId, lead, token) {
  const updateData = {
    name: lead.name || undefined,
    email: lead.email ? [{ value: lead.email, primary: true }] : undefined,
    phone: lead.phone ? [{ value: lead.phone, primary: true }] : undefined,
  };

  const res = await fetch(`${PIPEDRIVE_BASE}/persons/${personId}?api_token=${token}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updateData),
  });

  if (!res.ok) {
    throw new Error(`Pipedrive update error: ${res.statusText}`);
  }

  const data = await res.json();
  console.log(`[Pipedrive] Updated person: ${lead.name} (ID: ${personId})`);
  return data.data;
}

/**
 * Create a deal in Pipedrive associated with a person.
 */
async function createDeal({ personId, title, value, currency = 'USD' }) {
  const token = getApiToken();
  if (!token) {
    throw Object.assign(new Error('PIPEDRIVE_API_TOKEN not configured'), { code: 'PIPEDRIVE_NOT_CONFIGURED' });
  }

  const res = await fetch(`${PIPEDRIVE_BASE}/deals?api_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: title || 'LinkedIn Lead',
      person_id: personId,
      value: value || 0,
      currency,
      status: 'open',
    }),
  });

  if (!res.ok) {
    throw new Error(`Pipedrive deal creation error: ${res.statusText}`);
  }

  const data = await res.json();
  console.log(`[Pipedrive] Created deal: ${title} (ID: ${data.data.id})`);
  return data.data;
}

module.exports = { createOrUpdatePerson, createDeal };
