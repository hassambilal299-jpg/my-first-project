import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server.js";
import handler from "../src/server.js";
import { ApprovalQueue } from "../src/approvals.js";
import { LocalStore, RemoteStore, summarizeBrief } from "../src/store.js";
import { Directory, narrateBrief } from "../src/businesses.js";
import { createCipher } from "../src/crypto.js";
import { createConnectors } from "../src/connectors.js";
import { buildTools, executorFor } from "../src/tools.js";
import { createAgent } from "../src/agent.js";
import { syncBusiness, syncAll } from "../src/sync.js";

const TOKEN = "test-token-1234567890";
const KEY = "a".repeat(64);
const tmpFile = (name = "store.json") => join(mkdtempSync(join(tmpdir(), "jarvis-test-")), name);

const noNetwork = async () => {
  throw new Error("network should not be called in mock mode");
};

function wiring({ env = {}, fetchImpl = noNetwork } = {}) {
  const store = new LocalStore(null);
  const cipher = createCipher(KEY);
  const directory = new Directory({ store, cipher });
  const approvals = new ApprovalQueue(store);
  const connectorsFor = (creds) => createConnectors({ ...env, ...creds }, fetchImpl);
  const defaultConnectors = connectorsFor({});
  const tools = buildTools({ directory, approvals, connectorsFor, defaultConnectors });
  return { store, cipher, directory, approvals, connectorsFor, defaultConnectors, tools };
}

function setup({ agentReply, env = {} } = {}) {
  const w = wiring({ env });
  const agent = { respond: async (_h, text) => ({ text: agentReply ?? `echo: ${text}`, toolsUsed: [] }) };
  const { server } = createApp({ AGENT_TOKEN: TOKEN, CREDENTIALS_KEY: KEY }, { ...w, agent });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve({ ...w, base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }),
    );
  });
}

const auth = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

// ---------------------------------------------------------------- startup ---

test("refuses to start with a weak or missing token", () => {
  assert.throws(() => createApp({ AGENT_TOKEN: "short" }), /AGENT_TOKEN/);
  assert.throws(() => createApp({}), /AGENT_TOKEN/);
});

test("starts without an Anthropic key and says so in chat", async () => {
  const { server } = createApp({ AGENT_TOKEN: TOKEN, STORE_FILE: tmpFile() });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ message: "hi" }),
    });
    assert.match((await res.json()).text, /API key/);
  } finally {
    server.close();
  }
});

test("exports a default handler for the Vercel runtime", () => {
  assert.equal(typeof handler, "function");
});

// ------------------------------------------------------------------- auth ---

test("page and health check need no token; the API does", async () => {
  const app = await setup();
  try {
    assert.equal((await fetch(`${app.base}/healthz`)).status, 200);
    const page = await fetch(`${app.base}/`);
    assert.equal(page.status, 200);
    assert.ok((await page.text()).includes('id="token"'));
    assert.equal((await fetch(`${app.base}/api/status`)).status, 401);
    assert.equal((await fetch(`${app.base}/api/status`, { headers: { Authorization: "Bearer nope" } })).status, 401);
  } finally {
    app.close();
  }
});

// --------------------------------------------------------------- crypto -----

test("credentials encrypt and decrypt round-trip", () => {
  const cipher = createCipher(KEY);
  const blob = cipher.encrypt({ GHL_API_KEY: "secret-value" });
  assert.notEqual(blob.data, undefined);
  assert.ok(!JSON.stringify(blob).includes("secret-value"), "ciphertext must not contain the plaintext");
  assert.deepEqual(cipher.decrypt(blob), { GHL_API_KEY: "secret-value" });
});

test("with no key configured, storing credentials fails closed", () => {
  const cipher = createCipher(undefined);
  assert.equal(cipher.enabled, false);
  assert.throws(() => cipher.encrypt({ a: 1 }), /CREDENTIALS_KEY/);
});

test("a wrong-length key is rejected outright", () => {
  assert.throws(() => createCipher("abcd"), /64 hex characters/);
});

