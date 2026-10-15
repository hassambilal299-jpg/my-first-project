// Tool definitions the Claude agent can call. Read tools run immediately.
// Write tools (send, publish) are queued for approval instead of executing.

export function buildTools({ connectors, approvals }) {
  const definitions = [
    {
      name: "list_unread_emails",
      description: "List recent unread emails from Gmail.",
      input_schema: {
        type: "object",
        properties: { limit: { type: "integer", minimum: 1, maximum: 25 } },
      },
      readOnly: true,
      run: (input) => connectors.listUnreadEmails(input),
    },
    {
      name: "list_recent_orders",
      description: "List recent Shopify orders.",
      input_schema: {
        type: "object",
        properties: { limit: { type: "integer", minimum: 1, maximum: 25 } },
      },
      readOnly: true,
      run: (input) => connectors.recentOrders(input),
    },
    {
      name: "list_pending_approvals",
      description: "Show actions waiting for the user's approval.",
      input_schema: { type: "object", properties: {} },
      readOnly: true,
      run: () => approvals.list("pending"),
    },
    {
      name: "propose_sms",
      description:
        "Draft an SMS to a GoHighLevel contact. Does NOT send. The user must approve it in the approval queue before it is sent.",
      input_schema: {
        type: "object",
        properties: {
          contactId: { type: "string", description: "GoHighLevel contact ID" },
          message: { type: "string" },
        },
        required: ["contactId", "message"],
      },
      run: (input) =>
        approvals.propose({
          action: "send_sms",
          summary: `SMS to contact ${input.contactId}: "${input.message}"`,
          payload: input,
        }),
    },
    {
      name: "propose_social_post",
      description:
        "Draft a social media post for one or more platforms. Does NOT publish. The user must approve it first.",
      input_schema: {
        type: "object",
        properties: {
          platforms: {
            type: "array",
            items: { type: "string", enum: ["instagram", "facebook", "linkedin", "x", "tiktok"] },
          },
          text: { type: "string" },
          scheduledAt: { type: "string", description: "ISO 8601 time, optional" },
        },
        required: ["platforms", "text"],
      },
      run: (input) =>
        approvals.propose({
          action: "publish_post",
          summary: `Post to ${input.platforms.join(", ")}: "${input.text.slice(0, 80)}"`,
          payload: input,
        }),
    },
  ];

  const byName = new Map(definitions.map((d) => [d.name, d]));

  return {
    // What we send to the Claude API (no handlers)
    schemas: definitions.map(({ name, description, input_schema }) => ({ name, description, input_schema })),

    async call(name, input) {
      const tool = byName.get(name);
      if (!tool) return { error: `Unknown tool ${name}` };
      try {
        const result = await tool.run(input ?? {});
        return result;
      } catch (err) {
        return { error: err.message };
      }
    },
  };
}

// Maps an approved queue item to the real side effect. Used by the approval endpoint.
export function executorFor(connectors) {
  return async (item) => {
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
