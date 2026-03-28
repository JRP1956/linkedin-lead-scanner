/**
 * Apollo Sequences integration — push leads into automated email sequences.
 *
 * Uses the Apollo Engagement API to add contacts to email sequences.
 * Requires APOLLO_API_KEY with engagement/sequences permissions.
 */

const APOLLO_BASE_URL = 'https://api.apollo.io/v1';

const APOLLO_SEQUENCE_ERROR = 'APOLLO_SEQUENCE_ERROR';
const APOLLO_SEQUENCE_AUTH_FAILED = 'APOLLO_SEQUENCE_AUTH_FAILED';

/**
 * List all available email sequences from Apollo.
 * @returns {Promise<Array<{ id: string, name: string, active: boolean }>>}
 */
async function listSequences() {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    throw Object.assign(
      new Error('APOLLO_API_KEY not configured. Set it in .env to use sequences.'),
      { code: APOLLO_SEQUENCE_AUTH_FAILED }
    );
  }

  const res = await fetch(`${APOLLO_BASE_URL}/emailer_campaigns/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify({
      per_page: 50,
      sort_by_key: 'name',
    }),
  });

  if (res.status === 401 || res.status === 403) {
    throw Object.assign(
      new Error('Apollo authentication failed. Check your API key.'),
      { code: APOLLO_SEQUENCE_AUTH_FAILED }
    );
  }

  if (!res.ok) {
    const text = await res.text();
    throw Object.assign(
      new Error(`Failed to list Apollo sequences (${res.status}): ${text}`),
      { code: APOLLO_SEQUENCE_ERROR }
    );
  }

  const data = await res.json();
  const campaigns = data.emailer_campaigns || [];

  return campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    active: c.active || false,
    num_steps: c.emailer_steps?.length || 0,
  }));
}

/**
 * Add a contact to an Apollo email sequence.
 *
 * @param {{ email: string, firstName?: string, lastName?: string, sequenceId: string }} params
 * @returns {Promise<{ success: boolean, contactId?: string }>}
 */
async function addContactToSequence({ email, firstName, lastName, sequenceId }) {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    throw Object.assign(
      new Error('APOLLO_API_KEY not configured.'),
      { code: APOLLO_SEQUENCE_AUTH_FAILED }
    );
  }

  if (!email) {
    throw Object.assign(
      new Error('Cannot add to sequence: lead has no email address.'),
      { code: APOLLO_SEQUENCE_ERROR }
    );
  }

  if (!sequenceId) {
    throw Object.assign(
      new Error('No sequence ID provided.'),
      { code: APOLLO_SEQUENCE_ERROR }
    );
  }

  console.log(`[ApolloSequencer] Adding ${email} to sequence ${sequenceId}`);

  const res = await fetch(`${APOLLO_BASE_URL}/emailer_campaigns/${sequenceId}/add_contact_ids`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify({
      contact_ids: [], // Will be filled after creating/finding the contact
      emailer_campaign_id: sequenceId,
      send_email_from_email_account_id: '', // Uses default
      sequence_active_in_other_campaigns: false,
      // Apollo also supports adding by email directly via people match
    }),
  });

  // Apollo's preferred method: search for the contact first, then add by ID
  // Let's use the direct email-based approach via add_contact_to_campaign
  const directRes = await fetch(`${APOLLO_BASE_URL}/emailer_campaigns/${sequenceId}/add_contact_ids`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify({
      emails: [email],
      emailer_campaign_id: sequenceId,
    }),
  });

  if (directRes.status === 401 || directRes.status === 403) {
    throw Object.assign(
      new Error('Apollo authentication failed.'),
      { code: APOLLO_SEQUENCE_AUTH_FAILED }
    );
  }

  if (directRes.status === 422) {
    const text = await directRes.text();
    throw Object.assign(
      new Error(`Apollo rejected the request: ${text}`),
      { code: APOLLO_SEQUENCE_ERROR }
    );
  }

  if (!directRes.ok) {
    const text = await directRes.text();
    throw Object.assign(
      new Error(`Failed to add contact to sequence (${directRes.status}): ${text}`),
      { code: APOLLO_SEQUENCE_ERROR }
    );
  }

  const data = await directRes.json();
  console.log(`[ApolloSequencer] Successfully added ${email} to sequence ${sequenceId}`);

  return {
    success: true,
    contacts: data.contacts || [],
  };
}

module.exports = {
  listSequences,
  addContactToSequence,
  APOLLO_SEQUENCE_ERROR,
  APOLLO_SEQUENCE_AUTH_FAILED,
};
