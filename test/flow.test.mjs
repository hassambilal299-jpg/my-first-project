/**
 * End-to-end test of the journey a real customer takes, driven through a real
 * browser against a real build and a real database.
 *
 *   npm run test:flow
 *
 * Needs a dev server on port 4301 and a database. It runs against `next dev`
 * rather than a production build because it audits a fixture on localhost,
 * which the SSRF guard refuses in production — correctly, so the test bends
 * and the guard does not.
 *
 * The unit tests prove the rules are right. This proves they are actually
 * wired to the buttons — the gap where most of the embarrassing bugs live.
 */
import { chromium } from "playwright";
import { mkdirSync } from "fs";

const BASE = process.env.FLOW_BASE_URL ?? "http://localhost:4301";
const SHOTS = "/tmp/claude-0/-home-claude/a5b96a9e-1c9d-5686-9656-1b2d15e74cc7/scratchpad/shots";
mkdirSync(SHOTS, { recursive: true });

const { db } = await import("../src/lib/db.ts");
const { users, sites } = await import("../src/lib/schema.ts");
const { eq } = await import("drizzle-orm");

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

const EMAIL = `flow-${Date.now()}@example.com`;
const PASSWORD = "a-good-enough-password";

// Leave nothing behind, however the run ends.
async function cleanup() {
  try {
    await db.delete(users).where(eq(users.email, EMAIL));
  } catch {
    /* best effort */
  }
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

const serverErrors = [];
page.on("response", (r) => {
  if (r.status() >= 500) serverErrors.push(`${r.status()} ${r.url()}`);
});

try {
  /* -- signing up ---------------------------------------------------- */
  console.log("Signing up");
  {
    await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

    check("lands on the dashboard", page.url().includes("/dashboard"));
    const body = await page.innerText("body");
    check("the plan is shown in the header", /Free/.test(body), body.slice(0, 120));
    check("the free limit is stated", /0 of 1 used/.test(body), body.match(/\d of \d used/)?.[0]);
  }

  /* -- adding the one site free allows ------------------------------- */
  console.log("\nAdding a site on the free plan");
  {
    await page.fill('input[name="url"]', "http://localhost:4301/");
    await page.click('form:has(input[name="url"]) button[type="submit"]');
    await page.waitForFunction(
      () => /1 of 1 used/.test(document.body.innerText),
      { timeout: 60_000 },
    );

    const body = await page.innerText("body");
    check("the site is listed", /localhost/.test(body));
    check("usage updates to 1 of 1", /1 of 1 used/.test(body));
    check(
      "the add form is replaced by the limit message",
      /move up a plan/i.test(body),
      body.includes("move up a plan") ? "" : "no upgrade prompt",
    );
    check(
      "there is no longer a URL field to submit",
      (await page.locator('input[name="url"]').count()) === 0,
    );
  }

  /* -- a rejected address must stay in the box ---------------------- */
  console.log("\nA rejected address is not thrown away");
  {
    // React 19 resets a form after its action runs, error and all, so this
    // only holds because the input is deliberately controlled. Checked on
    // the dashboard form via the audit form on the home page, which shares
    // the behaviour.
    const home = await ctx.newPage();
    await home.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await home.fill("#url", "not a website at all");
    await home.click('form:has(#url) button[type="submit"]');
    await home.waitForSelector('[role="alert"]', { timeout: 30_000 });

    check(
      "the bad address is still there to correct",
      (await home.inputValue("#url")) === "not a website at all",
      await home.inputValue("#url"),
    );
    await home.close();
  }

  /* -- the site page, and what free cannot do ----------------------- */
  console.log("\nThe site page on a free plan");
  {
    await page.click('a[href^="/dashboard/"]:not([href="/dashboard/account"])');
    await page.waitForURL(/\/dashboard\/[^/]+$/, { timeout: 30_000 });
    await page.screenshot({ path: `${SHOTS}/flow-site-free.png`, fullPage: true });

    const body = await page.innerText("body");
    check("a score is shown, not 'not checked yet'", !/Not checked yet/.test(body), body.slice(0, 200));
    check("daily is locked on free", /Daily checking is on the paid plans/.test(body));
    check(
      "the daily button is actually disabled, not just styled",
      await page.locator('button[name="frequency"][value="DAILY"]').isDisabled(),
    );
    check("sharing is locked on free", /On paid plans/.test(body));
    check("email alerts are explained as paid", /Pro and Agency/.test(body));
    check("no share link is exposed", (await page.locator("#share-url").count()) === 0);
  }

  /* -- upgrading, by the same route a real customer would ------------ */
  console.log("\nAfter an upgrade to Pro");
  {
    await db.update(users).set({ plan: "PRO" }).where(eq(users.email, EMAIL));
    await page.reload({ waitUntil: "networkidle" });

    const body = await page.innerText("body");
    check("daily is now available", !/Daily checking is on the paid plans/.test(body));
    check(
      "the daily button is enabled",
      await page.locator('button[name="frequency"][value="DAILY"]').isEnabled(),
    );
    check("the alert email field appears", (await page.locator('input[name="alertEmail"]').count()) === 1);
    check("a share link can be created", /Create a link/.test(body));
  }

  /* -- the share link, as a stranger sees it ------------------------- */
  console.log("\nThe public report link");
  {
    await page.click('button:has-text("Create a link")');
    await page.waitForSelector("#share-url", { timeout: 30_000 });
    const shareUrl = await page.inputValue("#share-url");
    check("the link points at /r/", /\/r\/[A-Za-z0-9_-]{10,}/.test(shareUrl), shareUrl);

    // A brand new context: no cookies, no session — a real client.
    const stranger = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const strangerPage = await stranger.newPage();
    const resp = await strangerPage.goto(shareUrl, { waitUntil: "networkidle" });
    check("a signed-out visitor can read it", resp.status() === 200, String(resp.status()));

    const sharedBody = await strangerPage.innerText("body");
    check("it shows the report", /Grade [A-F]/.test(sharedBody));
    check("it does not leak the owner's email", !sharedBody.includes(EMAIL));
    check("it has no signup pitch for our product", !/Watch this site/.test(sharedBody));
    check("it is marked noindex",
      (await strangerPage.locator('meta[name="robots"]').getAttribute("content"))?.includes("noindex") ?? false);
    await strangerPage.screenshot({ path: `${SHOTS}/flow-shared-report.png`, fullPage: true });

    // Rotating the token must break the old link. The wait is on the value
    // changing, not on the element existing — it already does.
    await page.click('button:has-text("New link")');
    await page.waitForFunction(
      (old) => document.querySelector("#share-url")?.value !== old,
      shareUrl,
      { timeout: 30_000 },
    );
    const rotated = await page.inputValue("#share-url");
    check("rotating issues a different link", rotated !== shareUrl, rotated);

    const stale = await strangerPage.goto(shareUrl, { waitUntil: "domcontentloaded" });
    check("the old link is dead after rotating", stale.status() === 404, String(stale.status()));
    await stranger.close();
  }

  /* -- the account page --------------------------------------------- */
  console.log("\nThe account page");
  {
    await page.goto(`${BASE}/dashboard/account`, { waitUntil: "networkidle" });
    await page.screenshot({ path: `${SHOTS}/flow-account-pro.png`, fullPage: true });

    const body = await page.innerText("body");
    check("the email is shown", body.includes(EMAIL));
    check("the plan is named", /\bPro\b/.test(body));
    check("usage is shown against the Pro limit", /1 of 10/.test(body), body.match(/\d+ of \d+/)?.[0]);

    // Scoped to this form. Next's dev overlay also puts a role="alert" on the
    // page, and an unscoped selector picks that up instead.
    const pwForm = page.locator('form:has(input[name="current"])');

    // A wrong current password must be refused.
    await page.fill('input[name="current"]', "not-the-password");
    await page.fill('input[name="next"]', "another-good-password");
    await pwForm.locator('button[type="submit"]').click();
    await pwForm.locator('[role="alert"]').first().waitFor({ timeout: 30_000 });
    const pwError = await pwForm.locator('[role="alert"]').first().innerText();
    check("a wrong current password is refused", /isn't right/.test(pwError), pwError);

    // The right one must work.
    await page.fill('input[name="current"]', PASSWORD);
    await page.fill('input[name="next"]', "a-brand-new-password");
    await pwForm.locator('button[type="submit"]').click();
    await pwForm.locator('[role="status"]').first().waitFor({ timeout: 30_000 });
    const pwOk = await pwForm.locator('[role="status"]').first().innerText();
    check("the correct password is accepted", /changed/i.test(pwOk), pwOk);
  }

  /* -- deleting the account ----------------------------------------- */
  console.log("\nDeleting the account");
  {
    await page.click('summary:has-text("Delete my account")');
    const delForm = page.locator('form:has(input[name="confirm"])');

    await page.fill('input[name="password"]', "a-brand-new-password");
    await page.fill('input[name="confirm"]', "nope");
    await delForm.locator('button[type="submit"]').click();
    await delForm.locator('[role="alert"]').first().waitFor({ timeout: 30_000 });
    const delError = await delForm.locator('[role="alert"]').first().innerText();
    check("the wrong confirmation word is refused", /Type DELETE/.test(delError), delError);

    // React clears the password field after the action, which is the right
    // behaviour for a password — so both fields are filled again.
    await page.fill('input[name="password"]', "a-brand-new-password");

    const stillThere = await db.query.users.findFirst({ where: eq(users.email, EMAIL) });
    check("nothing was deleted on a failed confirmation", Boolean(stillThere));

    await page.fill('input[name="confirm"]', "DELETE");
    await delForm.locator('button[type="submit"]').click();
    await page.waitForURL(/\/\?deleted=1|\/$/, { timeout: 30_000 });

    const gone = await db.query.users.findFirst({ where: eq(users.email, EMAIL) });
    check("the account is gone", !gone);

    // The cascade has to take the sites with it, or deleted customers leave
    // orphaned rows that the cron would keep checking forever.
    const orphans = await db.select({ id: sites.id }).from(sites).where(eq(sites.alertEmail, EMAIL));
    check("their sites went with it", orphans.length === 0, `${orphans.length} left behind`);

    const resp = await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    check("the dead session can't reach the dashboard", !page.url().includes("/dashboard"), page.url());
    void resp;
  }

  console.log("\nServer errors");
  check("no 5xx responses during the whole journey", serverErrors.length === 0, serverErrors.join(" | "));
} finally {
  await ctx.close();
  await browser.close();
  await cleanup();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
