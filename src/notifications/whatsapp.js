const config = require('../config');
const { logEvent } = require('../logging/decisionLog');

/**
 * Sends a WhatsApp text message via Meta's WhatsApp Cloud API — the same API
 * your whatsapp-ai-bot is already built on. Reuses the same credential shape
 * (a permanent system user token + phone number ID) so you can point this at
 * the same Meta app if you want, or register a second number for the bot's
 * alerts specifically.
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
 */
async function sendWhatsAppMessage(text) {
  const { accessToken, phoneNumberId, recipientNumber } = config.whatsapp;

  if (!accessToken || !phoneNumberId || !recipientNumber) {
    logEvent({ type: 'whatsapp_not_configured', wouldHaveSent: text });
    console.log('[WhatsApp not configured] Would have sent:', text);
    return;
  }

  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: recipientNumber,
        type: 'text',
        text: { body: text },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      logEvent({ type: 'whatsapp_send_failed', status: res.status, body: errBody });
    }
  } catch (err) {
    logEvent({ type: 'whatsapp_send_error', error: err.message });
  }
}

module.exports = { sendWhatsAppMessage };
