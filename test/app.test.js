import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server.js";
import { ApprovalQueue, FileStore, SupabaseStore } from "../src/approvals.js";
import { createConnectors } from "../src/connectors.js";
import { buildTools, executorFor } from "../src/tools.js";
import { createAgent } from "../src/agent.js";

const TOKEN = "test-token-1234567890";
const tmpFile = (name = "approvals.json") => join(mkdtempSync(join(tmpdir(), "jarvis-test-")), name);

function setup({ agentReply } = {}) {
  const approvals = new ApprovalQueue(new FileStore(tmpFile()));
  const connectors = createConnectors({}, async () => {
    throw new Error("network should not be called in mock mode");
  });
  const tools = buildTools({ connectors, approvals });
  const agent = {
    respond: async (_history, text) => ({ text: agentReply ?? `echo: ${text}`, toolsUsed: [] }),
  };
  const { server } = createApp({ AGENT_TOKEN: TOKEN }, { approvals, connectors, agent, tools });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({ base, approvals, connectors, close: () => server.close() });
    });
  });
}

const auth = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

test("refuses to start with a weak or missing token", () => {
  assert.throws(() => createApp({ AGENT_TOKEN: "short" }), /AGENT_TOKEN/);
  assert.throws(() => createApp({}), /AGENT_TOKEN/);
});

test("starts without an Anthropic key and says so in chat", async () => {
  const { server } = createApp({ AGENT_TOKEN: TOKEN, APPROVALS_FILE: tmpFile() });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
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

test("health check needs no token", async () => {
  const app = await setup();
  try {
    assert.equal((await fetch(`${app.base}/healthz`)).status, 200);
  } finally {
    app.close();
  }
});

test("API rejects missing or wrong token", async () => {
  const app = await setup();
  try {
    assert.equal((await fetch(`${app.base}/api/status`)).status, 401);
    const wrong = await fetch(`${app.base}/api/status`, { headers: { Authorization: "Bearer nope" } });
    assert.equal(wrong.status, 401);
  } finally {
    app.close();
  }
});

test("chat returns the agent reply", async () => {
  const app = await setup({ agentReply: "You have 2 new emails." });
  try {
    const res = await fetch(`${app.base}/api/chat`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ message: "check my email" }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).text, "You have 2 new emails.");
  } finally {
    app.close();
  }
});

test("chat rejects empty and oversized messages", async () => {
  const app = await setup();
  try {
    const empty = await fetch(`${app.base}/api/chat`, { method: "POST", headers: auth, body: JSON.stringify({ message: "  " }) });
    assert.equal(empty.status, 400);
    const big = await fetch(`${app.base}/api/chat`, { method: "POST", headers: auth, body: JSON.stringify({ message: "x".repeat(5000) }) });
    assert.equal(big.status, 400);
  } finally {
    app.close();
  }
});

test("send_sms is queued, not sent, until approved", async () => {
  const app = await setup();
  try {
    const tools = buildTools({ connectors: app.connectors, approvals: app.approvals });
    const out = await tools.call("propose_sms", { contactId: "c1", message: "Hi" });
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
  const queue = new ApprovalQueue(new FileStore(tmpFile()));
  const item = await queue.propose({ action: "send_sms", summary: "x", payload: {} });
  await queue.decide(item.id, "reject");
  await assert.rejects(() => queue.decide(item.id, "approve", async () => ({})), /already rejected/);
});

test("a failing side effect marks the item failed, not approved", async () => {
  const queue = new ApprovalQueue(new FileStore(tmpFile()));
  const item = await queue.propose({ action: "publish_post", summary: "x", payload: {} });
  const done = await queue.decide(item.id, "approve", async () => {
    throw new Error("provider down");
  });
  assert.equal(done.status, "failed");
  assert.equal(done.error, "provider down");
});

test("file approval queue persists across restarts", async () => {
  const file = tmpFile();
  await new ApprovalQueue(new FileStore(file)).propose({ action: "send_sms", summary: "keep me", payload: {} });
  const [item] = await new ApprovalQueue(new FileStore(file)).list("pending");
  assert.equal(item.summary, "keep me");
});

test("Supabase store sends approvals to the approvals table with the secret key", async () => {
  const requests = [];
  const row = (over = {}) => ({
    id: "11111111-1111-1111-1111-111111111111",
    action: "send_sms",
    summary: "SMS to c1",
    payload: { contactId: "c1" },
    status: "pending",
    result: null,
    error: null,
    created_at: "2026-10-15T00:00:00Z",
    decided_at: null,
    ...over,
  });
  const fakeFetch = async (url, init) => {
    requests.push({ url, init });
    const body = init.method === "GET" ? [] : [row(init.method === "PATCH" ? { status: "rejected" } : {})];
    return { ok: true, status: 200, json: async () => (init.method === "GET" && url.includes("id=eq") ? [row()] : body), text: async () => "" };
  };
  const store = new SupabaseStore({ url: "https://x.supabase.co", key: "sb_secret_test", fetchImpl: fakeFetch });
  const queue = new ApprovalQueue(store);

  const created = await queue.propose({ action: "send_sms", summary: "SMS to c1", payload: { contactId: "c1" } });
  assert.equal(created.status, "pending");
  assert.equal(requests[0].url, "https://x.supabase.co/rest/v1/approvals");
  assert.equal(requests[0].init.headers.apikey, "sb_secret_test");

  const rejected = await queue.decide(created.id, "reject");
  assert.equal(rejected.status, "rejected");
  assert.equal(requests.at(-1).init.method, "PATCH");
});

test("executor refuses unknown actions", async () => {
  const exec = executorFor(createConnectors({}, fetch));
  await assert.rejects(() => exec({ action: "delete_everything", payload: {} }), /No executor/);
});

test("agent runs a tool call then returns the final answer", async () => {
  const calls = [];
  const fakeFetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    if (calls.length === 1) {
      return jsonResponse({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "t1", name: "list_recent_orders", input: { limit: 2 } }],
      });
    }
    return jsonResponse({ stop_reason: "end_turn", content: [{ type: "text", text: "No orders yet." }] });
  };
  const connectors = createConnectors({}, fakeFetch);
  const tools = buildTools({ connectors, approvals: new ApprovalQueue(new FileStore(tmpFile())) });
  const agent = createAgent({ apiKey: "k", model: "claude-sonnet-5-5", tools, fetchImpl: fakeFetch });

  const result = await agent.respond([], "any orders?");
  assert.equal(result.text, "No orders yet.");
  assert.deepEqual(result.toolsUsed, ["list_recent_orders"]);
  assert.equal(calls[1].messages.at(-1).content[0].type, "tool_result");
});

function jsonResponse(data) {
  return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
}
