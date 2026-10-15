// Deterministic commands. These run with no Claude API key and cost nothing,
// because everything they do — briefs, syncs, approvals, notes — is computed
// from the database rather than generated.
//
// Claude handles free-form conversation on top of this. The split matters: the
// app stays useful when there is no key, or no credit on the key.
import { narrateBrief } from "./businesses.js";
import { syncAll } from "./sync.js";

const HOUR_MS = 60 * 60 * 1000;

export const HELP = [
  "Here is what I can do without the AI: say",
  '"brief acme" for everything happening in a business,',
  '"sync" to pull the latest from connected accounts,',
  '"pending" for what is waiting on your approval,',
  '"businesses" to list them,',
  '"add business acme" to create one,',
  '"note acme client called about pricing" to record something.',
].join(" ");

// Each rule maps a spoken phrase to a handler. Order matters: the first match wins.
const RULES = [
  {
    name: "help",
    match: /^\s*(help|what can you do|commands)\s*$/i,
    run: async () => ({ text: HELP }),
  },
  {
    name: "businesses",
    match: /^\s*(list )?(businesses|clients|my businesses)\s*$/i,
    run: async ({ directory }) => {
      const all = await directory.list();
      return {
        text: all.length
          ? `You have ${all.length}: ${all.map((b) => b.name).join(", ")}.`
          : "No businesses yet. Say: add business, then the name.",
      };
    },
  },
  {
    name: "add_business",
    match: /^\s*(add|create|new)\s+(a\s+)?(business|client)\s+(?:called\s+|named\s+)?(.+?)\s*$/i,
    run: async ({ directory }, m) => {
      const business = await directory.add({ name: m[4].trim() });
      return { text: `Added ${business.name}.` };
    },
  },
  {
    name: "sync",
    match: /^\s*(sync|sync now|refresh|update everything)\s*$/i,
    run: async ({ directory, connectorsFor }) => {
      const out = await syncAll({ directory, connectorsFor });
      if (!out.businesses) return { text: "No businesses to sync yet." };
      const recorded = out.reports.reduce((n, r) => n + r.recorded, 0);
      const notConnected = [...new Set(out.reports.flatMap((r) => r.notConnected))];
      let text = `Synced ${out.businesses} business${out.businesses === 1 ? "" : "es"}. ${recorded} new event${recorded === 1 ? "" : "s"}.`;
      if (notConnected.length) text += ` Not connected yet: ${notConnected.join(", ")}.`;
      return { text };
    },
  },
  {
    name: "pending",
    match: /^\s*(pending|approvals|what needs approval|what is waiting|whats waiting)\s*\??\s*$/i,
    run: async ({ approvals }) => {
      const items = await approvals.list("pending");
      return {
        text: items.length
          ? `${items.length} waiting: ${items.map((i) => i.summary).join("; ")}.`
          : "Nothing is waiting for your approval.",
      };
    },
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
    name: "brief",
    match: /^\s*(?:brief(?:\s+me)?(?:\s+on)?|catch me up on|how is|hows|how's|what(?:'s| is)?\s+(?:going on|happening|up)\s+(?:with|at))\s+(.+?)\s*\??\s*$/i,
    run: async ({ directory }, m) => {
      const hours = 24;
      const since = new Date(Date.now() - hours * HOUR_MS).toISOString();
      const brief = await directory.brief(m[1].trim(), since);
      return { text: narrateBrief(brief), brief };
    },
  },
];

// Returns null when nothing matches, so the caller can fall through to Claude.
export async function runCommand(text, deps) {
  for (const rule of RULES) {
    const m = rule.match.exec(text);
    if (!m) continue;
    try {
      const out = await rule.run(deps, m);
      return { ...out, command: rule.name };
    } catch (err) {
      // A command that matched but failed should explain itself, not fall
      // through to the model and get a vague answer.
      return { text: err.message, command: rule.name, failed: true };
    }
  }
  return null;
}
