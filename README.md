# Jarvis — AI operations assistant

A voice-first assistant that helps you and your B2B clients run day-to-day
operations: email, SMS (GoHighLevel), social posting, and Shopify orders.

**Live:** https://jarvis-hb-designers.vercel.app

## How it works

```
Browser (voice in/out)  →  /api/chat  →  Claude (tool use)  →  connectors
                                              ↓
                                     approval queue (Supabase)
                                              ↓
                                   you approve  →  action actually runs
```

The agent reads freely but **never sends anything on its own**. Drafting an SMS
or a social post creates a pending item; the action runs only after you press
Approve. This is the core safety property and it is covered by tests.

## Environment variables

| Variable | Required | What it does |
|---|---|---|
| `AGENT_TOKEN` | yes | Access token for the app. Must be 16+ chars. Anyone with it can use your assistant. |
| `ANTHROPIC_API_KEY` | yes | Claude API key. Without it the app loads but chat replies that the key is missing. |
| `ANTHROPIC_MODEL` | no | Defaults to `claude-sonnet-5-5`. |
| `SUPABASE_URL` | no | Supabase project URL. Set with the secret key to persist approvals. |
| `SUPABASE_SECRET_KEY` | no | Supabase **secret** (service role) key. Required for persistence — the publishable key cannot write, because the table has RLS on with no policies. |
| `GHL_API_KEY` | no | GoHighLevel. Blank = SMS runs in mock mode. |
| `GMAIL_REFRESH_TOKEN` | no | Gmail. Blank = mock mode. |
| `SHOPIFY_ACCESS_TOKEN`, `SHOPIFY_STORE_DOMAIN` | no | Shopify orders. Blank = mock mode. |
| `SOCIAL_API_KEY` | no | Social publishing provider. Blank = mock mode. |

Every connector runs in **mock mode** until its credentials are set, so the app
works end to end before any real account is connected. Mock mode never makes a
network call and says so in its response.

## Run locally

```bash
cp .env.example .env     # fill in AGENT_TOKEN and ANTHROPIC_API_KEY
npm start                # http://localhost:3000
npm test                 # 16 tests, no network required
```

## Deploy

- **Vercel** (current): the Node runtime imports `src/server.js` and calls its
  default export. Note that `readFileSync` paths are not traced into the
  function bundle, which is why the UI lives in `src/ui.js` as a string.
- **Docker / Render**: `Dockerfile` and `render.yaml` are included for a
  long-running host, which you will need for phone calls or anything that must
  hold a connection open.

## Known limitations

- **Conversation history is per-instance.** Each serverless instance keeps its
  own history in memory, so it resets on cold start. Moving it to Supabase is
  the next step.
- **Gmail and social are read-stubbed.** `listUnreadEmails` and `publishPost`
  need their OAuth flow and provider call wired up once credentials exist.
- **SSO protection is on.** The `*.vercel.app` URL requires a Vercel login as a
  second layer in front of `AGENT_TOKEN`. A custom domain bypasses it, which is
  what you will want for clients.

## Before selling this

- **Meta, LinkedIn, Google, Shopify all require app review** before you can act
  on other people's accounts. Start those applications early; they gate launch,
  not the code.
- **US SMS needs 10DLC registration** and consent handling, or carriers block
  the messages.
- **Multi-tenancy is not built yet.** Today this is single-tenant: one set of
  credentials. Per-client OAuth token storage and isolation is the largest
  remaining piece of work before a subscription product.