test("a tampered ciphertext does not decrypt", () => {
  const cipher = createCipher(KEY);
  const blob = cipher.encrypt({ a: "b" });
  const flipped = Buffer.from(blob.data, "base64");
  flipped[0] ^= 0xff;
  assert.throws(() => cipher.decrypt({ ...blob, data: flipped.toString("base64") }));
});

// ------------------------------------------------------------ businesses ----

test("businesses are created, listed, and resolved by partial name", async () => {
  const { directory } = wiring();
  await directory.add({ name: "Acme Roofing", kind: "agency" });
  await directory.add({ name: "Blue Bottle Store", kind: "shopify" });

  assert.deepEqual((await directory.list()).map((b) => b.name), ["Acme Roofing", "Blue Bottle Store"]);
  assert.equal((await directory.resolve("Acme Roofing")).name, "Acme Roofing");
  assert.equal((await directory.resolve("acme")).name, "Acme Roofing");
});

test("an ambiguous or unknown business name gives a useful error", async () => {
  const { directory } = wiring();
  await directory.add({ name: "Acme North" });
  await directory.add({ name: "Acme South" });

  await assert.rejects(() => directory.resolve("acme"), /matches several/);
  await assert.rejects(() => directory.resolve("Zeta"), /No business called "Zeta".*Acme North/s);
});

test("listings never include credentials, and stored credentials are ciphertext", async () => {
  const { directory, store } = wiring();
  await directory.add({ name: "Acme" });
  await directory.setCredentials("Acme", { GHL_API_KEY: "live-ghl-key" });

  for (const b of await directory.list()) {
    assert.equal(b.credentials, undefined, "credentials must not appear in listings");
  }
  const raw = JSON.stringify(await store.call("businesses.secrets", { business_id: (await directory.resolve("Acme")).id }));
  assert.ok(!raw.includes("live-ghl-key"), "stored blob must be encrypted");

  const business = await directory.resolve("Acme");
  assert.deepEqual(await directory.credentials(business.id), { GHL_API_KEY: "live-ghl-key" });
});

test("setting credentials merges rather than replacing", async () => {
  const { directory } = wiring();
  await directory.add({ name: "Acme" });
  await directory.setCredentials("Acme", { GHL_API_KEY: "one" });
  await directory.setCredentials("Acme", { SHOPIFY_ACCESS_TOKEN: "two" });
  const business = await directory.resolve("Acme");
  assert.deepEqual(await directory.credentials(business.id), { GHL_API_KEY: "one", SHOPIFY_ACCESS_TOKEN: "two" });
});

// ---------------------------------------------------------------- events ----

test("events carrying a provider id are recorded once", async () => {
  const { directory, store } = wiring();
  const business = await directory.add({ name: "Acme" });

  const first = await directory.record({
    businessId: business.id,
    source: "shopify",
    kind: "order.created",
    summary: "Order 1001",
    detail: { external_id: "1001" },
  });
  const second = await directory.record({
    businessId: business.id,
    source: "shopify",
    kind: "order.created",
    summary: "Order 1001",
    detail: { external_id: "1001" },
  });

  assert.equal(first.duplicate, undefined);
  assert.equal(second.duplicate, true);
  assert.equal((await store.call("events.list", { business_id: business.id })).length, 1);
});

test("events without a provider id are all kept", async () => {
  const { directory, store } = wiring();
  const business = await directory.add({ name: "Acme" });
  await directory.record({ businessId: business.id, source: "manual", kind: "call", summary: "Called client" });
  await directory.record({ businessId: business.id, source: "manual", kind: "call", summary: "Called client" });
  assert.equal((await store.call("events.list", { business_id: business.id })).length, 2);
});

test("a business only ever sees its own events", async () => {
  const { directory, store } = wiring();
  const a = await directory.add({ name: "Acme" });
  const b = await directory.add({ name: "Beta" });
  await directory.record({ businessId: a.id, source: "manual", kind: "note", summary: "for acme" });

  assert.equal((await store.call("events.list", { business_id: b.id })).length, 0);
  assert.equal((await directory.brief("Beta")).counts.events, 0);
});

