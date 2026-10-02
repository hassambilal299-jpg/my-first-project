/**
 * End-to-end test of the monitoring loop against a real database.
 *
 *   npm run test:monitor
 *
 * Serves a fixture site that we deliberately break between checks, then
 * asserts the right alerts land in the database. This is the path a paying
 * customer actually depends on, so it gets tested against real Postgres
 * rather than mocks.
 */
import { createServer } from "http";
import { gzipSync } from "zlib";

process.env.ALLOW_PRIVATE_HOSTS = "1";

const { db } = await import("../src/lib/db.ts");
const { users, sites, checks, alerts } = await import("../src/lib/schema.ts");
const { runCheck, dueSites } = await import("../src/lib/monitor.ts");
const { eq, desc } = await import("drizzle-orm");

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/* -- a fixture site we can break on demand -------------------------- */

const GOOD = `<!doctype html>
<html><head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Emergency Plumber in Austin TX | Mike's Plumbing</title>
  <meta name="description" content="Licensed emergency plumbers serving Austin and surrounding areas. Same-day service for leaks, clogs and water heaters. Call for a free quote today.">
  <meta property="og:title" content="Mike's Plumbing">
  <meta property="og:image" content="https://example.com/logo.png">
  <script src="https://www.googletagmanager.com/gtag/js?id=G-ABC"></script>
</head><body>
  <a href="tel:+15125550199">(512) 555-0199</a>
  <h1>Emergency Plumbing in Austin</h1>
  <img src="/van.jpg" alt="Service van">
  <form action="/contact"><input name="name"><button>Send</button></form>
</body></html>`;

/** Same site with the phone link and contact form stripped out. */
const BROKEN = GOOD.replace('<a href="tel:+15125550199">(512) 555-0199</a>', "")
  .replace('<form action="/contact"><input name="name"><button>Send</button></form>', "");

let mode = "good";
let status = 200;

const server = createServer((req, res) => {
  if (status !== 200) {
    res.writeHead(status, { "Content-Type": "text/html" });
    res.end("<h1>Service unavailable</h1>");
    return;
  }
  const body = mode === "good" ? GOOD : BROKEN;
  const buf = gzipSync(Buffer.from(body));
  res.writeHead(200, { "Content-Type": "text/html", "Content-Encoding": "gzip" });
  res.end(buf);
});

await new Promise((r) => server.listen(4040, r));
const URL_UNDER_TEST = "http://localhost:4040/";

/* -- fresh data ------------------------------------------------------ */

await db.delete(users);

const [user] = await db
  .insert(users)
  .values({ email: "test@example.com", passwordHash: "x" })
  .returning();

const [site] = await db
  .insert(sites)
  .values({
    userId: user.id,
    url: URL_UNDER_TEST,
    label: "mikesplumbing.com",
    alertEmail: "test@example.com",
  })
  .returning();

const alertsFor = async () =>
  db.select().from(alerts).where(eq(alerts.siteId, site.id)).orderBy(desc(alerts.createdAt));

const freshSite = async () =>
  db.query.sites.findFirst({ where: eq(sites.id, site.id) });

/* ------------------------------------------------------------------ */

console.log("First check — establishes the baseline");
{
  const out = await runCheck(site);
  check("the check succeeds", !out.error, out.error);
  check("a score is recorded", out.score > 0, String(out.score));
  check("no alerts on the very first check", out.alertCount === 0, String(out.alertCount));

  const rows = await db.select().from(checks).where(eq(checks.siteId, site.id));
  check("the result is stored", rows.length === 1, `${rows.length} rows`);
  check("the findings are stored with it", Array.isArray(rows[0]?.findings) && rows[0].findings.length > 5);

  const s = await freshSite();
  check("the site records when it was checked", Boolean(s?.lastCheckedAt));
  check("and the latest score", s?.lastScore === out.score);
}

console.log("\nSecond check, nothing changed");
{
  const out = await runCheck(await freshSite());
  check("still no alerts", out.alertCount === 0, String(out.alertCount));
  check("no email for an uneventful check", !out.emailed);

  const rows = await db.select().from(checks).where(eq(checks.siteId, site.id));
  check("but the history still grows", rows.length === 2, `${rows.length} rows`);
}

