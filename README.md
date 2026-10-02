# Sitegrade

Enter any website address. Get a plain-English report of everything broken on
it — speed, mobile, SSL, Google tags, and whether a customer can actually
contact the business.

Built with Next.js 16, TypeScript, Tailwind and Cheerio. No database needed to
run it.

---

## Why this exists

It's a sales tool before it's a product. Run a prospect's site, and instead of
"do you need a website?" the call opens with:

> *"I ran your site — it takes 8 seconds to load on a phone, there's no SSL so
> Chrome shows a 'Not secure' warning, and your phone number isn't tappable.
> Want me to fix those?"*

That works whether or not anyone ever subscribes. If people do subscribe, the
buyer is other web design agencies and freelancers who need the same opener.

---

## Running it

```bash
npm install
npm run dev
```

Open http://localhost:3000 and paste in a website address. That's it — no
database, no API keys, no accounts.

### Testing against a site on your own machine

The auditor refuses to fetch `localhost` and private IP addresses on purpose.
That guard is what stops a visitor typing `http://169.254.169.254` and using
your server to read your own cloud credentials. To test local sites in
development:

```bash
ALLOW_PRIVATE_HOSTS=1 npm run dev
```

**Never set that in production.**

There's a deliberately terrible fixture site to try it against:

```bash
node fixture-server.mjs     # serves a broken site on :4030
```

---

## Tests

```bash
npm test
```

52 assertions. It serves fixture sites with deliberately planted faults and
checks the auditor finds exactly those and invents nothing extra:

- A neglected site — every one of 11 planted problems must be found
- A well-built site — must come back clean, no false alarms
- Edge cases: phone number present but not tappable, slow site, oversized
  page, HTTP 500, unreachable domain
- URL handling, including the SSRF guards (localhost, 127.x, 10.x, 192.168.x,
  172.16–31.x, and the cloud metadata endpoint)

---

## What it checks

**Getting customers** — the ones that actually sell the work

| Check | Why it matters |
|---|---|
| Phone number present | Someone ready to hire has no way to call |
| Phone number tappable | On a phone, an untappable number is barely a number |
| Contact form or email | People who won't call a stranger are a big share of the market |
| Analytics installed | If they can't measure it, they can't know it's broken |
| Social preview tags | A shared link with no picture looks like spam |

**Speed** — load time, page weight, compression

**Mobile** — viewport setting, zoom blocking, fixed widths wider than a phone

**Trust** — SSL certificate

**Google** — title length, meta description, single main heading, image alt text

Every finding carries a plain-English explanation and the fix. Thresholds all
live at the top of `src/lib/checks.ts` if you want to tune how harsh it is.

---

## How it's put together

```
src/
  lib/
    checks.ts     all the rules + scoring. Pure functions, no network.
    audit.ts      fetching, URL normalising, SSRF guards.
  app/
    page.tsx      landing page
    actions.ts    server action that runs an audit
  components/
    audit-form.tsx
    report.tsx    the scored report
test/audit.test.mjs
fixture-server.mjs
```

`checks.ts` has no network calls at all — that's what makes the whole rule set
testable against fixture HTML.

Scoring starts at 100 and subtracts a weight per problem. It's deliberately
harsh: a report saying "78/100, looking good" doesn't start a sales
conversation, and an average neglected small-business site genuinely does have
this many problems.

---

## What's not built yet

Listed so you find out here and not from a customer:

- **Accounts and billing.** No login, no Stripe. Add it once people ask to pay.
- **Saved reports and shareable links.** Right now a report lives only in the
  browser until you reload. The obvious next step is saving audits to a
  database and giving each one a public URL you can send a prospect.
- **PDF export.** Currently you'd screenshot it or print to PDF.
- **Your logo on the report.** The white-label version is what agencies pay for.
- **Rate limiting.** Anyone can hammer the audit endpoint. Needed before this
  is public.
- **Deeper checks.** Broken links, real Lighthouse scores, mobile screenshots.

---

## Deploying

Push to GitHub, import on Vercel, deploy. No environment variables required.
Do **not** set `ALLOW_PRIVATE_HOSTS` there.
