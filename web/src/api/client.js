const API_BASE = '/api';
const TOKEN_KEY = 'authToken';

// ─── Auth ────────────────────────────────────────────────────────────────────

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable: stay logged in for this page only */ }
}

export function logout() {
  setToken(null);
  window.dispatchEvent(new Event('auth-required'));
}

/**
 * Every API call below goes through this: it attaches the login token and tells
 * the app to show the login screen when the server says 401.
 */
async function fetch(url, options = {}) {
  const token = getToken();
  const res = await window.fetch(url, {
    ...options,
    headers: { ...options.headers, ...(token && { Authorization: `Bearer ${token}` }) },
  });
  if (res.status === 401 && !url.startsWith(`${API_BASE}/auth/`)) {
    window.dispatchEvent(new Event('auth-required'));
  }
  return res;
}

export async function login(email, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error((await res.json()).message);
  const data = await res.json();
  setToken(data.token);
  return data.user;
}

// ─── Scans ───────────────────────────────────────────────────────────────────

/**
 * Start a scan job and return an EventSource for SSE streaming.
 */
export function startScan({ postUrl, outreachMode, icpProfile, includeReactions }) {
  return fetch(`${API_BASE}/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postUrl, outreachMode, icpProfile, includeReactions }),
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
 * Download the CSV export for a post (fetched with the login token, then saved).
 */
export async function downloadCsv(postUrl) {
  const res = await fetch(`${API_BASE}/leads/export-csv?postUrl=${encodeURIComponent(postUrl)}`);
  if (!res.ok) throw new Error((await res.json()).message);
  const filename = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || 'leads.csv';
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
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

// ─── Campaigns (Phase 1+3) ──────────────────────────────────────────────────

export async function createCampaign({ name, status, icpProfileId, description }) {
  const res = await fetch(`${API_BASE}/campaigns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, status, icpProfileId, description }),
  });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

export async function getCampaignById(id) {
  const res = await fetch(`${API_BASE}/campaigns/${id}`);
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

export async function updateCampaign(id, data) {
  const res = await fetch(`${API_BASE}/campaigns/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

export async function deleteCampaign(id) {
  const res = await fetch(`${API_BASE}/campaigns/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

export async function addCampaignVariant(campaignId, { name, messageTemplate, isControl }) {
  const res = await fetch(`${API_BASE}/campaigns/${campaignId}/variants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, messageTemplate, isControl }),
  });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

export async function assignLeadsToCampaign(campaignId, leadIds, variantId) {
  const res = await fetch(`${API_BASE}/campaigns/${campaignId}/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadIds, variantId }),
  });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

export async function getCampaignLeads(campaignId) {
  const res = await fetch(`${API_BASE}/campaigns/${campaignId}/leads`);
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

export async function getCampaignMetrics(campaignId) {
  const res = await fetch(`${API_BASE}/campaigns/${campaignId}/metrics`);
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

// ─── Analytics (Phase 4) ────────────────────────────────────────────────────

export async function getDashboardData() {
  const res = await fetch(`${API_BASE}/analytics/dashboard`);
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

export async function getCampaignAnalytics() {
  const res = await fetch(`${API_BASE}/analytics/campaigns`);
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

export async function getSignalAnalytics() {
  const res = await fetch(`${API_BASE}/analytics/signals`);
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

export async function getReplyRateAnalytics() {
  const res = await fetch(`${API_BASE}/analytics/reply-rates`);
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

export async function getPipelineAnalytics() {
  const res = await fetch(`${API_BASE}/analytics/pipeline`);
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

// ─── ICP Profiles (Phase 1) ─────────────────────────────────────────────────

export async function getICPProfilesDB() {
  const res = await fetch(`${API_BASE}/icp`);
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

export async function createICPProfile({ name, config }) {
  const res = await fetch(`${API_BASE}/icp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, config }),
  });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

export async function generateICPProfile({ productDescription, targetMarket, existingCustomers }) {
  const res = await fetch(`${API_BASE}/icp/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productDescription, targetMarket, existingCustomers }),
  });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

// ─── CSV Import (Phase 1) ───────────────────────────────────────────────────

export async function importCSV(file, postUrl) {
  const formData = new FormData();
  formData.append('file', file);
  if (postUrl) formData.append('postUrl', postUrl);
  const res = await fetch(`${API_BASE}/leads/import-csv`, { method: 'POST', body: formData });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

// ─── Webhooks (Phase 1) ─────────────────────────────────────────────────────

export async function getWebhooks() {
  const res = await fetch(`${API_BASE}/webhooks`);
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

export async function createWebhook({ url, eventTypes, secret }) {
  const res = await fetch(`${API_BASE}/webhooks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, eventTypes, secret }),
  });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

export async function deleteWebhook(id) {
  const res = await fetch(`${API_BASE}/webhooks/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

// ─── AI Tools (Phase 5) ─────────────────────────────────────────────────────

export async function analyzeMessage(message, context) {
  const res = await fetch(`${API_BASE}/tools/analyze-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, context }),
  });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

export async function generateContent({ topic, tone, audience, format }) {
  const res = await fetch(`${API_BASE}/tools/generate-content`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, tone, audience, format }),
  });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

// ─── Pipedrive (Phase 5) ────────────────────────────────────────────────────

export async function pushToPipedrive(id) {
  const res = await fetch(`${API_BASE}/leads/${id}/push-pipedrive`, { method: 'POST' });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

export async function pushBatchToPipedrive(leadIds) {
  const res = await fetch(`${API_BASE}/leads/push-pipedrive-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadIds }),
  });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

// ─── Signals (Phase 2) ──────────────────────────────────────────────────────

export async function getSignals({ type, limit } = {}) {
  const params = new URLSearchParams();
  if (type) params.set('type', type);
  if (limit) params.set('limit', limit);
  const res = await fetch(`${API_BASE}/signals?${params}`);
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

export async function getLeadSignals(id) {
  const res = await fetch(`${API_BASE}/leads/${id}/signals`);
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

// ─── Meetings (Phase 4) ─────────────────────────────────────────────────────

export async function recordMeeting({ leadId, campaignId, signalType, notes }) {
  const res = await fetch(`${API_BASE}/meetings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadId, campaignId, signalType, notes }),
  });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

// ─── Usage & Cost ────────────────────────────────────────────────────────────

export async function getUsage(days = 30) {
  const res = await fetch(`${API_BASE}/usage?days=${days}`);
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

// ─── Follow-up Review Queue ─────────────────────────────────────────────────

export async function getFollowUps() {
  const res = await fetch(`${API_BASE}/follow-ups`);
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

export async function updateFollowUp(id, message) {
  const res = await fetch(`${API_BASE}/follow-ups/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

export async function markFollowUpSent(id) {
  const res = await fetch(`${API_BASE}/follow-ups/${id}/sent`, { method: 'POST' });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

export async function skipFollowUp(id) {
  const res = await fetch(`${API_BASE}/follow-ups/${id}/skip`, { method: 'POST' });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

export async function startFollowUps(campaignId, leadIds) {
  const res = await fetch(`${API_BASE}/campaigns/${campaignId}/follow-ups/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadIds }),
  });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}
