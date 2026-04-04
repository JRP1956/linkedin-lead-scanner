const { getDb } = require('./queries');

// ─── Webhook CRUD ───────────────────────────────────────────────────────────

function createWebhook({ url, eventTypes, secret }) {
  const stmt = getDb().prepare(`
    INSERT INTO webhooks (url, event_types, secret)
    VALUES (?, ?, ?)
  `);
  const types = Array.isArray(eventTypes) ? eventTypes.join(',') : eventTypes;
  const result = stmt.run(url, types, secret || null);
  return getWebhookById(result.lastInsertRowid);
}

function getWebhookById(id) {
  const webhook = getDb().prepare('SELECT * FROM webhooks WHERE id = ?').get(id);
  if (webhook) {
    webhook.event_types_array = webhook.event_types.split(',').map(t => t.trim());
  }
  return webhook;
}

function getAllWebhooks() {
  const webhooks = getDb().prepare('SELECT * FROM webhooks ORDER BY created_at DESC').all();
  return webhooks.map(w => ({
    ...w,
    event_types_array: w.event_types.split(',').map(t => t.trim()),
  }));
}

function deleteWebhook(id) {
  return getDb().prepare('DELETE FROM webhooks WHERE id = ?').run(id);
}

function toggleWebhook(id, active) {
  return getDb().prepare('UPDATE webhooks SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
}

function getWebhooksForEvent(eventType) {
  const all = getDb().prepare('SELECT * FROM webhooks WHERE active = 1').all();
  return all.filter(w => {
    const types = w.event_types.split(',').map(t => t.trim());
    return types.includes(eventType) || types.includes('*');
  });
}

module.exports = {
  createWebhook,
  getWebhookById,
  getAllWebhooks,
  deleteWebhook,
  toggleWebhook,
  getWebhooksForEvent,
};
