import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
p.on("pageerror", e => errs.push(String(e)));

// Free audit -> signup CTA
await p.goto("http://localhost:3100/", { waitUntil: "networkidle" });
await p.fill("#url", "http://localhost:4040");
await p.click('button[type="submit"]');
await p.waitForSelector("article", { timeout: 30000 });
await p.waitForTimeout(400);
await p.screenshot({ path: "shots/01-audit.png", fullPage: true });

// Sign up carrying the watched URL
await p.click('a:has-text("Watch this site")');
await p.waitForURL("**/signup**");
await p.waitForLoadState("networkidle");
await p.screenshot({ path: "shots/02-signup.png", fullPage: true });
const email = `demo${Date.now()}@example.com`;
await p.fill('input[name="email"]', email);
await p.fill('input[name="password"]', "supersecret123");
await p.click('button[type="submit"]');
await p.waitForURL("**/dashboard", { timeout: 40000 });
await p.waitForLoadState("networkidle");
await p.screenshot({ path: "shots/03-dashboard.png", fullPage: true });

// Site detail
await p.click("ul li a");
await p.waitForURL("**/dashboard/**", { timeout: 40000 });
await p.waitForSelector("h1", { timeout: 40000 });
await p.waitForLoadState("networkidle");
await p.waitForTimeout(1500);
await p.screenshot({ path: "shots/04-site.png", fullPage: true });

const m = await b.newPage({ viewport: { width: 375, height: 812 }, storageState: await p.context().storageState() });
await m.goto("http://localhost:3100/dashboard", { waitUntil: "networkidle" });
const sw = await m.evaluate(() => document.documentElement.scrollWidth);
await m.screenshot({ path: "shots/05-mobile.png", fullPage: true });
console.log("signup email:", email);
console.log("mobile scrollWidth:", sw, sw > 375 ? "HORIZONTAL SCROLL BUG" : "ok");
console.log("page errors:", errs.length ? errs : "none");
await b.close();
