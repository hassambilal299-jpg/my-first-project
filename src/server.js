import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { ApprovalQueue } from "./approvals.js";
import { RemoteStore, LocalStore } from "./store.js";
import { Directory, narrateBrief } from "./businesses.js";
import { createCipher } from "./crypto.js";
import { createConnectors } from "./connectors.js";
import { buildTools, executorFor } from "./tools.js";
import { createAgent } from "./agent.js";
import { syncAll } from "./sync.js";
import { runCommand, HELP } from "./commands.js";
import { INDEX_HTML } from "./ui.js";

const here = dirname(fileURLToPath(import.meta.url));
const MAX_BODY_BYTES = 64 * 1024;
const MAX_HISTORY = 20;
// Haiku is the cheapest model and is ample for chat and brief narration.
// Override with ANTHROPIC_MODEL to trade cost for depth.
const DEFAULT_MODEL = "claude-haiku-5-5";

export function createApp(env = process.env, deps = {}) {
  const token = env.AGENT_TOKEN;
  if (!token || token.length < 16) {
    throw new Error("AGENT_TOKEN must be set and at least 16 characters. Refusing to start without it.");
  }

  // Supabase in production; a JSON file locally. Both expose the same ops.
  const store =
    deps.store ??
    (env.SUPABASE_STORE_URL && env.SUPABASE_API_KEY
      ? new RemoteStore({
          url: env.SUPABASE_STORE_URL,
          apiKey: env.SUPABASE_API_KEY,
          storeToken: env.JARVIS_STORE_TOKEN,
        })
      : new LocalStore(env.STORE_FILE ?? (env.VERCEL ? "/tmp/jarvis-store.json" : join(here, "..", "data", "store.json"))));

  const cipher = deps.cipher ?? createCipher(env.CREDENTIALS_KEY);
  const directory = deps.directory ?? new Directory({ store, cipher });
  const approvals = deps.approvals ?? new ApprovalQueue(store);

  // Env vars act as the default credential set (the owner's own accounts);
  // a business's stored credentials override them.
  const connectorsFor = deps.connectorsFor ?? ((credentials) => createConnectors({ ...env, ...credentials }));
  const defaultConnectors = deps.defaultConnectors ?? connectorsFor({});

  const tools = deps.tools ?? buildTools({ directory, approvals, connectorsFor, defaultConnectors });
  const execute = executorFor({ directory, connectorsFor, defaultConnectors });

  // Without a Claude key the deterministic commands still work, so say what
  // is possible rather than just reporting a missing key.
  const missingKeyAgent = {
    respond: async () => ({
      text: `I don't have an AI key yet, so I can't handle free-form questions. ${HELP}`,
      toolsUsed: [],
    }),
  };
  const agent =
    deps.agent ??
    (env.ANTHROPIC_API_KEY
      ? createAgent({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL ?? DEFAULT_MODEL, tools })
      : missingKeyAgent);

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

      // Readiness probe. Reports whether the datastore answers, without
      // exposing any of its contents, so a deploy can be verified end to end.
      if (req.method === "GET" && url.pathname === "/healthz") {
        const storage = store instanceof RemoteStore ? "supabase" : "local file";
        let storeReachable = false;
        let storeError;
        try {
          await store.call("businesses.list");
          storeReachable = true;
        } catch (err) {
          storeError = err.message;
        }
        return send(res, 200, {
          ok: true,
          storage,
          storeReachable,
          ...(storeError ? { storeError } : {}),
          credentialsEncryption: cipher.enabled,
          claudeKey: Boolean(env.ANTHROPIC_API_KEY),
        });
      }
      if (req.method === "GET" && url.pathname === "/") {
        return send(res, 200, INDEX_HTML, "text/html; charset=utf-8");
      }

      // Everything below requires the token.
      if (!authorized(req)) return send(res, 401, { error: "Unauthorized" });

      if (req.method === "GET" && url.pathname === "/api/status") {
        return send(res, 200, {
          connectors: defaultConnectors.status(),
          model: env.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
          storage: store instanceof RemoteStore ? "supabase" : "local file",
          credentialsEncryption: cipher.enabled,
          businesses: await directory.list().catch(() => []),
        });
      }

      if (req.method === "POST" && url.pathname === "/api/chat") {
        const { message } = await readJson(req);
        if (typeof message !== "string" || !message.trim() || message.length > 4000) {
          return send(res, 400, { error: "message must be 1-4000 characters" });
        }
        const text = message.trim();

        // Deterministic commands run first: instant, and they cost nothing.
        // Anything they do not recognise goes to Claude.
        const command = await runCommand(text, { directory, approvals, connectorsFor });
        if (command) {
          return send(res, 200, { text: command.text, command: command.command, usedAI: false });
        }

        const result = await agent.respond(history, text);
        history.push({ role: "user", content: text });
        history.push({ role: "assistant", content: result.text || "(no reply)" });
        history = history.slice(-MAX_HISTORY);
        return send(res, 200, { text: result.text, toolsUsed: result.toolsUsed, usedAI: true });
      }

      if (req.method === "GET" && url.pathname === "/api/businesses") {
        return send(res, 200, { businesses: await directory.list() });
      }

      if (req.method === "POST" && url.pathname === "/api/businesses") {
        const { name, kind } = await readJson(req);
        if (!name || typeof name !== "string") return send(res, 400, { error: "name is required" });
        return send(res, 200, { business: await directory.add({ name, kind }) });
      }

      // Store a business's connector credentials, encrypted.
      if (req.method === "POST" && url.pathname === "/api/credentials") {
        const { business, credentials } = await readJson(req);
        if (!business || !credentials || typeof credentials !== "object") {
          return send(res, 400, { error: "business and credentials are required" });
        }
        if (!cipher.enabled) {
          return send(res, 400, { error: "CREDENTIALS_KEY is not set, so credentials cannot be stored." });
        }
        return send(res, 200, await directory.setCredentials(business, credentials));
      }

      if (req.method === "GET" && url.pathname === "/api/brief") {
        const name = url.searchParams.get("business");
        const hours = Number(url.searchParams.get("hours") ?? 24);
        if (!name) return send(res, 400, { error: "business is required" });
        const since = new Date(Date.now() - Math.min(Math.max(hours, 1), 720) * 3600000).toISOString();
        const brief = await directory.brief(name, since);
        return send(res, 200, { spoken: narrateBrief(brief), ...brief });
      }

      // The scheduled sweep. Reads every business's connectors and records what
      // is new, so briefs are current without anyone asking.
      if (req.method === "POST" && url.pathname === "/api/sync") {
        return send(res, 200, await syncAll({ directory, connectorsFor }));
      }

      if (req.method === "GET" && url.pathname === "/api/approvals") {
        const business = url.searchParams.get("business");
        const resolved = business ? await directory.resolve(business) : null;
        return send(res, 200, {
          items: await approvals.list(url.searchParams.get("status") ?? undefined, resolved?.id),
        });
      }

      const match = url.pathname.match(/^\/api\/approvals\/([^/]+)\/(approve|reject)$/);
      if (req.method === "POST" && match) {
        const [, id, decision] = match;
        const item = await approvals.decide(id, decision === "approve" ? "approve" : "reject", execute);
        // An approved action is itself something that happened in the business.
        if (item.businessId && item.status === "approved") {
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
        return send(res, 200, { item });
      }

      return send(res, 404, { error: "Not found" });
    } catch (err) {
      // Errors tagged with a status (or raised by the approval queue for a
      // missing item) are the caller's to fix, so pass the message through.
      // Anything else is ours: log it and stay vague to the client.
      const status = err.status ?? (/^No approval item/.test(err.message ?? "") ? 404 : 500);
      if (status === 500) console.error(err);
      return send(res, status, { error: status === 500 ? "Internal error" : err.message });
    }
  };

  return { server: createServer(handle), handle, approvals, directory, store };
}

// Vercel's Node runtime imports this module and calls the default export.
// The app is built on the first request so a config error surfaces as a 500
// with a readable message instead of killing the process at import time.
let hosted;
export default function handler(req, res) {
  hosted ??= createApp(process.env);
  return hosted.handle(req, res);
}

// Start a real listener only when run directly (local dev, Docker).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000);
  const { server } = createApp(process.env);
  server.listen(port, () => console.log(`Jarvis listening on :${port}`));
}
