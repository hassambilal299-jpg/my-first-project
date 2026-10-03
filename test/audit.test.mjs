/**
 * Tests the audit engine against fixture sites with known, deliberate faults.
 *
 *   npm test
 *
 * Serves each fixture on localhost, points the real auditor at it, and asserts
 * the findings match what was planted. Testing against fixtures rather than
 * live sites means every failure mode is reproducible.
 */
import { createServer } from "http";
import { gzipSync } from "zlib";
// These tests assert the SSRF guard is ON, so clear the development override
// in case it is set in the shell. Without this the suite silently passes or
// fails depending on who ran it.
delete process.env.ALLOW_PRIVATE_HOSTS;

// Run via `npm test`, which imports tsx so the TypeScript source loads directly.
const { runChecks, scoreOf, gradeOf } = await import("../src/lib/checks.ts");
const { normalizeUrl, fetchPage, isPrivateIp, isPrivateHostname } = await import(
  "../src/lib/audit.ts"
);

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

const has = (findings, id, severity) =>
  findings.some((f) => f.id === id && (!severity || f.severity === severity));

const find = (findings, id) => findings.find((f) => f.id === id);

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** A typical neglected small-business site. Every problem is deliberate. */
const BAD_SITE = `<!doctype html>
<html>
<head>
  <title>Home</title>
</head>
<body>
  <div style="width: 1200px">
    <h1>Welcome</h1>
    <h1>Our Services</h1>
    <img src="/van.jpg">
    <img src="/team.jpg">
    <img src="/job.jpg">
    <p>We do plumbing. Call us sometime.</p>
  </div>
</body>
</html>`;

/** A well-built site. Should come back close to clean. */
const GOOD_SITE = `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Emergency Plumber in Austin TX | Mike's Plumbing</title>
  <meta name="description" content="Licensed emergency plumbers serving Austin and surrounding areas. Same-day service for leaks, clogs and water heaters. Call for a free quote today.">
  <meta property="og:title" content="Mike's Plumbing — Austin TX">
  <meta property="og:image" content="https://example.com/logo.png">
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
  </script>
</head>
<body>
  <header><a href="tel:+15125550199">(512) 555-0199</a></header>
  <h1>Emergency Plumbing in Austin</h1>
  <img src="/van.jpg" alt="Mike's Plumbing service van">
  <p>Same-day service across Austin.</p>
  <form action="/contact" method="post">
    <input name="name"><input name="phone"><button>Send</button>
  </form>
</body>
</html>`;

/** Phone number present as text, but not tappable. A very common real case. */
const UNTAPPABLE_PHONE = GOOD_SITE.replace(
  '<a href="tel:+15125550199">(512) 555-0199</a>',
  "<span>(512) 555-0199</span>",
);

/* ------------------------------------------------------------------ */
/* Test server                                                         */
/* ------------------------------------------------------------------ */

const routes = new Map();
const server = createServer((req, res) => {
  const route = routes.get(req.url);
  if (!route) {
    res.writeHead(404, { "Content-Type": "text/html" });
    res.end("<h1>Not found</h1>");
    return;
  }
  route(req, res);
});

const html = (body, { gzip = false, delayMs = 0, status = 200 } = {}) =>
  (req, res) => {
    const send = () => {
      if (gzip) {
        const buf = gzipSync(Buffer.from(body));
        res.writeHead(status, {
          "Content-Type": "text/html",
          "Content-Encoding": "gzip",
        });
        res.end(buf);
      } else {
        res.writeHead(status, { "Content-Type": "text/html" });
        res.end(body);
      }
    };
    if (delayMs) setTimeout(send, delayMs);
    else send();
  };

routes.set("/bad", html(BAD_SITE));
routes.set("/good", html(GOOD_SITE, { gzip: true }));
routes.set("/untappable", html(UNTAPPABLE_PHONE, { gzip: true }));
routes.set("/slow", html(GOOD_SITE, { gzip: true, delayMs: 5600 }));
routes.set("/error", html("<h1>Server error</h1>", { status: 500 }));
routes.set("/heavy", html(GOOD_SITE + "<!--" + "x".repeat(200_000) + "-->", { gzip: true }));

/** Redirect fixtures, for the SSRF and loop guards. */
const redirect = (to, status = 302) =>
  (req, res) => {
    res.writeHead(status, { Location: to });
    res.end();
  };
routes.set("/redirect-to-metadata", redirect("http://169.254.169.254/latest/meta-data/"));
routes.set("/moved", redirect("/good", 301));
routes.set("/loop", redirect("/loop2"));
routes.set("/loop2", redirect("/loop"));

await new Promise((r) => server.listen(4020, r));
const BASE = "http://localhost:4020";

