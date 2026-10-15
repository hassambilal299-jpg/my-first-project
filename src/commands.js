// Deterministic commands. These run with no Claude API key and cost nothing,
// because everything they do is computed from the database or read straight
// from a connector. No inference, no tokens, no bill.
//
// Claude handles free-form conversation on top of this. The split matters: the
// app stays fully usable when there is no key, or no credit on the key.
//
// The approval gate still holds here. Dictating a text or a post queues it;
// nothing leaves the building until it is approved.
import { narrateBrief } from "./businesses.js";
import { syncAll, syncBusiness } from "./sync.js";

const HOUR_MS = 60 * 60 * 1000;
const PLATFORMS = ["instagram", "facebook", "linkedin", "x", "tiktok"];

export const HELP = [
  "Everything here is free, no AI needed. Ask about a business:",
  '"brief me" for all of them, "brief acme", or "brief acme last week".',
  'Add things: "add business acme", "note acme client called about pricing".',
  'Look around: "businesses", "pending", "status", "emails", "orders for acme".',
  'Act: "text c1 saying running ten minutes late",',
  '"post to linkedin saying we are hiring", "approve 1", "reject 2", "sync".',
].join(" ");

const EXAMPLES = [
  "brief me",
  "brief acme",
  "sync",
  "pending",
  "approve 1",
  "reject 1",
  "businesses",
  "add business acme",
  "note acme client called about pricing",
  "text c1 saying running late",
  "post to linkedin saying we are hiring",
  "emails",
  "orders for acme",
  "status",
  "help",
];

// Cheap token overlap. Enough to turn "what about acme" into a useful nudge.
export function suggest(text) {
  const words = new Set(String(text).toLowerCase().match(/[a-z]+/g) ?? []);
  if (!words.size) return null;
  let best = null;
  let bestScore = 0;
  for (const example of EXAMPLES) {
    const score = (example.match(/[a-z]+/g) ?? []).filter((w) => words.has(w)).length;
    if (score > bestScore) {
      bestScore = score;
      best = example;
    }
  }
  return bestScore > 0 ? best : null;
}

// ----- shared helpers -------------------------------------------------------

// Pulls a trailing time phrase off the end of a command, so "brief acme last
// week" works without a separate rule per phrasing.
export function parseWindow(text) {
  const patterns = [
    [/\s+(?:for\s+)?today\s*$/i, 24],
    [/\s+(?:for\s+)?yesterday\s*$/i, 48],
    [/\s+(?:for\s+)?(?:this|last|the past)\s+week\s*$/i, 168],
    [/\s+(?:for\s+)?(?:this|last|the past)\s+month\s*$/i, 720],
    [/\s+(?:for\s+)?(?:the\s+)?(?:last|past)\s+(\d+)\s*h(?:ours?|rs?)?\s*$/i, null, (n) => n],
    [/\s+(?:for\s+)?(?:the\s+)?(?:last|past)\s+(\d+)\s*d(?:ays?)?\s*$/i, null, (n) => n * 24],
  ];
  for (const [re, fixed, scale] of patterns) {
    const m = re.exec(text);
    if (!m) continue;
    const hours = fixed ?? scale(Number(m[1]));
    return { rest: text.replace(re, "").trim(), hours: Math.min(Math.max(hours, 1), 720) };
  }
  return { rest: text.trim(), hours: 24 };
}

async function connectorsFor(business, { directory, connectorsFactory, defaultConnectors }) {
  if (!business) return defaultConnectors;
  let credentials = {};
  try {
    credentials = await directory.credentials(business.id);
  } catch {
    credentials = {};
  }
  return connectorsFactory(credentials);
}

