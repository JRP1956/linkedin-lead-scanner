/**
 * Slack notification client using Incoming Webhooks.
 *
 * If SLACK_WEBHOOK_URL is not set, all functions are silent no-ops.
 */

/**
 * Send a lead alert to Slack with the top 5 leads from a scan.
 *
 * @param {Array} leads - Array of lead objects (already sorted by score)
 * @param {string} postUrl - The LinkedIn post URL that was scanned
 */
async function sendLeadAlert(leads, postUrl) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  // If no webhook configured, silently skip
  if (!webhookUrl) {
    return;
  }

  const topLeads = leads.slice(0, 5);

  const leadLines = topLeads.map((lead, i) => {
    const name = lead.name || `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Unknown';
    const title = lead.title || 'No title';
    const company = lead.company || 'No company';
    const score = lead.total_score || lead.totalScore || 0;
    const tier = lead.intent_tier || lead.intentTier || 'N/A';
    return `${i + 1}. *${name}* — ${title} @ ${company} | Score: ${score} | ${tier}`;
  }).join('\n');

  // Construct the results page URL (assumes localhost, adjust for production)
  const port = process.env.PORT || 3001;
  const resultsUrl = `http://localhost:5173/results?postUrl=${encodeURIComponent(postUrl)}`;

  const message = {
    text: `🔍 *New LinkedIn Lead Scan Complete*`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🔍 New LinkedIn Lead Scan Complete',
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Source Post:* <${postUrl}|View on LinkedIn>\n*Total Leads Found:* ${leads.length}`,
        },
      },
      {
        type: 'divider',
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Top ${topLeads.length} Leads:*\n${leadLines}`,
        },
      },
      {
        type: 'divider',
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '📊 View All Results',
            },
            url: resultsUrl,
          },
        ],
      },
    ],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });

    if (!res.ok) {
      console.error(`[Slack] Webhook failed (${res.status}): ${await res.text()}`);
    } else {
      console.log(`[Slack] Lead alert sent successfully (${topLeads.length} leads)`);
    }
  } catch (err) {
    console.error('[Slack] Failed to send notification:', err.message);
  }
}

module.exports = { sendLeadAlert };