// ----------------------------------------------------------------- brief ----

test("a brief gathers events and pending approvals for one business", async () => {
  const { directory, approvals } = wiring();
  const business = await directory.add({ name: "Acme" });
  await directory.record({ businessId: business.id, source: "gmail", kind: "email.unread", summary: "Email from a client" });
  await directory.record({ businessId: business.id, source: "shopify", kind: "order.created", summary: "Order 1002" });
  await approvals.propose({ action: "send_sms", businessId: business.id, summary: "SMS to contact c1", payload: {} });

  const brief = await directory.brief("Acme");
  assert.equal(brief.business.name, "Acme");
  assert.equal(brief.counts.events, 2);
  assert.equal(brief.counts.pendingApprovals, 1);
  assert.deepEqual(brief.counts.bySource, { gmail: 1, shopify: 1 });
});

test("a brief honours its time window", async () => {
  const { directory } = wiring();
  const business = await directory.add({ name: "Acme" });
  await directory.record({ businessId: business.id, source: "manual", kind: "note", summary: "now" });

  const future = new Date(Date.now() + 60000).toISOString();
  assert.equal((await directory.brief("Acme", future)).counts.events, 0);
});

test("an empty brief says it is empty instead of implying activity", () => {
  const spoken = narrateBrief(
    summarizeBrief({ business: { name: "Acme" }, events: [], pending: [], windowStart: new Date().toISOString() }),
  );
  assert.match(spoken, /Acme/);
  assert.match(spoken, /Nothing recorded/);
});

test("a populated brief names counts, sources, and what is waiting", () => {
  const spoken = narrateBrief(
    summarizeBrief({
      business: { name: "Acme" },
      events: [
        { source: "gmail", kind: "email.unread", summary: "Email from Dana" },
        { source: "shopify", kind: "order.created", summary: "Order 1002" },
      ],
      pending: [{ summary: "SMS to Dana" }],
      windowStart: new Date(Date.now() - 3600000).toISOString(),
    }),
  );
  assert.match(spoken, /2 events/);
  assert.match(spoken, /from gmail/);
  assert.match(spoken, /Email from Dana/);
  assert.match(spoken, /1 thing waiting for your approval/);
});

// ------------------------------------------------------------------ sync ----

test("sync records nothing for unconnected accounts and reports them", async () => {
  const { directory, connectorsFor } = wiring();
  const business = await directory.add({ name: "Acme" });

  const report = await syncBusiness({ directory, business, connectorsFor });
  assert.equal(report.recorded, 0);
  assert.deepEqual(report.notConnected.sort(), ["gmail", "shopify"]);
  assert.equal((await directory.brief("Acme")).counts.events, 0, "mock mode must not invent events");
});

test("sync records live orders, and a second sync adds nothing new", async () => {
  const orders = { orders: [{ id: 1001, name: "#1001", total_price: "42.00", currency: "USD" }] };
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => orders, text: async () => "" });
  const { directory, connectorsFor } = wiring({
    env: { SHOPIFY_ACCESS_TOKEN: "t", SHOPIFY_STORE_DOMAIN: "shop.myshopify.com" },
    fetchImpl,
  });
  const business = await directory.add({ name: "Acme" });

  const first = await syncBusiness({ directory, business, connectorsFor });
  assert.equal(first.recorded, 1);

  const second = await syncBusiness({ directory, business, connectorsFor });
  assert.equal(second.recorded, 0);
  assert.equal(second.duplicates, 1);

  const brief = await directory.brief("Acme");
  assert.equal(brief.counts.events, 1);
  assert.match(brief.events[0].summary, /Order #1001 for 42.00 USD/);
});