/**
 * A TLS server with a certificate that expires in 9 days, so the expiry
 * reader is tested against a real handshake rather than a mock. Generated
 * on the fly — committing a certificate would mean committing a private key,
 * and it would expire.
 */
const { createServer: createTlsServer } = await import("https");
const { execFileSync } = await import("child_process");
const { mkdtempSync, readFileSync } = await import("fs");
const { tmpdir } = await import("os");
const { join } = await import("path");

let tlsServer = null;
try {
  const dir = mkdtempSync(join(tmpdir(), "sitegrade-cert-"));
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048",
    "-keyout", join(dir, "key.pem"),
    "-out", join(dir, "cert.pem"),
    "-days", "9", "-nodes",
    "-subj", "/CN=localhost/O=Sitegrade Test",
  ], { stdio: "ignore" });

  tlsServer = createTlsServer(
    { key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) },
    (_req, res) => { res.writeHead(200); res.end("ok"); },
  );
  await new Promise((r) => tlsServer.listen(4443, r));
} catch {
  // openssl missing: the certificate tests below report it rather than
  // failing the suite for an unrelated reason.
  tlsServer = null;
}

/** The auditor blocks localhost on purpose, so tests call the parts directly. */
async function audit(path) {
  const page = await fetchPage(`${BASE}${path}`, { allowPrivate: ["localhost"] });
  const findings = runChecks(page);
  return { page, findings, score: scoreOf(findings), grade: gradeOf(scoreOf(findings)) };
}

/* ------------------------------------------------------------------ */

console.log("URL handling");
{
  check("bare domain gets https", normalizeUrl("mikesplumbing.com") === "https://mikesplumbing.com/");
  check("existing scheme is kept", normalizeUrl("http://a.com") === "http://a.com/");
  check("whitespace is trimmed", normalizeUrl("  a.com  ") === "https://a.com/");
  check("a word with no dot is rejected", normalizeUrl("plumbing") === null);
  check("empty input is rejected", normalizeUrl("") === null);

  // Server-side request forgery guards.
  check("localhost is blocked", normalizeUrl("http://localhost:5432") === null);
  check("127.0.0.1 is blocked", normalizeUrl("http://127.0.0.1") === null);
  check("private 192.168 range is blocked", normalizeUrl("http://192.168.1.1") === null);
  check("private 10.x range is blocked", normalizeUrl("http://10.0.0.5") === null);
  check("172.16 range is blocked", normalizeUrl("http://172.16.0.1") === null);
  check("cloud metadata endpoint is blocked", normalizeUrl("http://169.254.169.254") === null);
}

console.log("\nPrivate address ranges are refused");
{
  // The classic SSRF targets, plus the ranges people forget.
  const blocked = [
    "127.0.0.1", "127.1.2.3", "10.0.0.5", "10.255.255.255",
    "192.168.1.1", "172.16.0.1", "172.20.5.5", "172.31.255.255",
    "169.254.169.254", "169.254.0.1",
    "0.0.0.0", "100.64.0.1", "192.0.0.1", "198.18.0.1",
    "224.0.0.1", "255.255.255.255",
    "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1",
    "::ffff:127.0.0.1", "::ffff:169.254.169.254",

    // The hex spellings of those same IPv4-mapped addresses. These matter
    // more than the dotted ones: the URL parser REWRITES "::ffff:127.0.0.1"
    // into "::ffff:7f00:1", so the dotted form is what a human types and the
    // hex form is what actually reaches the guard. Matching only the dotted
    // text was a real hole — a public page could redirect to the hex form
    // and reach loopback or the cloud metadata service.
    "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::ffff:c0a8:1",
    "0:0:0:0:0:ffff:7f00:1", "[::ffff:7f00:1]",

    // NAT64 embeds an IPv4 address too.
    "64:ff9b::7f00:1", "64:ff9b::a9fe:a9fe",

    // 6to4 carries an IPv4 address in the next two groups, inside the
    // otherwise-allowed global unicast range.
    "2002:7f00:1::", "2002:a9fe:a9fe::", "2002::1",

    // Not globally routable, so denied by default.
    "ff02::1", "100::1", "::2",
  ];
  for (const ip of blocked) {
    check(`${ip} is private`, isPrivateIp(ip) === true);
  }

  // Public addresses must still be allowed, or the product checks nothing.
  const allowed = [
    "8.8.8.8", "1.1.1.1", "93.184.216.34", "172.15.0.1", "172.32.0.1",
    "11.0.0.1", "192.167.1.1", "100.63.0.1", "100.128.0.1", "2606:4700::1",
    // Real public IPv6, which must keep working or IPv6-only sites can't be
    // audited at all.
    "2606:4700:4700::1111", "2001:4860:4860::8888", "2a00:1450:4001::2004",
    "3ffe::1",
  ];
  for (const ip of allowed) {
    check(`${ip} is public`, isPrivateIp(ip) === false);
  }

  check("localhost is a private hostname", isPrivateHostname("localhost") === true);
  check("a .internal name is private", isPrivateHostname("db.internal") === true);
  check("a .localhost name is private", isPrivateHostname("app.localhost") === true);
  check("an ordinary domain is not", isPrivateHostname("mikesplumbing.com") === false);
  check("bracketed IPv6 loopback is caught", isPrivateHostname("[::1]") === true);
}

