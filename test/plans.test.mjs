/**
 * Tests for plans and limits.
 *
 *   npm test
 *
 * These are the rules that decide what a paying customer gets, so they are
 * tested the way the money cares about: a bad value must fall back to the
 * LEAST generous plan, never the most.
 */
const {
  PLANS,
  PLAN_ORDER,
  RECOMMENDED,
  annualTotal,
  annualSavingPct,
  bestAnnualSavingPct,
  asPlan,
  limitsFor,
  canAddSite,
  sitesRemaining,
  addSiteError,
  allowedFrequency,
  canEmailAlerts,
  canShareReports,
} = await import("../src/lib/plans.ts");

const { CHECK_COUNT, CHECK_REGISTRY } = await import("../src/lib/checks.ts");
const { rateLimitMessage, AUDITS_PER_HOUR } = await import("../src/lib/rate-limit.ts");

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

/* ------------------------------------------------------------------ */

console.log("Plan definitions");
{
  check("three plans, in order", PLAN_ORDER.join(",") === "FREE,PRO,AGENCY", PLAN_ORDER.join(","));
  check("the recommended plan exists", Boolean(PLANS[RECOMMENDED]));
  check("every plan has an id matching its key", PLAN_ORDER.every((id) => PLANS[id].id === id));
  check("every plan has at least four features", PLAN_ORDER.every((id) => PLANS[id].features.length >= 4));

  // A higher tier that didn't actually give you more would be a bug the
  // pricing page would happily render.
  check(
    "site limits increase with price",
    PLANS.FREE.sites < PLANS.PRO.sites && PLANS.PRO.sites < PLANS.AGENCY.sites,
  );
  check(
    "prices increase with the tier",
    PLANS.FREE.monthly < PLANS.PRO.monthly && PLANS.PRO.monthly < PLANS.AGENCY.monthly,
  );
  check("the free plan is actually free", PLANS.FREE.monthly === 0 && PLANS.FREE.annualMonthly === 0);
  check("the free plan has no email alerts", PLANS.FREE.emailAlerts === false);
  check("the free plan cannot check daily", PLANS.FREE.daily === false);
  check("both paid plans can check daily", PLANS.PRO.daily && PLANS.AGENCY.daily);
  check("both paid plans email alerts", PLANS.PRO.emailAlerts && PLANS.AGENCY.emailAlerts);
  check("both paid plans share reports", PLANS.PRO.shareReports && PLANS.AGENCY.shareReports);
}

console.log("\nAnnual pricing");
{
  check("yearly is cheaper per month than monthly", PLANS.PRO.annualMonthly < PLANS.PRO.monthly);
  check("Pro yearly total is twelve months of the yearly rate", annualTotal("PRO") === PLANS.PRO.annualMonthly * 12);
  check("the free plan's yearly total is zero", annualTotal("FREE") === 0);

  const pro = annualSavingPct("PRO");
  check("Pro shows a real saving", pro > 0 && pro < 100, `${pro}%`);
  check("the free plan shows no saving", annualSavingPct("FREE") === 0);
  check(
    "the headline saving is the largest on offer",
    bestAnnualSavingPct() === Math.max(annualSavingPct("PRO"), annualSavingPct("AGENCY")),
  );

  // Paying yearly must never cost more than twelve monthly payments.
  check(
    "yearly never costs more than monthly",
    PLAN_ORDER.every((id) => annualTotal(id) <= PLANS[id].monthly * 12),
  );
}

console.log("\nUnrecognised plan values fall back safely");
{
  for (const bad of [null, undefined, "", "pro", "ENTERPRISE", 0, 1, 42, {}, [], true, NaN]) {
    check(`${JSON.stringify(bad) ?? "undefined"} becomes FREE`, asPlan(bad) === "FREE", asPlan(bad));
  }

  check("a valid value is kept", asPlan("AGENCY") === "AGENCY");
  check("limitsFor falls back to the free plan", limitsFor("nonsense").id === "FREE");

  // This is the bug that bit the cron route: Array.map passes an index as the
  // second argument, so a plan of 1 or 2 must not unlock paid features.
  check("a numeric plan does not unlock email", canEmailAlerts(1) === false);
  check("a numeric plan does not unlock sharing", canShareReports(2) === false);
  check("a numeric plan does not unlock daily", allowedFrequency(3, "DAILY") === "WEEKLY");
}

