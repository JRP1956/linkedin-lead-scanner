const API_BASE = '/api';

/**
 * Start a scan job and return an EventSource for SSE streaming.
 */
export function startScan({ postUrl, outreachMode, icpProfile }) {
  return fetch(`${API_BASE}/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postUrl, outreachMode, icpProfile }),
  });
}

/**
 * Get leads for a specific post URL.
 */
export async function getLeads(postUrl, { minScore = 0, sortBy = 'total_score', status } = {}) {
  const params = new URLSearchParams({ postUrl, minScore, sortBy });
  if (status) params.set('status', status);
  const res = await fetch(`${API_BASE}/leads?${params}`);
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

/**
 * Get a single lead by ID.
 */
export async function getLeadById(id) {
  const res = await fetch(`${API_BASE}/leads/${id}`);
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

/**
 * Update an outreach draft for a lead.
 */
export async function updateDraft(id, mode, content) {
  const res = await fetch(`${API_BASE}/leads/${id}/draft`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, content }),
  });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

/**
 * Push a single lead to HubSpot.
 */
export async function pushToHubspot(id) {
  const res = await fetch(`${API_BASE}/leads/${id}/push-hubspot`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

/**
 * Push multiple leads to HubSpot.
 */
export async function pushBatchToHubspot(leadIds) {
  const res = await fetch(`${API_BASE}/leads/push-hubspot-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadIds }),
  });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

/**
 * Get CSV export URL for a post.
 */
export function getExportCsvUrl(postUrl) {
  return `${API_BASE}/leads/export-csv?postUrl=${encodeURIComponent(postUrl)}`;
}

/**
 * Get all monitored accounts.
 */
export async function getMonitoredAccounts() {
  const res = await fetch(`${API_BASE}/monitor`);
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

/**
 * Add a new monitored account.
 */
export async function addMonitoredAccount({ linkedinProfileUrl, label, checkFrequencyHours }) {
  const res = await fetch(`${API_BASE}/monitor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ linkedinProfileUrl, label, checkFrequencyHours }),
  });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

/**
 * Delete a monitored account.
 */
export async function deleteMonitoredAccount(id) {
  const res = await fetch(`${API_BASE}/monitor/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

/**
 * Get available ICP profile names.
 */
export async function getIcpProfiles() {
  const res = await fetch(`${API_BASE}/icp-profiles`);
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

/**
 * Get available campaign names.
 */
export async function getCampaigns() {
  const res = await fetch(`${API_BASE}/campaigns`);
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

// ─── Suppression List ────────────────────────────────────────────────────────

export async function getSuppressionList({ reason, search } = {}) {
  const params = new URLSearchParams();
  if (reason) params.set('reason', reason);
  if (search) params.set('search', search);
  const res = await fetch(`${API_BASE}/suppression?${params}`);
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

export async function addToSuppressionList({ linkedinUrl, name, reason }) {
  const res = await fetch(`${API_BASE}/suppression`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ linkedinUrl, name, reason }),
  });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

export async function bulkImportSuppression(entries) {
  const res = await fetch(`${API_BASE}/suppression/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
  });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

export async function removeFromSuppressionList(id) {
  const res = await fetch(`${API_BASE}/suppression/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

// ─── Lead Status ─────────────────────────────────────────────────────────────

export async function updateLeadStatus(id, status) {
  const res = await fetch(`${API_BASE}/leads/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

export async function batchUpdateStatus(leadIds, status) {
  const res = await fetch(`${API_BASE}/leads/batch-status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadIds, status }),
  });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

export async function getLeadHistory(id) {
  const res = await fetch(`${API_BASE}/leads/${id}/history`);
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

export async function getFunnelStats() {
  const res = await fetch(`${API_BASE}/stats/funnel`);
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

// ─── Signal Stacking ─────────────────────────────────────────────────────────

export async function getLeadAppearances(id) {
  const res = await fetch(`${API_BASE}/leads/${id}/appearances`);
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

export async function getMultiSignalLeads(min = 2) {
  const res = await fetch(`${API_BASE}/leads/multi-signal?min=${min}`);
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

// ─── Apollo Sequences ────────────────────────────────────────────────────────

export async function getApolloSequences() {
  const res = await fetch(`${API_BASE}/apollo/sequences`);
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

export async function pushToApolloSequence(id, sequenceId) {
  const res = await fetch(`${API_BASE}/leads/${id}/push-apollo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sequenceId }),
  });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

export async function pushBatchToApolloSequence(leadIds, sequenceId) {
  const res = await fetch(`${API_BASE}/leads/push-apollo-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadIds, sequenceId }),
  });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}
