// Connectors to outside services. Each one runs in mock mode until its
// credentials are present in the environment, so the app works end to end
// before any real account is connected.

const GHL_BASE = "https://services.leadconnectorhq.com";

export function createConnectors(env = process.env, fetchImpl = fetch) {
  return {
    status() {
      return {
        gohighlevel: Boolean(env.GHL_API_KEY),
        gmail: Boolean(env.GMAIL_REFRESH_TOKEN),
        shopify: Boolean(env.SHOPIFY_ACCESS_TOKEN && env.SHOPIFY_STORE_DOMAIN),
        social: Boolean(env.SOCIAL_API_KEY),
      };
    },

    // ----- GoHighLevel: SMS -------------------------------------------------
    async sendSms({ contactId, message }) {
      if (!env.GHL_API_KEY) {
        return { mock: true, note: "GHL not connected; SMS not sent", contactId, message };
      }
      const res = await fetchImpl(`${GHL_BASE}/conversations/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.GHL_API_KEY}`,
          Version: "2021-04-15",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ type: "SMS", contactId, message }),
      });
      if (!res.ok) throw new Error(`GHL SMS failed: ${res.status} ${await res.text()}`);
      return res.json();
    },

    // ----- Gmail ------------------------------------------------------------
    async listUnreadEmails({ limit = 10 } = {}) {
      if (!env.GMAIL_REFRESH_TOKEN) {
        return {
          mock: true,
          note: "Gmail not connected",
          messages: [
            { id: "mock-1", from: "client@example.com", subject: "Quick question on the proposal", snippet: "Can we move the call to Thursday?" },
          ].slice(0, limit),
        };
      }
      // Real Gmail OAuth + messages.list lands once credentials are provided.
      throw new Error("Gmail live mode not implemented yet");
    },

    // ----- Shopify ----------------------------------------------------------
    async recentOrders({ limit = 5 } = {}) {
      if (!env.SHOPIFY_ACCESS_TOKEN) {
        return { mock: true, note: "Shopify not connected", orders: [] };
      }
      const url = `https://${env.SHOPIFY_STORE_DOMAIN}/admin/api/2025-01/orders.json?status=any&limit=${limit}`;
      const res = await fetchImpl(url, {
        headers: { "X-Shopify-Access-Token": env.SHOPIFY_ACCESS_TOKEN },
      });
      if (!res.ok) throw new Error(`Shopify failed: ${res.status}`);
      return res.json();
    },

    // ----- Social publishing -----------------------------------------------
    async publishPost({ platforms, text, scheduledAt }) {
      if (!env.SOCIAL_API_KEY) {
        return { mock: true, note: "Social not connected; post not published", platforms, text, scheduledAt };
      }
      // Provider call (e.g. Ayrshare / Buffer / Meta Graph) goes here once keys are provided.
      throw new Error("Social live mode not implemented yet");
    },
  };
}
