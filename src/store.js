// Storage interface. Both implementations expose a single method:
//
//   call(op, input) -> result
//
// RemoteStore forwards to the Supabase Edge Function, which holds service-role
// access. LocalStore implements the same ops over a JSON file so local runs and
// tests exercise the same code paths above this layer, with no network.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const DAY_MS = 24 * 60 * 60 * 1000;

// Shared aggregation so a brief has the same shape whichever store produced it.
export function summarizeBrief({ business, events, pending, windowStart }) {
  const bySource = {};
  const byKind = {};
  for (const e of events) {
    bySource[e.source] = (bySource[e.source] ?? 0) + 1;
    byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
  }
  return {
    business,
    window: { since: windowStart, until: new Date().toISOString() },
    counts: { events: events.length, pendingApprovals: pending.length, bySource, byKind },
    events,
    pendingApprovals: pending,
  };
}

export class RemoteStore {
  constructor({ url, apiKey, storeToken, fetchImpl = fetch }) {
    this.url = url;
    this.apiKey = apiKey;
    this.storeToken = storeToken;
    this.fetch = fetchImpl;
  }

  async call(op, input = {}) {
    const headers = {
      "Content-Type": "application/json",
      apikey: this.apiKey,
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (this.storeToken) headers["x-jarvis-token"] = this.storeToken;

    const res = await this.fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ op, input }),
    });
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`store ${op}: unreadable response (${res.status})`);
    }
    if (!res.ok) throw new Error(`store ${op}: ${body.error ?? res.status}`);
    return body.result;
  }
}

export class LocalStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data =
      filePath && existsSync(filePath)
        ? JSON.parse(readFileSync(filePath, "utf8"))
        : { businesses: [], events: [], approvals: [] };
    for (const table of ["businesses", "events", "approvals"]) {
      this.data[table] ??= [];
    }
  }

  save() {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }

  publicBusiness(b) {
    const { credentials: _ignored, ...rest } = b;
    return rest;
  }

  async call(op, input = {}) {
    const d = this.data;

    switch (op) {
      case "businesses.list":
        return d.businesses.filter((b) => !b.archived_at).map((b) => this.publicBusiness(b));

      case "businesses.get": {
        const found = d.businesses.find((b) => (input.id ? b.id === input.id : b.name === input.name));
        return found ? this.publicBusiness(found) : null;
      }

      case "businesses.upsert": {
        if (!input.name) throw new Error("name is required");
        let b = d.businesses.find((x) => x.name === input.name);
        if (!b) {
          b = {
            id: randomUUID(),
            name: input.name,
            kind: input.kind ?? "other",
            credentials: {},
            created_at: new Date().toISOString(),
            archived_at: null,
          };
          d.businesses.push(b);
        }
        if (input.kind) b.kind = input.kind;
        if (input.credentials !== undefined) b.credentials = input.credentials;
        this.save();
        return this.publicBusiness(b);
      }

      case "businesses.secrets": {
        const b = d.businesses.find((x) => x.id === input.business_id);
        return b?.credentials ?? {};
      }

      case "events.insert": {
        if (!input.business_id || !input.source || !input.kind || !input.summary) {
          throw new Error("business_id, source, kind and summary are required");
        }
        // Mirrors the unique index in Postgres: an event carrying the provider's
        // own id is recorded once, so repeated sweeps stay idempotent.
        const externalId = input.detail?.external_id;
        if (externalId !== undefined) {
          const seen = d.events.some(
            (e) =>
              e.business_id === input.business_id &&
              e.source === input.source &&
              e.detail?.external_id === externalId,
          );
          if (seen) return { duplicate: true };
        }
        const row = {
          id: d.events.length + 1,
          business_id: input.business_id,
          source: input.source,
          kind: input.kind,
          summary: input.summary,
          detail: input.detail ?? {},
          occurred_at: new Date().toISOString(),
        };
        d.events.push(row);
        this.save();
        return row;
      }

      case "events.list": {
        const since = input.since ? Date.parse(input.since) : -Infinity;
        return d.events
          .filter((e) => e.business_id === input.business_id && Date.parse(e.occurred_at) >= since)
          .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
          .slice(0, Math.min(Number(input.limit) || 50, 200));
      }

      case "approvals.insert": {
        const row = {
          id: randomUUID(),
          business_id: input.business_id ?? null,
          action: input.action,
          summary: input.summary,
          payload: input.payload ?? {},
          status: "pending",
          result: null,
          error: null,
          created_at: new Date().toISOString(),
          decided_at: null,
        };
        d.approvals.push(row);
        this.save();
        return row;
      }

      case "approvals.list":
        return d.approvals
          .filter((a) => (input.status ? a.status === input.status : true))
          .filter((a) => (input.business_id ? a.business_id === input.business_id : true))
          .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));

      case "approvals.get":
        return d.approvals.find((a) => a.id === input.id) ?? null;

      case "approvals.update": {
        const row = d.approvals.find((a) => a.id === input.id);
        if (!row) throw new Error("unknown approval");
        for (const key of ["status", "result", "error", "decided_at"]) {
          if (input.patch && key in input.patch) row[key] = input.patch[key];
        }
        this.save();
        return row;
      }

      case "brief": {
        const business = d.businesses.find((b) => b.id === input.business_id);
        if (!business) throw new Error("unknown business");
        const windowStart = input.since ?? new Date(Date.now() - DAY_MS).toISOString();
        const events = await this.call("events.list", {
          business_id: input.business_id,
          since: windowStart,
          limit: 200,
        });
        const pending = await this.call("approvals.list", {
          business_id: input.business_id,
          status: "pending",
        });
        return summarizeBrief({
          business: this.publicBusiness(business),
          events,
          pending,
          windowStart,
        });
      }

      default:
        throw new Error(`unknown op ${op}`);
    }
  }
}
