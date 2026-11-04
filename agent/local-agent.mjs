#!/usr/bin/env node
//
// Jarvis local agent — the piece that runs on YOUR laptop.
//
// Why this exists: the Jarvis server runs in a datacenter and cannot reach your
// machine. This program runs on the laptop, calls out to the server, and does
// the local work itself. Nothing listens for inbound connections, so there is
// no port to open and nothing for the internet to reach.
//
//   laptop                          cloud
//   ------                          -----
//   local-agent  --- polls --->     /api/tasks      (what was approved?)
//   local-agent  --- posts --->     /api/tasks/:id  (here is what happened)
//
// It will only run commands listed in its own config file, on this machine,
// under your account. Deliberately NOT a remote shell: a 24/7 agent reachable
// from a public URL that could run anything would mean one leaked token equals
// total control of your laptop. You widen what it can do by editing the
// allowlist yourself.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);

const MAX_OUTPUT = 4000;
const DEFAULT_POLL_SECONDS = 10;
const COMMAND_TIMEOUT_MS = 120_000;

function loadConfig(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (!raw.server) throw new Error("config needs a server URL");
  if (!raw.token) throw new Error("config needs the token you use to unlock Jarvis");
  if (!raw.allow || typeof raw.allow !== "object" || !Object.keys(raw.allow).length) {
    throw new Error("config needs an allow list; without it this agent can do nothing");
  }
  return {
    server: raw.server.replace(/\/$/, ""),
    token: raw.token,
    pollSeconds: Math.max(Number(raw.pollSeconds) || DEFAULT_POLL_SECONDS, 2),
    allow: raw.allow,
  };
}

// Resolves a task to a real command, or explains why it will not run.
// The task never supplies the program to execute — only which allowlist entry
// to use, and arguments if that entry permits them.
export function planCommand(allow, task) {
  const name = String(task?.command ?? "").trim();
  const entry = allow[name];
  if (!entry) {
    return { refused: `"${name}" is not in this laptop's allow list.` };
  }

  const supplied = Array.isArray(task.args) ? task.args.map(String) : [];
  if (supplied.length && !entry.argsAllowed) {
    return { refused: `"${name}" does not accept arguments.` };
  }
  for (const arg of supplied) {
    // Arguments are passed as argv, never through a shell, so quoting cannot
    // escape. This blocks the obvious path-climbing mistakes anyway.
    if (arg.includes("..") || arg.includes("\0")) {
      return { refused: `"${name}" was given an argument that is not allowed.` };
    }
  }

  return {
    file: entry.run,
    args: [...(entry.args ?? []), ...supplied],
    cwd: entry.cwd,
  };
}

async function execute(allow, task) {
  const plan = planCommand(allow, task);
  if (plan.refused) return { ok: false, output: plan.refused, refused: true };

  try {
    const { stdout, stderr } = await run(plan.file, plan.args, {
      cwd: plan.cwd,
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    const output = `${stdout ?? ""}${stderr ? `\n${stderr}` : ""}`.trim();
    return { ok: true, output: output.slice(0, MAX_OUTPUT) || "(no output)" };
  } catch (err) {
    const detail = `${err.message}${err.stdout ? `\n${err.stdout}` : ""}${err.stderr ? `\n${err.stderr}` : ""}`;
    return { ok: false, output: detail.slice(0, MAX_OUTPUT) };
  }
}

function api(config, fetchImpl) {
  return async (path, options = {}) => {
    const res = await fetchImpl(`${config.server}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
        ...(options.headers ?? {}),
      },
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(`${path} -> ${res.status}: ${body.error ?? "failed"}`);
    return body;
  };
}

// One pass: take whatever has been approved, run it, report back.
export async function pollOnce(config, fetchImpl = fetch, log = console.log) {
  const call = api(config, fetchImpl);
  const { tasks } = await call("/api/tasks");
  if (!tasks.length) return { ran: 0 };

  for (const task of tasks) {
    log(`running ${task.command}${task.args?.length ? ` ${task.args.join(" ")}` : ""}`);
    const result = await execute(config.allow, task);
    await call(`/api/tasks/${encodeURIComponent(task.id)}`, {
      method: "POST",
      body: JSON.stringify(result),
    });
    log(result.ok ? "  done" : `  ${result.refused ? "refused" : "failed"}: ${result.output.split("\n")[0]}`);
  }
  return { ran: tasks.length };
}

async function main() {
  const configPath = process.argv[2] ?? "./jarvis-agent.config.json";
  const config = loadConfig(configPath);

  console.log(`Jarvis local agent`);
  console.log(`  server:  ${config.server}`);
  console.log(`  allowed: ${Object.keys(config.allow).join(", ")}`);
  console.log(`  polling every ${config.pollSeconds}s. Ctrl+C to stop.\n`);

  for (;;) {
    try {
      await pollOnce(config);
    } catch (err) {
      // A laptop closes its lid and loses wifi. Keep going rather than exiting.
      console.error(`poll failed: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, config.pollSeconds * 1000));
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
