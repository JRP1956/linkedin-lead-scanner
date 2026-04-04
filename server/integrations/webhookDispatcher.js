const { getWebhooksForEvent } = require('../db/webhookQueries');

/**
 * Dispatch a webhook event to all registered webhook URLs for the given event type.
 *
 * Event types:
 * - lead.new — when a new lead is created
 * - lead.scored — when a lead's score is updated
 * - lead.status_changed — when a lead's status changes
 * - campaign.completed — when all leads in a campaign have been processed
 * - signal.detected — when a new signal is detected
 *
 * @param {string} eventType - The event type to dispatch
 * @param {Object} payload - The event payload
 */
async function dispatchEvent(eventType, payload) {
  try {
    const webhooks = getWebhooksForEvent(eventType);

    if (webhooks.length === 0) return;

    const eventPayload = {
      event: eventType,
      timestamp: new Date().toISOString(),
      data: payload,
    };

    const results = await Promise.allSettled(
      webhooks.map(async (webhook) => {
        const headers = {
          'Content-Type': 'application/json',
          'X-Webhook-Event': eventType,
        };

        // Add HMAC signature if secret is set
        if (webhook.secret) {
          const crypto = require('crypto');
          const signature = crypto
            .createHmac('sha256', webhook.secret)
            .update(JSON.stringify(eventPayload))
            .digest('hex');
          headers['X-Webhook-Signature'] = `sha256=${signature}`;
        }

        const res = await fetch(webhook.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(eventPayload),
          signal: AbortSignal.timeout(10000), // 10s timeout
        });

        if (!res.ok) {
          throw new Error(`Webhook ${webhook.url} returned ${res.status}`);
        }

        return { webhookId: webhook.id, status: 'delivered' };
      })
    );

    const delivered = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    if (failed > 0) {
      const errors = results
        .filter(r => r.status === 'rejected')
        .map(r => r.reason.message);
      console.warn(`[Webhook] ${eventType}: ${delivered} delivered, ${failed} failed:`, errors);
    } else if (delivered > 0) {
      console.log(`[Webhook] ${eventType}: ${delivered} delivered`);
    }
  } catch (err) {
    console.error(`[Webhook] Error dispatching ${eventType}:`, err.message);
  }
}

module.exports = { dispatchEvent };
