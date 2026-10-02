/**
 * Tests for change detection.
 *
 *   npm run test:diff
 *
 * The rules here decide what lands in someone's inbox, so the bar is: never
 * cry wolf, never stay silent about something that actually broke.
 */
const { diffSnapshots, worthEmailing, emailSubject } = await import("../src/lib/diff.ts");

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

/* -- helpers -------------------------------------------------------- */

const f = (id, severity, title = `${id} title`, extra = {}) => ({
  id,
  category: "Google",
  severity,
  title,
  detail: `${id} detail`,
  fix: severity === "pass" ? undefined : `fix ${id}`,
  weight: severity === "pass" ? 0 : severity === "critical" ? 20 : 5,
  ...extra,
});

const snap = (score, findings, down = false) => ({ score, findings, down });

const kinds = (alerts) => alerts.map((a) => a.kind).sort();
const bySubject = (alerts, subject) => alerts.find((a) => a.subject === subject);

/* ------------------------------------------------------------------ */

console.log("First ever check");
{
  const alerts = diffSnapshots(null, snap(40, [f("ssl", "critical")]));
  check("says nothing on the first check", alerts.length === 0, `${alerts.length} alerts`);
  check("so no email is sent", !worthEmailing(alerts));
}

console.log("\nNothing changed");
{
  const findings = [f("ssl", "pass"), f("title", "warning")];
  const alerts = diffSnapshots(snap(80, findings), snap(80, findings));
  check("no alerts when nothing moved", alerts.length === 0, kinds(alerts).join(","));
  check("no email for an uneventful week", !worthEmailing(alerts));
}

console.log("\nA new problem appears");
{
  const alerts = diffSnapshots(
    snap(95, [f("ssl", "pass"), f("phone", "pass")]),
    snap(70, [f("ssl", "critical", "Your site shows a “Not secure” warning"), f("phone", "pass")]),
  );

  const ssl = bySubject(alerts, "ssl");
  check("the new problem is reported", ssl?.kind === "new_problem", ssl?.kind);
  check("a critical problem is urgent", ssl?.urgency === "urgent", ssl?.urgency);
  check("it says this was working before", /working at the last check/i.test(ssl?.detail ?? ""));
  check("it carries the fix", Boolean(ssl?.fix));
  check("the healthy check stays quiet", !bySubject(alerts, "phone"));
  check("this is worth an email", worthEmailing(alerts));
  check(
    "the subject line names the problem",
    emailSubject("mikesplumbing.com", alerts).includes("Not secure"),
    emailSubject("mikesplumbing.com", alerts),
  );
}

console.log("\nA warning becomes critical");
{
  const alerts = diffSnapshots(
    snap(85, [f("load-time", "warning", "Your site takes 3.1 seconds to load")]),
    snap(65, [f("load-time", "critical", "Your site takes 7.4 seconds to load")]),
  );

  const a = bySubject(alerts, "load-time");
  check("reported as having got worse", a?.kind === "got_worse", a?.kind);
  check("treated as urgent", a?.urgency === "urgent", a?.urgency);
  check("not mislabelled as brand new", a?.kind !== "new_problem");
}

console.log("\nSame severity but the numbers moved");
{
  const alerts = diffSnapshots(
    snap(85, [f("load-time", "warning", "Your site takes 2.8 seconds to load")]),
    snap(85, [f("load-time", "warning", "Your site takes 4.1 seconds to load")]),
  );

  const a = bySubject(alerts, "load-time");
  check("the change is still reported", a?.kind === "got_worse", a?.kind);
  check("but only at normal urgency", a?.urgency === "normal", a?.urgency);
  check("the old value is shown for context", /2\.8 seconds/.test(a?.detail ?? ""), a?.detail);
}

console.log("\nSomething gets fixed");
{
  const alerts = diffSnapshots(
    snap(70, [f("ssl", "critical")]),
    snap(95, [f("ssl", "pass")]),
  );

  const a = bySubject(alerts, "ssl");
  check("the fix is recorded", a?.kind === "fixed", a?.kind);
  check("marked as good news", a?.urgency === "good_news", a?.urgency);
  check("good news alone sends no email", !worthEmailing(alerts));
}

console.log("\nThe site goes down");
{
  const alerts = diffSnapshots(
    snap(80, [f("ssl", "pass"), f("title", "warning")]),
    snap(0, [f("reachable", "critical", "Your website isn't loading", {
      detail: "We couldn't reach the site at all: the domain name doesn't resolve",
    })], true),
  );

  check("exactly one alert is raised", alerts.length === 1, `${alerts.length}`);
  check("it's the outage", alerts[0]?.kind === "site_down", alerts[0]?.kind);
  check("marked urgent", alerts[0]?.urgency === "urgent");
  check("the reason is included", /doesn't resolve/.test(alerts[0]?.detail ?? ""), alerts[0]?.detail);
  check(
    "the subject line shouts",
    emailSubject("mikesplumbing.com", alerts) === "mikesplumbing.com is DOWN",
    emailSubject("mikesplumbing.com", alerts),
  );
  check("a huge score drop is not also reported", !bySubject(alerts, "score"));
}

console.log("\nThe site comes back");
{
  const alerts = diffSnapshots(
    snap(0, [f("reachable", "critical")], true),
    snap(80, [f("ssl", "pass")], false),
  );
  const a = bySubject(alerts, "reachable");
  check("recovery is reported", a?.kind === "fixed", a?.kind);
  check("as good news", a?.urgency === "good_news");
}

console.log("\nScore drops without a single obvious cause");
{
  const alerts = diffSnapshots(
    snap(90, [f("title", "warning", "a"), f("h1", "warning", "b")]),
    snap(72, [f("title", "warning", "a"), f("h1", "warning", "b")]),
  );
  const a = bySubject(alerts, "score");
  check("the drop is reported", a?.kind === "score_drop", a?.kind);
  check("the size of the drop is stated", /18 points/.test(a?.title ?? ""), a?.title);
  check("both numbers are shown", /90.*72/.test(a?.detail ?? ""), a?.detail);
}

console.log("\nSmall score wobble is ignored");
{
  const alerts = diffSnapshots(
    snap(80, [f("title", "warning")]),
    snap(76, [f("title", "warning")]),
  );
  check("a 4-point move is not reported", !bySubject(alerts, "score"), kinds(alerts).join(","));
}

console.log("\nA check that didn't run before");
{
  // The page gained its first image, so alt-text now has something to say.
  const alerts = diffSnapshots(
    snap(90, [f("title", "pass")]),
    snap(85, [f("title", "pass"), f("alt-text", "warning")]),
  );
  check(
    "a newly-applicable check is not reported as a regression",
    !bySubject(alerts, "alt-text"),
    kinds(alerts).join(","),
  );
}

console.log("\nSeveral problems at once");
{
  const alerts = diffSnapshots(
    snap(100, [f("ssl", "pass"), f("phone", "pass"), f("title", "pass")]),
    snap(45, [f("ssl", "critical"), f("phone", "critical"), f("title", "warning")]),
  );
  check("all three are reported", alerts.filter((a) => a.kind === "new_problem").length === 3);
  check(
    "the subject line counts them",
    /2 new problems/.test(emailSubject("site.com", alerts)),
    emailSubject("site.com", alerts),
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
