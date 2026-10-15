import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { ApprovalQueue } from "./approvals.js";
import { createConnectors } from "./connectors.js";
import { buildTools, executorFor } from "./tools.js";
import { createAgent } from "./agent.js";

const here = dirname(fileURLToPath(import.meta.url));
const MAX_BODY_BYTES = 64 * 1024;
const MAX_HISTORY = 20;

export function createApp(env = process.env, deps = {}) {
  const token = env.AGENT_TOKEN;
  if (!token || token.length < 16) {
    throw new Error("AGENT_TOKEN must be set and at least 16 characters. Refusing to start without it.");
  }

  const defaultApprovals = env.VERCEL ? "/tmp/approvals.json" : join(here, "..", "data", "approvals.json");
  const approvals = deps.approvals ?? new ApprovalQueue(env.APPROVALS_FILE ?? defaultApprovals);
  const connectors = deps.connectors ?? createConnectors(env);
  const tools = buildTools({ connectors, approvals });
  const missingKeyAgent = {
    respond: async () => ({ text: "The Claude API key isn't set on the server yet. Ask the owner to add ANTHROPIC_API_KEY.", toolsUsed: [] }),
  };
  const agent =
    deps.agent ??
    (env.ANTHROPIC_API_KEY
      ? createAgent({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5", tools })
      : missingKeyAgent);
  const execute = executorFor(connectors);
  const indexHtml = readFileSync(join(here, "..", "public", "index.html"));

  let history = [];

  function authorized(req) {
    const header = req.headers.authorization ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
    const a = Buffer.from(provided);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  function send(res, status, body, type = "application/json") {
    res.writeHead(status, {
      "Content-Type": type,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(type === "application/json" ? JSON.stringify(body) : body);
  }

  async function readJson(req) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Body too large"), { status: 413 });
      chunks.push(chunk);
    }
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
  }

  const handle = async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");

      if (req.method === "GET" && url.pathname === "/healthz") {
        return send(res, 200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/") {
        return send(res, 200, indexHtml, "text/html; charset=utf-8");
      }

      // Everything below requires the token.
      if (!authorized(req)) return send(res, 401, { error: "Unauthorized" });

      if (req.method === "GET" && url.pathname === "/api/status") {
        return send(res, 200, { connectors: connectors.status(), model: env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5" });
      }

      if (req.method === "POST" && url.pathname === "/api/chat") {
        const { message } = await readJson(req);
        if (typeof message !== "string" || !message.trim() || message.length > 4000) {
          return send(res, 400, { error: "message must be 1-4000 characters" });
        }
        const result = await agent.respond(history, message.trim());
        history.push({ role: "user", content: message.trim() });
        history.push({ role: "assistant", content: result.text || "(no reply)" });
        history = history.slice(-MAX_HISTORY);
        return send(res, 200, { text: result.text, toolsUsed: result.toolsUsed });
      }

      if (req.method === "GET" && url.pathname === "/api/approvals") {
        return send(res, 200, { items: approvals.list(url.searchParams.get("status") ?? undefined) });
      }

      const match = url.pathname.match(/^\/api\/approvals\/([^/]+)\/(approve|reject)$/);
      if (req.method === "POST" && match) {
        const [, id, decision] = match;
        const item = await approvals.decide(id, decision === "approve" ? "approve" : "reject", execute);
        return send(res, 200, { item });
      }

      return send(res, 404, { error: "Not found" });
    } catch (err) {
      const status = err.status ?? (err.message?.includes("No approval item") ? 404 : 500);
      if (status === 500) console.error(err);
      return send(res, status, { error: status === 500 ? "Internal error" : err.message });
    }
  };

  return { server: createServer(handle), handle, approvals };
}

// Start only when run directly, not when imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000);
  const { server } = createApp(process.env);
  server.listen(port, () => console.log(`Jarvis listening on :${port}`));
}