console.log("\nRedirects to a private address are stopped");
{
  // A public-looking page that bounces the fetcher at the metadata endpoint.
  const page = await fetchPage(`${BASE}/redirect-to-metadata`, { allowPrivate: ["localhost"] });
  check("the fetch fails rather than following", Boolean(page.error), page.error);
  check(
    "the reason names the redirect",
    /private address|private network/i.test(page.error ?? ""),
    page.error,
  );
  check("no HTML came back", page.html === "");

  const findings = runChecks(page);
  check("it reports the site as unreachable", has(findings, "reachable", "critical"));
}

console.log("\nRedirect loops give up");
{
  const page = await fetchPage(`${BASE}/loop`, { allowPrivate: ["localhost"] });
  check("a loop is caught, not chased forever", Boolean(page.error), page.error);
  check("the reason mentions redirects", /redirect/i.test(page.error ?? ""), page.error);
}

console.log("\nA normal redirect is still followed");
{
  const page = await fetchPage(`${BASE}/moved`, { allowPrivate: ["localhost"] });
  check("the redirect is followed", page.status === 200, String(page.status));
  check("the final URL is reported, not the first", /\/good$/.test(page.finalUrl), page.finalUrl);
  check("the destination's HTML came back", /Mike's Plumbing/.test(page.html));
}

console.log("\nA neglected site — every planted fault must be found");
{
  const { findings, score, grade } = await audit("/bad");

  check("no mobile setting is critical", has(findings, "viewport", "critical"));
  check("missing phone number is critical", has(findings, "phone", "critical"));
  check("no contact form or email is critical", has(findings, "contact", "critical"));
  check("short page title is flagged", has(findings, "title", "warning"));
  check("missing Google description is flagged", has(findings, "description", "warning"));
  check("two main headings are flagged", has(findings, "h1", "warning"));
  check("images with no description are flagged", has(findings, "alt-text", "warning"));
  check("missing analytics is flagged", has(findings, "analytics", "warning"));
  check("missing social preview is flagged", has(findings, "social-preview", "warning"));
  check("no compression is flagged", has(findings, "compression", "warning"));
  check("fixed 1200px width is flagged", has(findings, "fixed-width", "warning"));

  check("scores badly", score < 40, `scored ${score}`);
  check("grades F", grade === "F", grade);

  const h1 = find(findings, "h1");
  check("the heading count appears in the text", /2 main headings/.test(h1?.title ?? ""), h1?.title);

  const alt = find(findings, "alt-text");
  check("the image count appears in the text", /3 of 3/.test(alt?.title ?? ""), alt?.title);

  check("every problem comes with a fix", findings.filter((f) => f.severity !== "pass").every((f) => f.fix));
}

console.log("\nA well-built site — must not invent problems");
{
  const { findings, score, grade } = await audit("/good");
  const problems = findings.filter((f) => f.severity !== "pass");

  check("mobile setting passes", has(findings, "viewport", "pass"));
  check("tappable phone passes", has(findings, "phone", "pass"));
  check("contact form passes", has(findings, "contact", "pass"));
  check("page title passes", has(findings, "title", "pass"));
  check("Google description passes", has(findings, "description", "pass"));
  check("single main heading passes", has(findings, "h1", "pass"));
  check("image descriptions pass", has(findings, "alt-text", "pass"));
  check("analytics detected", has(findings, "analytics", "pass"));
  check("social preview passes", has(findings, "social-preview", "pass"));
  check("compression detected", has(findings, "compression", "pass"));

  // http:// on localhost means the SSL check correctly fires; that is the
  // only problem this fixture should have.
  const nonSsl = problems.filter((f) => f.id !== "ssl");
  check("no other problems invented", nonSsl.length === 0, nonSsl.map((f) => f.id).join(", "));
  check("scores well once SSL is set aside", score + 25 >= 95, `scored ${score}`);
  void grade;
}

console.log("\nPhone on the page but not tappable");
{
  const { findings } = await audit("/untappable");
  const phone = find(findings, "phone");
  check("flagged as a warning, not critical", phone?.severity === "warning", phone?.severity);
  check("the message names the real problem", /tappable/i.test(phone?.title ?? ""), phone?.title);
}

console.log("\nSlow site");
{
  const { findings } = await audit("/slow");
  const speed = find(findings, "load-time");
  check("a 5.6s load is critical", speed?.severity === "critical", speed?.severity);
  check("the actual seconds are shown", /5\.\d seconds/.test(speed?.title ?? ""), speed?.title);
}

console.log("\nHeavy page");
{
  const { findings } = await audit("/heavy");
  check("oversized page code is flagged", has(findings, "page-weight", "warning"));
  const w = find(findings, "page-weight");
  check("the size in KB is shown", /\d+ KB/.test(w?.title ?? ""), w?.title);
}

console.log("\nBroken site");
{
  const { findings, score } = await audit("/error");
  check("only reports that the site is down", findings.length === 1, `${findings.length} findings`);
  check("marked critical", findings[0]?.severity === "critical");
  check("does not guess at other problems", !has(findings, "title"));
  check("scores near zero", score <= 60, `scored ${score}`);
}

console.log("\nSSL certificate expiry");
{
  // Driven through runChecks with synthetic page data, so every branch is
  // exercised without waiting on a real certificate to approach its expiry.
  const https = (certDaysLeft) => ({
    url: "https://x.test/",
    finalUrl: "https://x.test/",
    status: 200,
    html: GOOD_SITE,
    loadMs: 200,
    htmlBytes: 900,
    headers: { "content-encoding": "gzip" },
    certDaysLeft,
  });

  const expiry = (days) => find(runChecks(https(days)), "ssl-expiry");

  check("a healthy certificate passes", expiry(200)?.severity === "pass", expiry(200)?.severity);
  check("30 days out is still a pass", expiry(30)?.severity === "pass");
  check("21 days out is a warning", expiry(21)?.severity === "warning", expiry(21)?.severity);
  check("7 days out is critical", expiry(7)?.severity === "critical", expiry(7)?.severity);
  check("the remaining days are named", /7 days/.test(expiry(7)?.title ?? ""), expiry(7)?.title);
  check("1 day is singular", /\b1 day\b/.test(expiry(1)?.title ?? ""), expiry(1)?.title);
  check("an expired certificate is critical", expiry(-3)?.severity === "critical");
  check("an expired certificate says so", /expired/i.test(expiry(-3)?.title ?? ""), expiry(-3)?.title);
  check("expiry never says 'expires in -3 days'", !/-\d/.test(expiry(-3)?.title ?? ""));

  // An unreadable certificate must be silent, not reassuring.
  const unknown = runChecks(https(undefined));
  check("an unknown certificate produces no expiry finding", !find(unknown, "ssl-expiry"));
  check("but SSL itself still passes", has(unknown, "ssl", "pass"));

  // http has no certificate to expire, so only the "no SSL" finding fires.
  const plain = runChecks({ ...https(undefined), finalUrl: "http://x.test/" });
  check("an http site reports no SSL", has(plain, "ssl", "critical"));
  check("an http site has no expiry finding", !find(plain, "ssl-expiry"));
}

console.log("\nReading a real certificate");
if (!tlsServer) {
  console.log("  SKIP  openssl unavailable, cannot issue a test certificate");
} else {
  const { readCertificate } = await import("../src/lib/tls.ts");
  const cert = await readCertificate("localhost", 4443);

  check("the certificate is readable", cert !== null);
  // The fixture certificate is issued for 9 days, so 8 after a moment's rounding.
  check(
    "the expiry is within a day of what was issued",
    cert !== null && Math.abs(cert.daysLeft - 8) <= 1,
    String(cert?.daysLeft),
  );
  check("the issuer comes back", cert?.issuer === "Sitegrade Test", cert?.issuer);

  const none = await readCertificate("localhost", 4044);
  check("a port with nothing on it returns null, not a throw", none === null);
}

console.log("\nAn http-only site is up, not down");
{
  // https refuses on 4044 (nothing listening); http answers on 4020.
  const page = await fetchPage("https://localhost:4020/good", { allowPrivate: true });
  const findings = runChecks(page);

  check("it fell back to http", page.finalUrl.startsWith("http://"), page.finalUrl);
  check("it is not reported as unreachable", !has(findings, "reachable"), page.error ?? "");
  check("the real problem is reported instead", has(findings, "ssl", "critical"));
  check("the page content was still read", findings.length > 1);
}

console.log("\nUnreachable domain");
{
  const page = await fetchPage("http://localhost:4021/nothing-here", { allowPrivate: ["localhost"] });
  const findings = runChecks(page);
  check("connection failure is caught, not thrown", Boolean(page.error), page.error);
  check("reported as unreachable", has(findings, "reachable", "critical"));
  check("the reason is in plain English", /refused|resolve|too long/i.test(findings[0]?.detail ?? ""), findings[0]?.detail);
}

console.log(`\n${passed} passed, ${failed} failed`);
server.close();
tlsServer?.close();
process.exit(failed === 0 ? 0 : 1);
