// The multi-business layer: each client workspace, its connector credentials,
// its event history, and the brief that answers "what is happening here".

// Errors the caller can fix, carrying the status the API should return.
function withStatus(message, status) {
  return Object.assign(new Error(message), { status, expected: true });
}
const badRequest = (message) => withStatus(message, 400);
const notFound = (message) => withStatus(message, 404);

export class Directory {
  constructor({ store, cipher }) {
    this.store = store;
    this.cipher = cipher;
  }

  list() {
    return this.store.call("businesses.list");
  }

  // Businesses are addressed by name in conversation ("how is Acme doing?"),
  // so resolve loosely: exact name first, then a unique case-insensitive match.
  // Failures carry an HTTP status: these are the caller's mistake, not a crash,
  // and the message is written to be shown to the user as-is.
  async resolve(nameOrId) {
    if (!nameOrId) throw badRequest("Which business? Give me a name.");

    const byName = await this.store.call("businesses.get", { name: nameOrId });
    if (byName) return byName;

    const all = await this.list();
    const needle = String(nameOrId).toLowerCase();

    const exactId = all.find((b) => b.id === nameOrId);
    if (exactId) return exactId;

    const matches = all.filter((b) => b.name.toLowerCase().includes(needle));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw badRequest(`"${nameOrId}" matches several businesses: ${matches.map((b) => b.name).join(", ")}`);
    }
    throw notFound(
      all.length
        ? `No business called "${nameOrId}". I have: ${all.map((b) => b.name).join(", ")}`
        : `No businesses set up yet. Add one first.`,
    );
  }

  add({ name, kind }) {
    return this.store.call("businesses.upsert", { name, kind });
  }

  // Credentials are encrypted before they leave this process.
  async setCredentials(nameOrId, credentials) {
    const business = await this.resolve(nameOrId);
    const current = await this.credentials(business.id).catch(() => ({}));
    const merged = { ...current, ...credentials };
    await this.store.call("businesses.upsert", {
      name: business.name,
      credentials: this.cipher.encrypt(merged),
    });
    return { business: business.name, keys: Object.keys(merged) };
  }

  async credentials(businessId) {
    const blob = await this.store.call("businesses.secrets", { business_id: businessId });
    if (!blob || !blob.data) return {};
    return this.cipher.decrypt(blob);
  }

  record({ businessId, source, kind, summary, detail }) {
    return this.store.call("events.insert", {
      business_id: businessId,
      source,
      kind,
      summary,
      detail,
    });
  }

  async brief(nameOrId, since) {
    const business = await this.resolve(nameOrId);
    return this.store.call("brief", { business_id: business.id, since });
  }
}

// Turns a brief into a few lines a person can hear read aloud, rather than a
// wall of JSON. The agent gets the structured brief too and can go deeper.
export function narrateBrief(brief) {
  const { business, counts, events, pendingApprovals } = brief;
  const lines = [];

  const since = new Date(brief.window.since);
  const hours = Math.max(1, Math.round((Date.now() - since.getTime()) / 3600000));
  lines.push(`${business.name}, last ${hours} hour${hours === 1 ? "" : "s"}:`);

  if (!counts.events && !counts.pendingApprovals) {
    lines.push("Nothing recorded. Either it is quiet or no connector has reported in yet.");
    return lines.join(" ");
  }

  if (counts.events) {
    const breakdown = Object.entries(counts.bySource)
      .sort((a, b) => b[1] - a[1])
      .map(([source, n]) => `${n} from ${source}`)
      .join(", ");
    lines.push(`${counts.events} event${counts.events === 1 ? "" : "s"} (${breakdown}).`);
  }

  const highlights = events.slice(0, 5).map((e) => e.summary);
  if (highlights.length) lines.push(`Most recent: ${highlights.join("; ")}.`);

  if (counts.pendingApprovals) {
    lines.push(
      `${counts.pendingApprovals} thing${counts.pendingApprovals === 1 ? "" : "s"} waiting for your approval: ${pendingApprovals
        .slice(0, 3)
        .map((a) => a.summary)
        .join("; ")}.`,
    );
  } else {
    lines.push("Nothing waiting for approval.");
  }

  return lines.join(" ");
}
