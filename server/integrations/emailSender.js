const nodemailer = require('nodemailer');

/**
 * Email Sender (D5)
 *
 * Direct email sending via SMTP (nodemailer).
 * Supports SendGrid and generic SMTP configurations.
 * Used as an alternative to Apollo sequences for users without Apollo.
 */

let transporter = null;

/**
 * Initialize the SMTP transporter.
 * Called lazily on first send attempt.
 */
function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT, 10) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.warn('[EmailSender] SMTP not configured — email sending unavailable');
    return null;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  console.log(`[EmailSender] SMTP configured: ${host}:${port}`);
  return transporter;
}

/**
 * Send a single email.
 *
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.text - Plain text body
 * @param {string} [options.html] - HTML body (optional)
 * @param {string} [options.from] - From address (defaults to SMTP_FROM env var)
 * @returns {Promise<Object>} Send result
 */
async function sendEmail({ to, subject, text, html, from }) {
  const mailer = getTransporter();
  if (!mailer) {
    throw Object.assign(new Error('SMTP not configured'), { code: 'SMTP_NOT_CONFIGURED' });
  }

  const fromAddr = from || process.env.SMTP_FROM || process.env.SMTP_USER;

  const timestamp = new Date().toISOString();
  console.log(`[EmailSender] ${timestamp} | Sending to: ${to} | Subject: ${subject}`);

  try {
    const info = await mailer.sendMail({
      from: fromAddr,
      to,
      subject,
      text,
      html: html || undefined,
    });

    console.log(`[EmailSender] ${timestamp} | Sent successfully: ${info.messageId}`);
    return {
      success: true,
      messageId: info.messageId,
      response: info.response,
    };
  } catch (err) {
    console.error(`[EmailSender] Error sending to ${to}:`, err.message);
    throw Object.assign(new Error(`Email send failed: ${err.message}`), { code: 'EMAIL_SEND_FAILED' });
  }
}

/**
 * Send emails to multiple recipients.
 *
 * @param {Array<Object>} emails - Array of { to, subject, text, html }
 * @param {number} [delayMs=1000] - Delay between sends
 * @returns {Promise<Object>} Batch result
 */
async function sendBatch(emails, delayMs = 1000) {
  let sent = 0;
  let failed = 0;
  const errors = [];

  for (const email of emails) {
    try {
      await sendEmail(email);
      sent++;
    } catch (err) {
      failed++;
      errors.push({ to: email.to, error: err.message });
    }

    if (delayMs > 0) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  return { sent, failed, errors };
}

module.exports = { sendEmail, sendBatch, getTransporter };