test("a failing connector is reported, not swallowed, and does not stop the sweep", async () => {
  const orders = { orders: [{ id: 7, name: "#7", total_price: "1.00", currency: "USD" }] };
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => orders, text: async () => "" });
  // Gmail has a token but no live implementation yet, so it throws.
  const { directory, connectorsFor } = wiring({
    env: {
      GMAIL_REFRESH_TOKEN: "r",
      SHOPIFY_ACCESS_TOKEN: "t",
      SHOPIFY_STORE_DOMAIN: "shop.myshopify.com",
    },
    fetchImpl,
  });
  const business = await directory.add({ name: "Acme" });

  const report = await syncBusiness({ directory, business, connectorsFor });
  assert.equal(report.recorded, 1, "shopify still recorded");
  assert.equal(report.errors.length, 1);
  assert.match(report.errors[0], /^gmail: /);
});

test("syncAll sweeps every business", async () => {
  const { directory, connectorsFor } = wiring();
  await directory.add({ name: "Acme" });
  await directory.add({ name: "Beta" });
  const out = await syncAll({ directory, connectorsFor });
  assert.equal(out.businesses, 2);
  assert.deepEqual(out.reports.map((r) => r.business), ["Acme", "Beta"]);
});

test("a business uses its own stored credentials over the app defaults", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(init.headers["X-Shopify-Access-Token"]);
    return { ok: true, status: 200, json: async () => ({ orders: [] }), text: async () => "" };
  };
  const { directory, connectorsFor } = wiring({
    env: { SHOPIFY_ACCESS_TOKEN: "app-default", SHOPIFY_STORE_DOMAIN: "default.myshopify.com" },
    fetchImpl,
  });
  const business = await directory.add({ name: "Acme" });
  await directory.setCredentials("Acme", { SHOPIFY_ACCESS_TOKEN: "acme-token" });

  await syncBusiness({ directory, business, connectorsFor });
  assert.deepEqual(seen, ["acme-token"]);
});

// ------------------------------------------------------- the approval gate --

test("a drafted SMS is queued, not sent, until approved", async () => {
  const app = await setup();
  try {
    const out = await app.tools.call("propose_sms", { contactId: "c1", message: "Hi" });
    assert.equal(out.status, "pending");
    assert.equal((await app.approvals.list("pending")).length, 1);

    const res = await fetch(`${app.base}/api/approvals/${out.id}/approve`, { method: "POST", headers: auth });
    const body = await res.json();
    assert.equal(body.item.status, "approved");
    assert.equal(body.item.result.mock, true, "mock mode must not hit the network");
  } finally {
    app.close();
  }
});

test("rejecting an approval never runs the action", async () => {
  const app = await setup();
  try {
    const item = await app.approvals.propose({ action: "send_sms", summary: "x", payload: {} });
    const res = await fetch(`${app.base}/api/approvals/${item.id}/reject`, { method: "POST", headers: auth });
    const body = await res.json();
    assert.equal(body.item.status, "rejected");
    assert.equal(body.item.result, undefined);
  } finally {
    app.close();
  }
});

test("an item can only be decided once", async () => {
  const { approvals } = wiring();
  const item = await approvals.propose({ action: "send_sms", summary: "x", payload: {} });
  await approvals.decide(item.id, "reject");
  await assert.rejects(() => approvals.decide(item.id, "approve", async () => ({})), /already rejected/);
});

test("a failing side effect marks the item failed, not approved", async () => {
  const { approvals } = wiring();
  const item = await approvals.propose({ action: "publish_post", summary: "x", payload: {} });
  const done = await approvals.decide(item.id, "approve", async () => {
    throw new Error("provider down");
  });
  assert.equal(done.status, "failed");
  assert.equal(done.error, "provider down");
});

test("a drafted action is tagged with its business and filtered by it", async () => {
  const app = await setup();
  try {
    await app.directory.add({ name: "Acme" });
    await app.directory.add({ name: "Beta" });
    const acme = await app.directory.resolve("Acme");

    await app.tools.call("propose_social_post", { business: "Acme", platforms: ["linkedin"], text: "Hello" });
    const forAcme = await app.approvals.list("pending", acme.id);
    assert.equal(forAcme.length, 1);
    assert.equal(forAcme[0].businessId, acme.id);
    assert.match(forAcme[0].summary, /\(Acme\)/);

    const beta = await app.directory.resolve("Beta");
    assert.equal((await app.approvals.list("pending", beta.id)).length, 0);
  } finally {
    app.close();
  }
});