console.log("\nSite limits");
{
  check("free allows the first site", canAddSite("FREE", 0) === true);
  check("free refuses the second", canAddSite("FREE", 1) === false);
  check("pro allows up to its limit", canAddSite("PRO", PLANS.PRO.sites - 1) === true);
  check("pro refuses at its limit", canAddSite("PRO", PLANS.PRO.sites) === false);
  check("already over the limit still refuses", canAddSite("PRO", PLANS.PRO.sites + 5) === false);

  check("remaining counts down", sitesRemaining("PRO", 3) === PLANS.PRO.sites - 3);
  check("remaining is zero at the limit", sitesRemaining("FREE", 1) === 0);
  check("remaining never goes negative", sitesRemaining("FREE", 9) === 0, String(sitesRemaining("FREE", 9)));
}

console.log("\nThe message shown at the limit");
{
  check("no message when there's room", addSiteError("FREE", 0) === null);

  const free = addSiteError("FREE", 1);
  check("free is told the limit is one site", /1 site\b/.test(free ?? ""), free);
  check("free is pointed at Pro", /Pro/.test(free ?? ""), free);
  check("free message is singular, not '1 sites'", !/1 sites/.test(free ?? ""), free);

  const pro = addSiteError("PRO", PLANS.PRO.sites);
  check("pro is pointed at Agency", /Agency/.test(pro ?? ""), pro);

  const agency = addSiteError("AGENCY", PLANS.AGENCY.sites);
  check("agency is told to get in touch, not upsold", /email us/i.test(agency ?? ""), agency);
  check("agency is not pointed at a higher plan", !/\bPro\b/.test(agency ?? ""), agency);

  // An unknown plan must produce the free-plan message, not a crash.
  check("an unknown plan still produces a message", typeof addSiteError("???", 5) === "string");
}

console.log("\nCheck frequency");
{
  check("free weekly stays weekly", allowedFrequency("FREE", "WEEKLY") === "WEEKLY");
  check("free daily is clamped to weekly", allowedFrequency("FREE", "DAILY") === "WEEKLY");
  check("pro daily is allowed", allowedFrequency("PRO", "DAILY") === "DAILY");
  check("agency daily is allowed", allowedFrequency("AGENCY", "DAILY") === "DAILY");
  // Downgrading must not force a paid customer's weekly site to daily.
  check("pro weekly stays weekly", allowedFrequency("PRO", "WEEKLY") === "WEEKLY");
}

console.log("\nThe advertised check count is the real one");
{
  const counted = Object.values(CHECK_REGISTRY).reduce((n, g) => n + g.length, 0);
  check("CHECK_COUNT matches the registry", CHECK_COUNT === counted, `${CHECK_COUNT} vs ${counted}`);
  check("the count is plausible", CHECK_COUNT > 5 && CHECK_COUNT < 100, String(CHECK_COUNT));
  check("every category has at least one check", Object.values(CHECK_REGISTRY).every((g) => g.length > 0));
  check(
    "no duplicate check descriptions",
    new Set(Object.values(CHECK_REGISTRY).flat()).size === counted,
  );
}

console.log("\nRate limit wording");
{
  const one = rateLimitMessage({ ok: false, remaining: 0, retryAfterMins: 1 });
  check("one minute reads naturally", /in a minute/.test(one), one);
  check("does not say '1 minutes'", !/1 minutes/.test(one), one);

  const many = rateLimitMessage({ ok: false, remaining: 0, retryAfterMins: 24 });
  check("many minutes are pluralised", /24 minutes/.test(many), many);
  check("the cap is named", many.includes(String(AUDITS_PER_HOUR)), many);
  check("it offers a way forward", /account/i.test(many), many);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
