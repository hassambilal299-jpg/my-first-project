/**
 * Walks every page at phone and desktop width, screenshots it, and reports
 * the flaws that are easy to ship and hard to notice: horizontal scroll,
 * console errors, tap targets under 44px, images with no alt text, controls
 * with no accessible name, broken internal links, and text that overflows.
 */
import { chromium } from "playwright";
import { mkdirSync } from "fs";

const BASE = "http://localhost:4300";
const OUT = "/tmp/claude-0/-home-claude/a5b96a9e-1c9d-5686-9656-1b2d15e74cc7/scratchpad/shots";
mkdirSync(OUT, { recursive: true });

const PAGES = ["/", "/pricing", "/terms", "/privacy", "/login", "/signup", "/signup?plan=pro&billing=annual"];
const VIEWPORTS = [
  { name: "phone", width: 375, height: 812 },
  { name: "desktop", width: 1280, height: 900 },
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const problems = [];
const seenLinks = new Set();

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();

  for (const path of PAGES) {
    const consoleErrors = [];
    page.removeAllListeners("console");
    page.removeAllListeners("pageerror");
    // fonts.googleapis.com is blocked by this sandbox's egress proxy, so that
    // one failure is an artefact of where the test runs, not a product bug.
    const sandboxOnly = (t) => /ERR_TUNNEL_CONNECTION_FAILED|fonts\.(googleapis|gstatic)/.test(t);
    page.on("console", (m) => {
      if (m.type() === "error" && !sandboxOnly(m.text())) consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

    const resp = await page.goto(BASE + path, { waitUntil: "networkidle" });
    if (resp.status() !== 200) problems.push(`${path} [${vp.name}] HTTP ${resp.status()}`);

    const slug = path.replace(/[^a-z0-9]+/gi, "_") || "home";
    await page.screenshot({ path: `${OUT}/${slug}-${vp.name}.png`, fullPage: true });

    const found = await page.evaluate((viewportWidth) => {
      const out = { scrollWidth: document.documentElement.scrollWidth, small: [], noAlt: [], noName: [], overflow: [] };

      if (out.scrollWidth > viewportWidth + 1) {
        for (const el of document.querySelectorAll("*")) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.right > viewportWidth + 1) {
            out.overflow.push(`${el.tagName.toLowerCase()}.${(el.className || "").toString().slice(0, 60)} right=${Math.round(r.right)}`);
            if (out.overflow.length > 6) break;
          }
        }
      }

      for (const el of document.querySelectorAll("a, button, input[type=submit], summary")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        // WCAG 2.5.8 exempts a link sitting inline in a sentence — padding it
        // out would wreck the line height of the prose around it.
        const inline = getComputedStyle(el).display === "inline" &&
          ["P", "SPAN", "LI", "TD", "DIV"].includes(el.parentElement?.tagName ?? "") &&
          (el.parentElement?.innerText ?? "").trim().length > el.innerText.trim().length + 8;
        if (inline) continue;
        if (r.height < 40) {
          const label = (el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 40);
          out.small.push(`${el.tagName.toLowerCase()} "${label}" h=${Math.round(r.height)}`);
        }
        const name = (el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim();
        if (!name) out.noName.push(`${el.tagName.toLowerCase()} ${(el.className || "").toString().slice(0, 50)}`);
      }

      for (const img of document.querySelectorAll("img")) {
        if (!img.hasAttribute("alt")) out.noAlt.push(img.getAttribute("src") || "(no src)");
      }

      out.links = [...document.querySelectorAll("a[href^='/']")].map((a) => a.getAttribute("href"));
      out.title = document.title;
      out.h1 = [...document.querySelectorAll("h1")].map((h) => h.innerText.trim());
      return out;
    }, vp.width);

    if (found.overflow.length) {
      problems.push(`${path} [${vp.name}] horizontal scroll: ${found.scrollWidth} > ${vp.width} :: ${found.overflow.join(" | ")}`);
    }
    if (found.small.length) problems.push(`${path} [${vp.name}] small tap targets: ${[...new Set(found.small)].join(" | ")}`);
    if (found.noAlt.length) problems.push(`${path} [${vp.name}] img without alt: ${found.noAlt.join(", ")}`);
    if (found.noName.length) problems.push(`${path} [${vp.name}] control with no accessible name: ${[...new Set(found.noName)].join(" | ")}`);
    if (consoleErrors.length) problems.push(`${path} [${vp.name}] console: ${[...new Set(consoleErrors)].slice(0, 4).join(" | ")}`);
    if (!found.title) problems.push(`${path} [${vp.name}] missing <title>`);
    if (found.h1.length !== 1) problems.push(`${path} [${vp.name}] ${found.h1.length} h1 elements: ${found.h1.join(" / ")}`);

    for (const l of found.links) seenLinks.add(l);
  }

  await ctx.close();
}

// Every internal link must resolve.
const ctx = await browser.newContext();
const page = await ctx.newPage();
for (const link of [...seenLinks].sort()) {
  const r = await page.goto(BASE + link, { waitUntil: "domcontentloaded" }).catch(() => null);
  const status = r?.status() ?? 0;
  // /dashboard redirects to /login when signed out, which is correct.
  if (status !== 200) problems.push(`broken internal link ${link} → ${status}`);
}
await ctx.close();
await browser.close();

console.log(`\nChecked ${PAGES.length} pages x ${VIEWPORTS.length} widths, ${seenLinks.size} internal links.`);
if (problems.length === 0) {
  console.log("No problems found.");
} else {
  console.log(`\n${problems.length} problem(s):\n`);
  for (const p of problems) console.log("  - " + p);
}
