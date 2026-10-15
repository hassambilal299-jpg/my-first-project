// Queue of actions that need a human "yes" before they run. Anything that sends
// a message or publishes content goes through here. Storage is pluggable:
// a local JSON file (dev) or Supabase (production).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

// ----- Storage backends. Each one exposes insert / list / get / update. -----

export class FileStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.items = existsSync(filePath) ? JSON.parse(readFileSync(filePath, "utf8")) : [];
  }

  save() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.items, null, 2));
  }

  async insert(fields) {
    const row = { id: randomUUID(), createdAt: new Date().toISOString(), status: "pending", ...fields };
    this.items.push(row);
    this.save();
    return row;
  }

  async list(status) {
    return (status ? this.items.filter((i) => i.status === status) : [...this.items]);
  }

  async get(id) {
    return this.items.find((i) => i.id === id);
  }

  async update(id, patch) {
    const item = this.items.find((i) => i.id === id);
    Object.assign(item, patch);
    this.save();
    return item;
  }
}

export class SupabaseStore {
  constructor({ url, key, fetchImpl = fetch }) {
    this.endpoint = `${url.replace(/\/$/, "")}/rest/v1/approvals`;
    this.key = key;
    this.fetch = fetchImpl;
  }

  async request(url, { method = "GET", body, prefer } = {}) {
    const headers = { apikey: this.key, Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" };
    if (prefer) headers.Prefer = prefer;
    const res = await this.fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  }

  fromRow(r) {
    return {
      id: r.id,
      action: r.action,
      summary: r.summary,
      payload: r.payload,
      status: r.status,
      result: r.result ?? undefined,
      error: r.error ?? undefined,
      createdAt: r.created_at,
      decidedAt: r.decided_at ?? undefined,
    };
  }

  async insert({ action, summary, payload }) {
    const rows = await this.request(this.endpoint, {
      method: "POST",
      prefer: "return=representation",
      body: { action, summary, payload, status: "pending" },
    });
    return this.fromRow(rows[0]);
  }

  async list(status) {
    const filter = status ? `status=eq.${encodeURIComponent(status)}&` : "";
    const rows = await this.request(`${this.endpoint}?${filter}order=created_at.asc`);
    return rows.map((r) => this.fromRow(r));
  }

  async get(id) {
    const rows = await this.request(`${this.endpoint}?id=eq.${encodeURIComponent(id)}&select=*`);
    return rows[0] ? this.fromRow(rows[0]) : undefined;
  }

  async update(id, patch) {
    const row = {};
    if ("status" in patch) row.status = patch.status;
    if ("result" in patch) row.result = patch.result;
    if ("error" in patch) row.error = patch.error;
    if ("decidedAt" in patch) row.decided_at = patch.decidedAt;
    const rows = await this.request(`${this.endpoint}?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      prefer: "return=representation",
      body: row,
    });
    return this.fromRow(rows[0]);
  }
}

// ----- Queue logic, independent of storage. -----

export class ApprovalQueue {
  constructor(store) {
    this.store = store;
  }

  propose({ action, summary, payload }) {
    return this.store.insert({ action, summary, payload });
  }

  list(status) {
    return this.store.list(status);
  }

  get(id) {
    return this.store.get(id);
  }

  // Resolve a pending item. `execute` is the real side effect; it runs only on approve.
  async decide(id, decision, execute) {
    const item = await this.store.get(id);
    if (!item) throw new Error(`No approval item ${id}`);
    if (item.status !== "pending") throw new Error(`Item ${id} is already ${item.status}`);

    const decidedAt = new Date().toISOString();
    if (decision === "reject") {
      return this.store.update(id, { status: "rejected", decidedAt });
    }

    try {
      const result = await execute(item);
      return this.store.update(id, { status: "approved", result, decidedAt });
    } catch (err) {
      return this.store.update(id, { status: "failed", error: err.message, decidedAt });
    }
  }
}
