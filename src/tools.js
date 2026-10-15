// Tool definitions the Claude agent can call.
//
// Read tools run immediately. Write tools that reach the outside world (SMS,
// social posts) never execute here: they create a pending approval instead.
import { narrateBrief } from "./businesses.js";
import { syncBusiness } from "./sync.js";

const HOUR_MS = 60 * 60 * 1000;

export function buildTools({ directory, approvals, connectorsFor, defaultConnectors }) {
  // Connectors for a named business, falling back to the app's own credentials
  // when no business is named (the owner's own accounts).
  async function connectorsForBusiness(businessName) {
    if (!businessName) return { connectors: defaultConnectors, business: null };
    const business = await directory.resolve(businessName);
    let credentials = {};
    try {
      credentials = await directory.credentials(business.id);
    } catch {
      credentials = {};
    }
    return { connectors: connectorsFor(credentials), business };
  }

  const BUSINESS_ARG = {
    type: "string",
    description: "Business name. Omit to use your own connected accounts.",
  };

  const definitions = [
    {
      name: "list_businesses",
      description: "List the businesses under management.",
      input_schema: { type: "object", properties: {} },
      run: () => directory.list(),
    },
    {
      name: "add_business",
      description: "Create a business (a client workspace) so it can be tracked and briefed.",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          kind: { type: "string", enum: ["agency", "freelancer", "shopify", "other"] },
        },
        required: ["name"],
      },
      run: (input) => directory.add(input),
    },
    {
      name: "business_brief",
      description:
        "Everything happening in one business: recent activity, what changed, and what is waiting for approval. Use this for questions like 'what is going on with Acme' or 'catch me up'.",
      input_schema: {
        type: "object",
        properties: {
          business: { type: "string", description: "Business name." },
          hours: { type: "integer", minimum: 1, maximum: 720, description: "How far back to look. Default 24." },
        },
        required: ["business"],
      },
      run: async ({ business, hours = 24 }) => {
        const since = new Date(Date.now() - hours * HOUR_MS).toISOString();
        const brief = await directory.brief(business, since);
        return { spoken: narrateBrief(brief), ...brief };
      },
    },
    {
      name: "sync_business",
      description:
        "Read a business's connected accounts right now and record anything new, so the brief is up to date.",
      input_schema: {
        type: "object",
        properties: { business: { type: "string" } },
        required: ["business"],
      },
      run: async ({ business }) => {
        const resolved = await directory.resolve(business);
        return syncBusiness({ directory, business: resolved, connectorsFor });
      },
    },
    {
      name: "record_note",
      description:
        "Record something that happened in a business so it shows up in the brief, for example a phone call or a decision.",
      input_schema: {
        type: "object",
        properties: {
          business: { type: "string" },
          summary: { type: "string" },
          kind: { type: "string", description: "Short label, e.g. call, meeting, issue. Default note." },
        },
        required: ["business", "summary"],
      },
      run: async ({ business, summary, kind = "note" }) => {
        const resolved = await directory.resolve(business);
        return directory.record({ businessId: resolved.id, source: "manual", kind, summary, detail: {} });
      },
    },
    {
      name: "list_unread_emails",
      description: "List recent unread emails.",
      input_schema: {
        type: "object",
        properties: { business: BUSINESS_ARG, limit: { type: "integer", minimum: 1, maximum: 25 } },
      },
      run: async ({ business, limit }) => {
        const { connectors } = await connectorsForBusiness(business);
        return connectors.listUnreadEmails({ limit });
      },
    },
    {
      name: "list_recent_orders",
      description: "List recent Shopify orders.",
      input_schema: {
        type: "object",
        properties: { business: BUSINESS_ARG, limit: { type: "integer", minimum: 1, maximum: 25 } },
      },
      run: async ({ business, limit }) => {
        const { connectors } = await connectorsForBusiness(business);
        return connectors.recentOrders({ limit });
      },
    },
    {
      name: "list_pending_approvals",
      description: "Show actions waiting for the user's approval.",
      input_schema: { type: "object", properties: { business: BUSINESS_ARG } },
      run: async ({ business }) => {
        const resolved = business ? await directory.resolve(business) : null;
        return approvals.list("pending", resolved?.id);
      },
    },
    {
      name: "propose_sms",
      description:
        "Draft an SMS to a GoHighLevel contact. Does NOT send. The user must approve it before it is sent.",
      input_schema: {
        type: "object",
        properties: {
          business: BUSINESS_ARG,
          contactId: { type: "string", description: "GoHighLevel contact ID" },
          message: { type: "string" },
        },
        required: ["contactId", "message"],
      },
      run: async ({ business, contactId, message }) => {
        const resolved = business ? await directory.resolve(business) : null;
        return approvals.propose({
          action: "send_sms",
          businessId: resolved?.id ?? null,
          summary: `SMS${resolved ? ` (${resolved.name})` : ""} to contact ${contactId}: "${message}"`,
          payload: { contactId, message, businessId: resolved?.id ?? null },
        });
      },
    },
    {
      name: "propose_social_post",
      description:
        "Draft a social media post for one or more platforms. Does NOT publish. The user must approve it first.",
      input_schema: {
        type: "object",
        properties: {
          business: BUSINESS_ARG,
          platforms: {
            type: "array",
            items: { type: "string", enum: ["instagram", "facebook", "linkedin", "x", "tiktok"] },
          },
          text: { type: "string" },
          scheduledAt: { type: "string", description: "ISO 8601 time, optional" },
        },
        required: ["platforms", "text"],
      },
      run: async ({ business, platforms, text, scheduledAt }) => {
        const resolved = business ? await directory.resolve(business) : null;
        return approvals.propose({
          action: "publish_post",
          businessId: resolved?.id ?? null,
          summary: `Post${resolved ? ` (${resolved.name})` : ""} to ${platforms.join(", ")}: "${text.slice(0, 80)}"`,
          payload: { platforms, text, scheduledAt, businessId: resolved?.id ?? null },
        });
      },
    },
  ];

  const byName = new Map(definitions.map((d) => [d.name, d]));

  return {
    // What goes to the Claude API: no handlers.
    schemas: definitions.map(({ name, description, input_schema }) => ({ name, description, input_schema })),

    async call(name, input) {
      const tool = byName.get(name);
      if (!tool) return { error: `Unknown tool ${name}` };
      try {
        return await tool.run(input ?? {});
      } catch (err) {
        return { error: err.message };
      }
    },
  };
}

// Maps an approved queue item to the real side effect, using the credentials of
// whichever business the item belongs to.
export function executorFor({ directory, connectorsFor, defaultConnectors }) {
  return async (item) => {
    const businessId = item.businessId ?? item.payload?.businessId ?? null;
    let connectors = defaultConnectors;
    if (businessId) {
      let credentials = {};
      try {
        credentials = await directory.credentials(businessId);
      } catch {
        credentials = {};
      }
      connectors = connectorsFor(credentials);
    }

    switch (item.action) {
      case "send_sms":
        return connectors.sendSms(item.payload);
      case "publish_post":
        return connectors.publishPost(item.payload);
      default:
        throw new Error(`No executor for action ${item.action}`);
    }
  };
}