// A one-line roll-up across every business, for "brief me" with no name.
async function briefEverything(directory, hours) {
  const all = await directory.list();
  if (!all.length) return { text: 'No businesses yet. Say "add business" and the name.' };

  const since = new Date(Date.now() - hours * HOUR_MS).toISOString();
  const parts = [];
  let waiting = 0;
  for (const b of all) {
    const brief = await directory.brief(b.id, since);
    waiting += brief.counts.pendingApprovals;
    parts.push(brief.counts.events ? `${b.name}: ${brief.counts.events} event${brief.counts.events === 1 ? "" : "s"}` : `${b.name}: quiet`);
  }

  let text = `${all.length} business${all.length === 1 ? "" : "es"}, last ${hours} hour${hours === 1 ? "" : "s"}. ${parts.join(". ")}.`;
  text += waiting ? ` ${waiting} thing${waiting === 1 ? "" : "s"} waiting for your approval.` : " Nothing waiting for approval.";
  return { text };
}

// Pending items are addressed by position, because a UUID cannot be spoken.
// The reply always names what was acted on, so a misheard number is visible.
async function decideByPosition({ approvals, execute, directory }, which, decision) {
  const items = await approvals.list("pending");
  if (!items.length) return { text: "Nothing is waiting for your approval." };

  const targets =
    which === "all" ? items : [items[Number(which) - 1]].filter(Boolean);
  if (!targets.length) {
    return { text: `There is no number ${which}. There ${items.length === 1 ? "is 1 item" : `are ${items.length} items`} waiting.` };
  }

  const done = [];
  for (const item of targets) {
    const result = await approvals.decide(item.id, decision, execute);
    done.push(`${item.summary} (${result.status}${result.error ? `: ${result.error}` : ""})`);
    if (result.status === "approved" && item.businessId) {
      await directory
        .record({
          businessId: item.businessId,
          source: "agent",
          kind: `${item.action}.sent`,
          summary: `Approved and ran: ${item.summary}`,
          detail: {},
        })
        .catch(() => {});
    }
  }
  return { text: `${decision === "approve" ? "Approved" : "Rejected"} ${done.length}: ${done.join("; ")}.` };
}

// ----- rules. The first match wins, so order matters. -----------------------

