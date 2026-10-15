// Jarvis data layer.
//
// Why this exists: the Supabase management API only hands out publishable keys,
// and the tables below have RLS enabled with no policies, so a publishable key
// cannot read or write them. This function runs inside Supabase, where the
// service-role key is injected by the platform, and exposes a small fixed set
// of operations instead of the whole PostgREST surface. There is no delete op
// and no arbitrary filtering.
//
// Auth, in layers:
//   1. The gateway requires a valid JWT (verify_jwt), so the publishable key.
//   2. If the JARVIS_STORE_TOKEN secret is set on the project, an x-jarvis-token
//      header matching it is also required. Set it in the Supabase dashboard
//      under Edge Functions → Secrets to harden this beyond the JWT.
//   3. Connector credentials are encrypted by the app before they arrive here,
//      so this function only ever stores and returns ciphertext.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHARED_TOKEN = Deno.env.get("JARVIS_STORE_TOKEN");

const REST = `${SUPABASE_URL}/rest/v1`;

async function db(
  path: string,
  { method = "GET", body, prefer }: { method?: string; body?: unknown; prefer?: string } = {},
) {
  const headers: Record<string, string> = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${REST}/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`db ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const one = <T>(rows: T[]): T | null => (rows.length ? rows[0] : null);

// Columns safe to return for a business. `credentials` is deliberately excluded
// from listings; it comes back only from the explicit secrets op.
const BUSINESS_COLS = "id,name,kind,created_at,archived_at";

type Op = (input: Record<string, unknown>) => Promise<unknown>;

const ops: Record<string, Op> = {
  "businesses.list": async () =>
    db(`businesses?select=${BUSINESS_COLS}&archived_at=is.null&order=name.asc`),

  "businesses.get": async ({ id, name }) => {
    const filter = id
      ? `id=eq.${encodeURIComponent(String(id))}`
      : `name=eq.${encodeURIComponent(String(name))}`;
    return one(await db(`businesses?${filter}&select=${BUSINESS_COLS}`));
  },

  "businesses.upsert": async ({ name, kind, credentials }) => {
    if (!name) throw new Error("name is required");
    const row: Record<string, unknown> = { name, kind: kind ?? "other" };
    if (credentials !== undefined) row.credentials = credentials;
    const rows = await db("businesses?on_conflict=name", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=representation",
      body: row,
    });
    const b = one<Record<string, unknown>>(rows)!;
    // Never echo credentials back.
    delete b.credentials;
    return b;
  },

  // Returns the encrypted credential blob. Only the app holds the key.
  "businesses.secrets": async ({ business_id }) => {
    const rows = await db(
      `businesses?id=eq.${encodeURIComponent(String(business_id))}&select=credentials`,
    );
    return one<{ credentials: unknown }>(rows)?.credentials ?? {};
  },

  "events.insert": async ({ business_id, source, kind, summary, detail }) => {
    if (!business_id || !source || !kind || !summary) {
      throw new Error("business_id, source, kind and summary are required");
    }
    try {
      const rows = await db("events", {
        method: "POST",
        prefer: "return=representation",
        body: { business_id, source, kind, summary, detail: detail ?? {} },
      });
      return one(rows);
    } catch (err) {
      // A unique violation means this provider id was already recorded by an
      // earlier sweep. That is the expected path, not a failure.
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("23505") || message.includes("duplicate key")) {
        return { duplicate: true };
      }
      throw err;
    }
  },

  "events.list": async ({ business_id, since, limit }) => {
    const parts = [`business_id=eq.${encodeURIComponent(String(business_id))}`];
    if (since) parts.push(`occurred_at=gte.${encodeURIComponent(String(since))}`);
    parts.push("order=occurred_at.desc");
    parts.push(`limit=${Math.min(Number(limit) || 50, 200)}`);
    return db(`events?${parts.join("&")}`);
  },

  "approvals.insert": async ({ business_id, action, summary, payload }) => {
    const rows = await db("approvals", {
      method: "POST",
      prefer: "return=representation",
      body: { business_id: business_id ?? null, action, summary, payload: payload ?? {}, status: "pending" },
    });
    return one(rows);
  },

  "approvals.list": async ({ status, business_id, limit }) => {
    const parts: string[] = [];
    if (status) parts.push(`status=eq.${encodeURIComponent(String(status))}`);
    if (business_id) parts.push(`business_id=eq.${encodeURIComponent(String(business_id))}`);
    parts.push("order=created_at.asc");
    parts.push(`limit=${Math.min(Number(limit) || 100, 200)}`);
    return db(`approvals?${parts.join("&")}`);
  },

  "approvals.get": async ({ id }) =>
    one(await db(`approvals?id=eq.${encodeURIComponent(String(id))}&select=*`)),

  "approvals.update": async ({ id, patch }) => {
    const allowed = ["status", "result", "error", "decided_at"];
    const row: Record<string, unknown> = {};
    for (const key of allowed) {
      if (patch && key in (patch as Record<string, unknown>)) {
        row[key] = (patch as Record<string, unknown>)[key];
      }
    }
    if (!Object.keys(row).length) throw new Error("no updatable fields supplied");
    const rows = await db(`approvals?id=eq.${encodeURIComponent(String(id))}`, {
      method: "PATCH",
      prefer: "return=representation",
      body: row,
    });
    return one(rows);
  },

  // One round trip for "tell me everything happening in this business".
  brief: async ({ business_id, since }) => {
    const windowStart = since
      ? String(since)
      : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const bid = encodeURIComponent(String(business_id));

    const [business, events, pending] = await Promise.all([
      db(`businesses?id=eq.${bid}&select=${BUSINESS_COLS}`).then(one),
      db(`events?business_id=eq.${bid}&occurred_at=gte.${encodeURIComponent(windowStart)}&order=occurred_at.desc&limit=200`),
      db(`approvals?business_id=eq.${bid}&status=eq.pending&order=created_at.asc`),
    ]);

    if (!business) throw new Error("unknown business");

    const bySource: Record<string, number> = {};
    const byKind: Record<string, number> = {};
    for (const e of events as Array<{ source: string; kind: string }>) {
      bySource[e.source] = (bySource[e.source] ?? 0) + 1;
      byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    }

    return {
      business,
      window: { since: windowStart, until: new Date().toISOString() },
      counts: { events: (events as unknown[]).length, pendingApprovals: (pending as unknown[]).length, bySource, byKind },
      events,
      pendingApprovals: pending,
    };
  },
};

Deno.serve(async (req: Request) => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  if (req.method !== "POST") return json(405, { error: "POST only" });

  if (SHARED_TOKEN && req.headers.get("x-jarvis-token") !== SHARED_TOKEN) {
    return json(401, { error: "bad store token" });
  }

  let payload: { op?: string; input?: Record<string, unknown> };
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: "body must be JSON" });
  }

  const op = payload.op && ops[payload.op];
  if (!op) return json(400, { error: `unknown op ${payload.op ?? "(none)"}` });

  try {
    return json(200, { result: await op(payload.input ?? {}) });
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : String(err) });
  }
});