test("approving an action for a business records it as an event", async () => {
  const app = await setup();
  try {
    await app.directory.add({ name: "Acme" });
    const draft = await app.tools.call("propose_sms", { business: "Acme", contactId: "c1", message: "Hi" });
    await fetch(`${app.base}/api/approvals/${draft.id}/approve`, { method: "POST", headers: auth });

    const brief = await app.directory.brief("Acme");
    assert.equal(brief.counts.events, 1);
    assert.match(brief.events[0].summary, /Approved and ran/);
  } finally {
    app.close();
  }
});

test("the executor uses the business's own credentials and refuses unknown actions", async () => {
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push(init.headers.Authorization);
    return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => "" };
  };
  const w = wiring({ env: { GHL_API_KEY: "app-default" }, fetchImpl });
  await w.directory.add({ name: "Acme" });
  await w.directory.setCredentials("Acme", { GHL_API_KEY: "acme-ghl" });
  const acme = await w.directory.resolve("Acme");

  const execute = executorFor(w);
  await execute({ action: "send_sms", businessId: acme.id, payload: { contactId: "c1", message: "hi" } });
  assert.deepEqual(sent, ["Bearer acme-ghl"]);

  await assert.rejects(() => execute({ action: "delete_everything", payload: {} }), /No executor/);
});

// ------------------------------------------------------------- HTTP API -----

test("businesses can be created and listed over HTTP", async () => {
  const app = await setup();
  try {
    const created = await fetch(`${app.base}/api/businesses`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "Acme", kind: "agency" }),
    });
    assert.equal((await created.json()).business.name, "Acme");

    const listed = await fetch(`${app.base}/api/businesses`, { headers: auth });
    assert.deepEqual((await listed.json()).businesses.map((b) => b.name), ["Acme"]);

    const bad = await fetch(`${app.base}/api/businesses`, { method: "POST", headers: auth, body: JSON.stringify({}) });
    assert.equal(bad.status, 400);
  } finally {
    app.close();
  }
});

test("the brief endpoint returns a spoken summary, and 404s an unknown business", async () => {
  const app = await setup();
  try {
    await app.directory.add({ name: "Acme" });
    const res = await fetch(`${app.base}/api/brief?business=Acme`, { headers: auth });
    assert.equal(res.status, 200);
    assert.match((await res.json()).spoken, /Acme/);

    const missing = await fetch(`${app.base}/api/brief?business=Nope`, { headers: auth });
    assert.equal(missing.status, 404);

    const noArg = await fetch(`${app.base}/api/brief`, { headers: auth });
    assert.equal(noArg.status, 400);
  } finally {
    app.close();
  }
});

test("the sync endpoint reports what is not connected", async () => {
  const app = await setup();
  try {
    await app.directory.add({ name: "Acme" });
    const res = await fetch(`${app.base}/api/sync`, { method: "POST", headers: auth });
    const out = await res.json();
    assert.equal(out.businesses, 1);
    assert.deepEqual(out.reports[0].notConnected.sort(), ["gmail", "shopify"]);
  } finally {
    app.close();
  }
});

test("storing credentials over HTTP returns key names, never values", async () => {
  const app = await setup();
  try {
    await app.directory.add({ name: "Acme" });
    const res = await fetch(`${app.base}/api/credentials`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ business: "Acme", credentials: { GHL_API_KEY: "super-secret" } }),
    });
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.ok(!body.includes("super-secret"), "response must not echo the secret");
    assert.deepEqual(JSON.parse(body).keys, ["GHL_API_KEY"]);
  } finally {
    app.close();
  }
});