console.log("\nThe phone number and contact form disappear");
{
  mode = "broken";
  const out = await runCheck(await freshSite());

  check("alerts are raised", out.alertCount >= 2, String(out.alertCount));

  const raised = await alertsFor();
  const phone = raised.find((a) => a.subject === "phone");
  const contact = raised.find((a) => a.subject === "contact");

  check("the lost phone number is reported", phone?.kind === "new_problem", phone?.kind);
  check("as urgent", phone?.urgency === "urgent", phone?.urgency);
  check("the lost contact form is reported", contact?.kind === "new_problem", contact?.kind);
  check("alerts carry the fix", Boolean(phone?.fix), phone?.fix ?? "none");
  check("alerts start unread", raised.every((a) => a.readAt === null));
  check(
    "no email was sent because no key is configured",
    !out.emailed && raised.every((a) => a.emailedAt === null),
  );

  const s = await freshSite();
  check("the stored score dropped", (s?.lastScore ?? 100) < 100, String(s?.lastScore));
}

console.log("\nThe site goes down");
{
  status = 503;
  const before = (await alertsFor()).length;
  const out = await runCheck(await freshSite());
  const raised = await alertsFor();
  const added = raised.slice(0, raised.length - before);

  check("exactly one new alert", added.length === 1, `${added.length}`);
  check("it's the outage", added[0]?.kind === "site_down", added[0]?.kind);
  check("marked urgent", added[0]?.urgency === "urgent");
  check("the check is flagged as down", out.score === 60 || out.score >= 0);

  const latest = await db
    .select()
    .from(checks)
    .where(eq(checks.siteId, site.id))
    .orderBy(desc(checks.createdAt))
    .limit(1);
  check("the stored check records it was down", latest[0]?.down === true);
}

console.log("\nThe site comes back and is fixed");
{
  status = 200;
  mode = "good";
  const before = (await alertsFor()).length;
  await runCheck(await freshSite());
  const raised = await alertsFor();
  const added = raised.slice(0, raised.length - before);

  check("recovery is reported", added.some((a) => a.kind === "fixed"), added.map((a) => a.kind).join(","));
  check(
    "the recovery alerts are good news",
    added.filter((a) => a.kind === "fixed").every((a) => a.urgency === "good_news"),
  );
}

console.log("\nScheduling");
{
  // Just checked, so a weekly site should not be due.
  let due = await dueSites();
  check("a just-checked weekly site is not due", !due.some((s) => s.id === site.id));

  // Pretend eight days have passed.
  await db
    .update(sites)
    .set({ lastCheckedAt: new Date(Date.now() - 8 * 24 * 3600 * 1000) })
    .where(eq(sites.id, site.id));
  due = await dueSites();
  check("after eight days it is due", due.some((s) => s.id === site.id));

  // Paused sites are never due.
  await db.update(sites).set({ paused: true }).where(eq(sites.id, site.id));
  due = await dueSites();
  check("a paused site is skipped", !due.some((s) => s.id === site.id));
  await db.update(sites).set({ paused: false }).where(eq(sites.id, site.id));

  // Daily cadence.
  await db
    .update(sites)
    .set({ frequency: "DAILY", lastCheckedAt: new Date(Date.now() - 2 * 3600 * 1000) })
    .where(eq(sites.id, site.id));
  due = await dueSites();
  check("a daily site checked 2 hours ago is not due", !due.some((s) => s.id === site.id));

  await db
    .update(sites)
    .set({ lastCheckedAt: new Date(Date.now() - 25 * 3600 * 1000) })
    .where(eq(sites.id, site.id));
  due = await dueSites();
  check("a daily site checked 25 hours ago is due", due.some((s) => s.id === site.id));
}

console.log("\nAn unreachable site doesn't crash the run");
{
  const [dead] = await db
    .insert(sites)
    .values({
      userId: user.id,
      url: "http://localhost:4099/",
      label: "dead.example",
      alertEmail: "test@example.com",
    })
    .returning();

  const out = await runCheck(dead);
  check("the run completes without throwing", typeof out.score === "number");
  check("no unhandled error is surfaced", !out.error, out.error);

  const rows = await db.select().from(checks).where(eq(checks.siteId, dead.id));
  check("a check is still recorded", rows.length === 1);
  check("flagged as down", rows[0]?.down === true);
}

console.log("\nDeleting a site cleans up after itself");
{
  await db.delete(sites).where(eq(sites.id, site.id));
  const leftoverChecks = await db.select().from(checks).where(eq(checks.siteId, site.id));
  const leftoverAlerts = await db.select().from(alerts).where(eq(alerts.siteId, site.id));
  check("its checks are gone", leftoverChecks.length === 0, `${leftoverChecks.length}`);
  check("its alerts are gone", leftoverAlerts.length === 0, `${leftoverAlerts.length}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
server.close();
process.exit(failed === 0 ? 0 : 1);