const RULES = [
  {
    name: "help",
    match: /^\s*(help|what can you do|commands|options)\s*\??\s*$/i,
    run: async () => ({ text: HELP }),
  },
  {
    name: "greeting",
    match: /^\s*(hi|hey|hello|yo|good morning|good evening|jarvis)[\s!.]*$/i,
    run: async ({ directory }) => {
      const all = await directory.list();
      return {
        text: all.length
          ? `Hello. You have ${all.length} business${all.length === 1 ? "" : "es"}. Say "brief me" for a roll-up, or "help".`
          : 'Hello. No businesses set up yet. Say "add business" and the name, or "help".',
      };
    },
  },
  {
    name: "status",
    match: /^\s*(status|connections|what(?:'?s| is)? connected)\s*\??\s*$/i,
    run: async ({ defaultConnectors }) => {
      const status = defaultConnectors.status();
      const on = Object.entries(status).filter(([, v]) => v).map(([k]) => k);
      const off = Object.entries(status).filter(([, v]) => !v).map(([k]) => k);
      let text = on.length ? `Connected: ${on.join(", ")}.` : "Nothing is connected yet.";
      if (off.length) text += ` Not connected: ${off.join(", ")}.`;
      return { text };
    },
  },
  {
    name: "businesses",
    match: /^\s*(list )?(businesses|clients|my businesses|my clients)\s*\??\s*$/i,
    run: async ({ directory }) => {
      const all = await directory.list();
      return {
        text: all.length
          ? `You have ${all.length}: ${all.map((b) => b.name).join(", ")}.`
          : 'No businesses yet. Say: add business, then the name.',
      };
    },
  },
  {
    name: "add_business",
    match: /^\s*(?:add|create|new)\s+(?:a\s+)?(?:business|client)\s+(?:called\s+|named\s+)?(.+?)\s*$/i,
    run: async ({ directory }, m) => {
      const business = await directory.add({ name: m[1].trim() });
      return { text: `Added ${business.name}.` };
    },
  },
  {
    name: "sync",
    match: /^\s*(?:sync|sync now|refresh|pull|update)\s*(?:everything|all)?\s*$/i,
    run: async ({ directory, connectorsFactory }) => {
      const out = await syncAll({ directory, connectorsFor: connectorsFactory });
      if (!out.businesses) return { text: "No businesses to sync yet." };
      const recorded = out.reports.reduce((n, r) => n + r.recorded, 0);
      const notConnected = [...new Set(out.reports.flatMap((r) => r.notConnected))];
      let text = `Synced ${out.businesses} business${out.businesses === 1 ? "" : "es"}. ${recorded} new event${recorded === 1 ? "" : "s"}.`;
      if (notConnected.length) text += ` Not connected yet: ${notConnected.join(", ")}.`;
      return { text };
    },
  },
  {
    name: "sync_one",
    match: /^\s*(?:sync|refresh|pull)\s+(.+?)\s*$/i,
    run: async ({ directory, connectorsFactory }, m) => {
      const business = await directory.resolve(m[1]);
      const report = await syncBusiness({ directory, business, connectorsFor: connectorsFactory });
      let text = `${business.name}: ${report.recorded} new event${report.recorded === 1 ? "" : "s"}.`;
      if (report.notConnected.length) text += ` Not connected: ${report.notConnected.join(", ")}.`;
      if (report.errors.length) text += ` Errors: ${report.errors.join("; ")}.`;
      return { text };
    },
  },
  {
    name: "pending",
    match: /^\s*(pending|approvals|what needs approval|what(?:'?s| is)? waiting|waiting)\s*\??\s*$/i,
    run: async ({ approvals }) => {
      const items = await approvals.list("pending");
      if (!items.length) return { text: "Nothing is waiting for your approval." };
      const lines = items.map((item, i) => `${i + 1}. ${item.summary}`);
      return { text: `${items.length} waiting. ${lines.join(". ")}. Say "approve 1" or "reject 1".` };
    },
  },
  {
    name: "approve",
    match: /^\s*approve\s+(all|\d+)\s*$/i,
    run: async (deps, m) => decideByPosition(deps, m[1].toLowerCase(), "approve"),
  },
  {
    name: "reject",
    match: /^\s*(?:reject|decline|cancel)\s+(all|\d+)\s*$/i,
    run: async (deps, m) => decideByPosition(deps, m[1].toLowerCase(), "reject"),
  },
  {
    name: "note",
    match: /^\s*note\s+(?:for\s+)?(\S+)\s+(.+?)\s*$/i,
    run: async ({ directory }, m) => {
      const business = await directory.resolve(m[1]);
      await directory.record({
        businessId: business.id,
        source: "manual",
        kind: "note",
        summary: m[2].trim(),
        detail: {},
      });
      return { text: `Noted for ${business.name}.` };
    },
  },
  {
    name: "draft_sms",
    // Dictated, not generated. The user supplies the words, so no AI is needed.
    match: /^\s*(?:text|sms|message)\s+(\S+?)(?:\s+for\s+(\S+))?\s+(?:saying|that says|:)\s+(.+?)\s*$/i,
    run: async ({ directory, approvals }, m) => {
      const [, contactId, businessName, message] = m;
      const business = businessName ? await directory.resolve(businessName) : null;
      const item = await approvals.propose({
        action: "send_sms",
        businessId: business?.id ?? null,
        summary: `SMS${business ? ` (${business.name})` : ""} to contact ${contactId}: "${message}"`,
        payload: { contactId, message, businessId: business?.id ?? null },
      });
      return { text: `Drafted, not sent. ${item.summary}. Say "pending" then "approve 1" to send it.` };
    },
  },
  {
    name: "draft_post",
    match: /^\s*post\s+(?:to\s+)?([a-z][a-z,\s]*?)\s+(?:saying|that says|:)\s+(.+?)\s*$/i,
    run: async ({ directory, approvals }, m) => {
      const wanted = m[1]
        .toLowerCase()
        .split(/[,\s]+/)
        .map((w) => (w === "twitter" ? "x" : w))
        .filter((w) => w && w !== "and");
      const platforms = wanted.filter((w) => PLATFORMS.includes(w));
      const unknown = wanted.filter((w) => !PLATFORMS.includes(w));
      if (!platforms.length) {
        return { text: `I do not know ${unknown.join(", ") || "that platform"}. I can post to ${PLATFORMS.join(", ")}.` };
      }
      const item = await approvals.propose({
        action: "publish_post",
        businessId: null,
        summary: `Post to ${platforms.join(", ")}: "${m[2].slice(0, 80)}"`,
        payload: { platforms, text: m[2], businessId: null },
      });
      let text = `Drafted, not published. ${item.summary}. Say "approve 1" to publish.`;
      if (unknown.length) text += ` I skipped ${unknown.join(", ")}.`;
      return { text };
    },
  },
  {
    name: "emails",
    match: /^\s*(?:emails?|inbox|mail)(?:\s+for\s+(.+?))?\s*\??\s*$/i,
    run: async (deps, m) => {
      const business = m[1] ? await deps.directory.resolve(m[1]) : null;
      const connectors = await connectorsFor(business, deps);
      const res = await connectors.listUnreadEmails({ limit: 5 });
      if (res.mock) return { text: `Gmail is not connected yet, so I have no email to show.` };
      const messages = res.messages ?? [];
      return {
        text: messages.length
          ? `${messages.length} unread. ${messages.map((e) => `${e.from}: ${e.subject}`).join(". ")}.`
          : "No unread email.",
      };
    },
  },
  {
    name: "orders",
    match: /^\s*(?:orders?|sales)(?:\s+for\s+(.+?))?\s*\??\s*$/i,
    run: async (deps, m) => {
      const business = m[1] ? await deps.directory.resolve(m[1]) : null;
      const connectors = await connectorsFor(business, deps);
      const res = await connectors.recentOrders({ limit: 5 });
      if (res.mock) return { text: "Shopify is not connected yet, so I have no orders to show." };
      const orders = res.orders ?? [];
      return {
        text: orders.length
          ? `${orders.length} recent. ${orders.map((o) => `${o.name ?? o.id} for ${o.total_price ?? "?"}`).join(". ")}.`
          : "No recent orders.",
      };
    },
  },
  {
    name: "brief_all",
    match: /^\s*(?:brief(?:\s+me)?|catch me up|what(?:'?s| is)?\s*(?:going on|happening|new|up)|how(?:'?s| is)? (?:it going|everything|business)|any(?:thing)? news|roll ?up|summary|daily brief|update me)\s*\??\s*$/i,
    run: async ({ directory }, _m, hours) => briefEverything(directory, hours),
  },
  {
    name: "brief",
    // Greedy, so it must stay last.
    match: /^\s*(?:brief(?:\s+me)?(?:\s+on)?|catch me up on|how(?:'?s| is)|what(?:'?s| is)?\s+(?:going on|happening|up)\s+(?:with|at))\s+(.+?)\s*\??\s*$/i,
    run: async ({ directory }, m, hours) => {
      const since = new Date(Date.now() - hours * HOUR_MS).toISOString();
      const brief = await directory.brief(m[1].trim(), since);
      return { text: narrateBrief(brief), brief };
    },
  },
];

// Returns null when nothing matches, so the caller can fall through to Claude.
export async function runCommand(text, deps) {
  const { rest, hours } = parseWindow(String(text ?? ""));

  for (const rule of RULES) {
    // Time-aware rules see the phrase with the window stripped off.
    const candidate = rule.name === "brief" || rule.name === "brief_all" ? rest : String(text ?? "");
    const m = rule.match.exec(candidate);
    if (!m) continue;
    try {
      const out = await rule.run(deps, m, hours);
      return { ...out, command: rule.name };
    } catch (err) {
      // A command that matched but failed should explain itself, not fall
      // through to the model and get a vague answer.
      return { text: err.message, command: rule.name, failed: true };
    }
  }
  return null;
}
