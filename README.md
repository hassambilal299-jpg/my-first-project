# Jarvis — AI operations assistant

A voice-first assistant that runs day-to-day operations across several client
businesses: email, SMS (GoHighLevel), social posting, and Shopify orders. Ask it
what is happening in any business and it tells you.

**Live:** https://jarvis-hb-designers.vercel.app

## How it works

```
Browser (voice in/out)
      |
      v
Vercel  /api/chat ---> Claude (tool use) ---> connectors (per business)
        /api/brief                   |
        /api/sync  (daily cron)      v
      |                      approval queue
      v                             |
Supabase Edge Function  <-----------+
      |  (service role; app never holds the secret key)
      v
Postgres: businesses, events, approvals
```

Three ideas carry the whole design:

1. **A business is the unit.** Each client workspace has its own connector
   credentials, its own event history, and its own brief. Nothing leaks across
   them, and that boundary is tested.
2. **Everything that happens becomes an event.** The sweep (`/api/sync`) reads
   each business's connected accounts and records what it finds. A brief then
   answers "what happened in the last 24 hours", not just "what is true now".
3. **The agent drafts; you approve.** Reading is free. Anything that leaves the
   building — an SMS, a published post — becomes a pending approval and runs
   only after you press Approve. This is the core safety property.

## Security

- **Client credentials are encrypted** with AES-256-GCM before storage, using
  `CREDENTIALS_KEY`, which lives only in the app environment. The database holds
  ciphertext; a full database read yields no usable client API keys. With no key
  configured the app refuses to store credentials rather than writing plaintext.
- **The database is reached through an Edge Function**, not PostgREST. It exposes
  a fixed list of operations, has no delete, and never returns credentials in a
  listing. Set `JARVIS_STORE_TOKEN` in the Supabase dashboard (Edge Functions →
  Secrets) to require a second shared secret on every call; the function enforces
  it automatically once present.
- **Row-level security is on with no policies**, so the publishable key cannot
  touch these tables directly.
- **`AGENT_TOKEN` guards every API route**, compared in constant time. Vercel SSO
  sits in front of the `*.vercel.app` URL as an additional layer.

## Environment variables

| Variable | Required | What it does |
|---|---|---|
| `AGENT_TOKEN` | yes | The password you type into the app. 16+ chars. |
| `ANTHROPIC_API_KEY` | yes | Claude API key. Without it the app loads but chat says the key is missing. |
| `ANTHROPIC_MODEL` | no | Defaults to `claude-sonnet-5-5`. |
| `CREDENTIALS_KEY` | for clients | 64 hex chars. Encrypts client credentials. Without it, storing them is refused. |
| `SUPABASE_STORE_URL` | for persistence | The Edge Function URL. Without it, storage falls back to a local JSON file. |
| `SUPABASE_API_KEY` | for persistence | Supabase publishable key. |
| `JARVIS_STORE_TOKEN` | no | Optional second lock on the Edge Function. Set it in Supabase, not here. |
| `CRON_SECRET` | no | Set to the same value as `AGENT_TOKEN` so the daily sweep authenticates. |
| `GHL_API_KEY` | no | GoHighLevel. Blank = SMS in mock mode. |
| `GMAIL_REFRESH_TOKEN` | no | Gmail. Blank = mock mode. |
| `SHOPIFY_ACCESS_TOKEN`, `SHOPIFY_STORE_DOMAIN` | no | Shopify orders. |
| `SOCIAL_API_KEY` | no | Social publishing provider. |

Connector variables set here are **defaults** for your own accounts. A business's
stored credentials override them, so each client can use their own.

Every connector runs in **mock mode** until credentials exist. Mock mode makes no
network call, says so in its response, and records no events — an empty brief is
better than a brief full of invented activity.

## Run locally

```bash
cp .env.example .env     # fill in AGENT_TOKEN and ANTHROPIC_API_KEY
npm start                # http://localhost:3000
npm test                 # 46 tests, no network needed
npm run build:ui         # after editing public/index.html
```

`public/index.html` is the editable page; `src/ui.js` is generated from it,
because Vercel does not trace `readFileSync` paths into the function bundle. A
test fails if the two drift.

## Deploy notes

- Vercel's Node runtime imports `src/server.js` and calls its default export.
- The daily sweep is a Vercel cron hitting `/api/sync`. Sub-daily schedules need
  a paid Vercel plan; the UI's "Sync now" button runs it on demand meanwhile.
- `Dockerfile` and `render.yaml` are included for a long-running host, which you
  will need for anything that holds a connection open, such as phone calls.

## Known limitations

- **Conversation history is per-instance.** Each serverless instance keeps chat
  history in memory, so it resets on cold start. Briefs and approvals persist;
  only the chat transcript does not.
- **Gmail and social publishing are stubs.** They report mock mode until their
  OAuth flow and provider call are wired up.
- **Single owner.** One `AGENT_TOKEN` controls everything. Real multi-tenancy
  (each client logging in to see only their own business) needs Supabase Auth
  and RLS policies per user — the data model is ready for it, the login is not.

## Before selling this

- **Meta, LinkedIn, Google, and Shopify all require app review** before you can
  act on other people's accounts. Start those applications early; they gate
  launch, not the code.
- **US SMS needs 10DLC registration** and consent handling, or carriers block
  the messages.
- **Price against usage.** AI cost scales with how much people talk to it, so
  flat $30–50/month can lose money on heavy users. Cap connected accounts, AI
  calls, or both.
