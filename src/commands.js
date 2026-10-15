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
  "Here is what I can do without any AI cost. Say",
  '"brief me" for every business at once, or "brief acme" for one.',
  '"sync" pulls the latest from connected accounts.',
  '"pending" lists what is waiting on your approval.',
  '"businesses" lists them, and "add business acme" creates one.',
  '"note acme client called about pricing" records something.',
  '"status" shows which accounts are connected.',
].join(" ");

// Phrases used to suggest a near match when nothing parses.
const EXAMPLES = [
  "brief me",
  "brief acme",
  "sync",
  "pending",
  "businesses",
  "add business acme",
  "note acme client called about pricing",
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
    const exWords = example.toLowerCase().match(/[a-z]+/g) ?? [];
    const score = exWords.filter((w) => words.has(w)).length;
    if (score > bestScore) {
      bestScore = score;
      best = example;
    }
  }
  return bestScore > 0 ? best : null;
}

// A one-line roll-up across every business, for "brief me" with no name.
async function briefEverything(directory) {
  const all = await directory.list();
  if (!all.length) return { text: 'No businesses yet. Say "add business" and the name.' };

  const parts = [];
  let waiting = 0;
  for (const b of all) {
    const brief = await directory.brief(b.id);
    waiting += brief.counts.pendingApprovals;
    parts.push(
      brief.counts.events
        ? `${b.name}: ${brief.counts.events} event${brief.counts.events === 1 ? "" : "s"}`
        : `${b.name}: quiet`,
    );
  }

  let text = `${all.length} business${all.length === 1 ? "" : "es"}. ${parts.join(". ")}.`;
  text += waiting
    ? ` ${waiting} thing${waiting === 1 ? "" : "s"} waiting for your approval.`
    : " Nothing waiting for approval.";
  return { text };
}

// Each rule maps a spoken phrase to a handler. Order matters: the first match wins.
const RULES = [
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
    match: /^\s*(status|connections|what(?:'s| is)? connected)\s*\??\s*$/i,
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
    name: "brief_all",
    match: /^\s*(?:brief(?:\s+me)?|catch me up|what(?:'?s| is)?\s*(?:going on|happening|new|up)|how(?:'s| is)? (?:it going|everything|business)|any(?:thing)? news|roll ?up|summary|daily brief|update me)\s*(?:today|now)?\s*\??\s*$/i,
    run: async ({ directory }) => briefEverything(directory),
  },
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