test("without an encryption key the credentials endpoint refuses rather than storing plaintext", async () => {
  const store = new LocalStore(null);
  const cipher = createCipher(undefined);
  const directory = new Directory({ store, cipher });
  const { server } = createApp(
    { AGENT_TOKEN: TOKEN },
    { store, cipher, directory, approvals: new ApprovalQueue(store), agent: { respond: async () => ({ text: "" }) } },
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    await directory.add({ name: "Acme" });
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/credentials`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ business: "Acme", credentials: { GHL_API_KEY: "x" } }),
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /CREDENTIALS_KEY/);
  } finally {
    server.close();
  }
});

test("chat validates the message and returns the agent reply", async () => {
  const app = await setup({ agentReply: "You have 2 new emails." });
  try {
    const ok = await fetch(`${app.base}/api/chat`, { method: "POST", headers: auth, body: JSON.stringify({ message: "check email" }) });
    assert.equal((await ok.json()).text, "You have 2 new emails.");

    const empty = await fetch(`${app.base}/api/chat`, { method: "POST", headers: auth, body: JSON.stringify({ message: "  " }) });
    assert.equal(empty.status, 400);

    const big = await fetch(`${app.base}/api/chat`, { method: "POST", headers: auth, body: JSON.stringify({ message: "x".repeat(5000) }) });
    assert.equal(big.status, 400);
  } finally {
    app.close();
  }
});

// ------------------------------------------------------------------ store ---

test("the remote store posts ops to the edge function with the key and token", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return { ok: true, status: 200, text: async () => JSON.stringify({ result: [{ id: "1", name: "Acme" }] }) };
  };
  const store = new RemoteStore({
    url: "https://x.supabase.co/functions/v1/store",
    apiKey: "sb_publishable_x",
    storeToken: "shared",
    fetchImpl,
  });

  const result = await store.call("businesses.list");
  assert.deepEqual(result, [{ id: "1", name: "Acme" }]);
  assert.equal(calls[0].url, "https://x.supabase.co/functions/v1/store");
  assert.equal(calls[0].headers.apikey, "sb_publishable_x");
  assert.equal(calls[0].headers["x-jarvis-token"], "shared");
  assert.deepEqual(calls[0].body, { op: "businesses.list", input: {} });
});

test("the remote store surfaces the function's error message", async () => {
  const store = new RemoteStore({
    url: "https://x/store",
    apiKey: "k",
    fetchImpl: async () => ({ ok: false, status: 500, text: async () => JSON.stringify({ error: "unknown business" }) }),
  });
  await assert.rejects(() => store.call("brief", {}), /unknown business/);
});

// ------------------------------------------------------------------ agent ---

test("the agent runs a tool call then returns the final answer", async () => {
  const calls = [];
  const fakeFetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    if (calls.length === 1) {
      return jsonResponse({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "t1", name: "list_recent_orders", input: { limit: 2 } }],
      });
    }
    return jsonResponse({ stop_reason: "end_turn", content: [{ type: "text", text: "No orders yet." }] });
  };
  const w = wiring({ fetchImpl: fakeFetch });
  const agent = createAgent({ apiKey: "k", model: "claude-sonnet-5-5", tools: w.tools, fetchImpl: fakeFetch });

  const result = await agent.respond([], "any orders?");
  assert.equal(result.text, "No orders yet.");
  assert.deepEqual(result.toolsUsed, ["list_recent_orders"]);
  assert.equal(calls[1].messages.at(-1).content[0].type, "tool_result");
});

test("the agent is told never to send without approval", () => {
  const { tools } = wiring();
  const names = tools.schemas.map((s) => s.name);
  assert.ok(names.includes("propose_sms"));
  assert.ok(!names.some((n) => n.startsWith("send_")), "no tool may send directly");
  for (const schema of tools.schemas) {
    assert.ok(schema.description.length > 0, `${schema.name} needs a description`);
  }
});

test("a brief tool result carries a spoken line for text-to-speech", async () => {
  const { tools, directory } = wiring();
  await directory.add({ name: "Acme" });
  const out = await tools.call("business_brief", { business: "Acme", hours: 24 });
  assert.match(out.spoken, /Acme/);
});

test("tools report unknown businesses as an error instead of throwing", async () => {
  const { tools } = wiring();
  const out = await tools.call("business_brief", { business: "Ghost" });
  assert.match(out.error, /No businesses set up yet/);
});

function jsonResponse(data) {
  return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
}
