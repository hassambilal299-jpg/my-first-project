/**
 * The checks Sitegrade runs against a website.
 *
 * Each check returns a Finding. The rules here are deliberately written in
 * the language a business owner understands — "customers on phones can't read
 * your site" rather than "missing viewport meta tag" — because the report is
 * meant to be handed to a prospect, not a developer.
 */
import * as cheerio from "cheerio";

export type Severity = "critical" | "warning" | "pass";

/**
 * Every rule this file can report, grouped the way the report presents them.
 *
 * This exists so the number quoted on the marketing pages comes from the
 * code rather than from memory. It was "18 checks" everywhere for a while
 * when the real figure was 15, which is the kind of small untruth that makes
 * a customer doubt the rest of the report.
 *
 * A reachability failure replaces every other finding (there is nothing to
 * measure on a page that didn't load), so it is listed once, under Trust.
 */
export const CHECK_REGISTRY: Record<Finding["category"], string[]> = {
  "Getting customers": [
    "A phone number a visitor can tap",
    "A contact form or email address",
    "A preview image when the page is shared",
    "Visitor tracking actually installed",
  ],
  Speed: [
    "How long the page takes to load",
    "How heavy the page code is",
    "Whether the server compresses it",
  ],
  Mobile: [
    "The setting that makes a site fit a phone",
    "Layouts pinned to a desktop width",
  ],
  Trust: [
    "Whether the site loads at all",
    "A valid, in-date SSL certificate",
  ],
  Google: [
    "The page title Google shows in results",
    "The description under that title",
    "Exactly one main heading",
    "Descriptions on images",
  ],
};

/** The honest headline number. Derived, so it cannot drift. */
export const CHECK_COUNT = Object.values(CHECK_REGISTRY).reduce(
  (n, group) => n + group.length,
  0,
);

export type Finding = {
  /** Stable key, so findings can be compared between audits. */
  id: string;
  /** Which part of the report this belongs under. */
  category: "Speed" | "Mobile" | "Trust" | "Google" | "Getting customers";
  severity: Severity;
  /** One line, written for the business owner. */
  title: string;
  /** What it means and why it costs them money. Empty when passing. */
  detail: string;
  /** What actually fixes it. This is the part that sells the work. */
  fix?: string;
  /** How much this pulls the score down. 0 for a pass. */
  weight: number;
};

export type PageData = {
  url: string;
  finalUrl: string;
  status: number;
  html: string;
  /** Milliseconds from request start to the last byte of HTML. */
  loadMs: number;
  /** Bytes of HTML only — not images or scripts. */
  htmlBytes: number;
  headers: Record<string, string>;
  /** Set when the site could not be reached at all. */
  error?: string;
};

/* ------------------------------------------------------------------ */
/* Thresholds — one place to tune the whole product's opinion          */
/* ------------------------------------------------------------------ */

const SLOW_MS = 2500;
const VERY_SLOW_MS = 5000;
const HEAVY_HTML_KB = 150;
const TITLE_MIN = 20;
const TITLE_MAX = 65;
const DESC_MIN = 70;
const DESC_MAX = 160;

/* ------------------------------------------------------------------ */

const pass = (
  id: string,
  category: Finding["category"],
  title: string,
): Finding => ({ id, category, severity: "pass", title, detail: "", weight: 0 });

/**
 * Run every check against a fetched page.
 *
 * Pure: takes already-fetched data and returns findings. No network calls, so
 * it is fully testable against fixture HTML.
 */
export function runChecks(page: PageData): Finding[] {
  // Nothing else is meaningful if the site is down.
  if (page.error || page.status >= 400) {
    return [
      {
        id: "reachable",
        category: "Trust",
        severity: "critical",
        title: "Your website isn't loading",
        detail: page.error
          ? `We couldn't reach the site at all: ${page.error}`
          : `The site returned an error (HTTP ${page.status}). Anyone clicking your link right now sees a broken page.`,
        fix: "Check that the domain is paid up and the hosting is running.",
        weight: 40,
      },
    ];
  }

  const $ = cheerio.load(page.html);
  const findings: Finding[] = [];

  findings.push(...speedChecks(page));
  findings.push(...mobileChecks($));
  findings.push(...trustChecks(page));
  findings.push(...googleChecks($));
  findings.push(...conversionChecks($, page));

  return findings;
}

/* ------------------------------------------------------------------ */
/* Speed                                                               */
/* ------------------------------------------------------------------ */

/** "0.0 seconds" reads like the check failed, so say it in words instead. */
function describeLoad(ms: number): string {
  if (ms < 100) return "under 0.1 seconds";
  return `${(ms / 1000).toFixed(1)} seconds`;
}

/** Same for a page under 1 KB — "0 KB" looks like a bug. */
function describeSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  return `${Math.round(bytes / 1024)} KB`;
}

function speedChecks(page: PageData): Finding[] {
  const out: Finding[] = [];
  const secs = describeLoad(page.loadMs);

  if (page.loadMs > VERY_SLOW_MS) {
    out.push({
      id: "load-time",
      category: "Speed",
      severity: "critical",
      title: `Your site takes ${secs} to load`,
      detail:
        "Around half of visitors leave a site that takes more than 3 seconds. At this speed most people on a phone never see your page at all, and Google ranks slow sites lower.",
      fix: "Compress the images, turn on caching, and cut unused scripts.",
      weight: 20,
    });
  } else if (page.loadMs > SLOW_MS) {
    out.push({
      id: "load-time",
      category: "Speed",
      severity: "warning",
      title: `Your site takes ${secs} to load`,
      detail:
        "Under 2.5 seconds is the target. You're above it, which costs you visitors and search ranking.",
      fix: "Compress the images and turn on caching.",
      weight: 8,
    });
  } else {
    out.push(pass("load-time", "Speed", `Loads in ${secs}`));
  }

  const kb = Math.round(page.htmlBytes / 1024);
  const size = describeSize(page.htmlBytes);
  if (kb > HEAVY_HTML_KB) {
    out.push({
      id: "page-weight",
      category: "Speed",
      severity: "warning",
      title: `The page code is heavy (${size})`,
      detail:
        "That's a lot to download before anything appears, especially on mobile data.",
      fix: "Remove unused page builder code and plugins.",
      weight: 5,
    });
  } else {
    out.push(pass("page-weight", "Speed", `Page code is a reasonable ${size}`));
  }

  const encoding = page.headers["content-encoding"] ?? "";
  if (!/gzip|br|deflate|zstd/i.test(encoding)) {
    out.push({
      id: "compression",
      category: "Speed",
      severity: "warning",
      title: "Compression is switched off",
      detail:
        "Your server is sending files uncompressed. Turning compression on typically cuts load time by half or more, and it's a setting, not a rebuild.",
      fix: "Enable gzip or Brotli compression on the server.",
      weight: 8,
    });
  } else {
    out.push(pass("compression", "Speed", "Files are compressed"));
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Mobile                                                              */
/* ------------------------------------------------------------------ */

function mobileChecks($: cheerio.CheerioAPI): Finding[] {
  const out: Finding[] = [];

  const viewport = $('meta[name="viewport"]').attr("content");
  if (!viewport) {
    out.push({
      id: "viewport",
      category: "Mobile",
      severity: "critical",
      title: "Your site isn't built for phones",
      detail:
        "The page has no mobile setting, so phones shrink the whole desktop layout down. Visitors have to pinch and zoom to read anything. Over 60% of local searches happen on a phone.",
      fix: "Add a mobile viewport setting and make the layout responsive.",
      weight: 20,
    });
  } else if (/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/i.test(viewport)) {
    out.push({
      id: "viewport",
      category: "Mobile",
      severity: "warning",
      title: "Visitors can't zoom in on your site",
      detail:
        "Zooming is disabled. Anyone with less than perfect eyesight cannot read your page, and it's an accessibility problem.",
      fix: "Remove user-scalable=no from the viewport setting.",
      weight: 6,
    });
  } else {
    out.push(pass("viewport", "Mobile", "Set up correctly for phones"));
  }

  // Fixed pixel widths are the classic sign of a desktop-only layout.
  const wideInline = $("[style]")
    .toArray()
    .filter((el) => {
      const style = $(el).attr("style") ?? "";
      const m = /width\s*:\s*(\d{3,})px/i.exec(style);
      return m ? Number(m[1]) > 600 : false;
    }).length;

  if (wideInline > 0) {
    out.push({
      id: "fixed-width",
      category: "Mobile",
      severity: "warning",
      title: `${wideInline} element${wideInline > 1 ? "s are" : " is"} too wide for a phone screen`,
      detail:
        "Parts of the page use fixed widths wider than a phone, which forces visitors to scroll sideways to read.",
      fix: "Replace fixed pixel widths with percentage or max-width.",
      weight: 5,
    });
  } else {
    out.push(pass("fixed-width", "Mobile", "Nothing is forcing sideways scrolling"));
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Trust                                                               */
/* ------------------------------------------------------------------ */

function trustChecks(page: PageData): Finding[] {
  const out: Finding[] = [];

  if (!page.finalUrl.startsWith("https://")) {
    out.push({
      id: "ssl",
      category: "Trust",
      severity: "critical",
      title: "Your site shows a “Not secure” warning",
      detail:
        "The site has no SSL certificate, so Chrome puts a “Not secure” label in the address bar. Visitors see that before they see anything you wrote, and Google ranks insecure sites lower.",
      fix: "Install an SSL certificate — most hosts give one free.",
      weight: 25,
    });
  } else {
    out.push(pass("ssl", "Trust", "Secure connection (SSL) is working"));
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Google / SEO                                                        */
/* ------------------------------------------------------------------ */

function googleChecks($: cheerio.CheerioAPI): Finding[] {
  const out: Finding[] = [];

  const title = ($("title").first().text() ?? "").trim();
  if (!title) {
    out.push({
      id: "title",
      category: "Google",
      severity: "critical",
      title: "Your page has no title",
      detail:
        "The title is the blue clickable line in Google results. Without it Google invents one, usually the domain name, which nobody clicks.",
      fix: "Write a title with the service and the town in it.",
      weight: 15,
    });
  } else if (title.length < TITLE_MIN) {
    out.push({
      id: "title",
      category: "Google",
      severity: "warning",
      title: `Your Google title is too short (${title.length} characters)`,
      detail: `It currently reads “${title}”. You're leaving out words people search for.`,
      fix: `Aim for ${TITLE_MIN}–${TITLE_MAX} characters, including your service and town.`,
      weight: 6,
    });
  } else if (title.length > TITLE_MAX) {
    out.push({
      id: "title",
      category: "Google",
      severity: "warning",
      title: `Your Google title gets cut off (${title.length} characters)`,
      detail: "Google truncates it, so the end is invisible in search results.",
      fix: `Trim it to under ${TITLE_MAX} characters.`,
      weight: 4,
    });
  } else {
    out.push(pass("title", "Google", "Page title is a good length"));
  }

  const desc = ($('meta[name="description"]').attr("content") ?? "").trim();
  if (!desc) {
    out.push({
      id: "description",
      category: "Google",
      severity: "warning",
      title: "No description for Google results",
      detail:
        "This is the grey text under your link in Google. Without it Google grabs a random sentence from the page, which often makes no sense.",
      fix: `Write ${DESC_MIN}–${DESC_MAX} characters describing what you do and where.`,
      weight: 8,
    });
  } else if (desc.length < DESC_MIN || desc.length > DESC_MAX) {
    out.push({
      id: "description",
      category: "Google",
      severity: "warning",
      title: `Your Google description is the wrong length (${desc.length} characters)`,
      detail:
        desc.length > DESC_MAX
          ? "Google cuts it off mid-sentence."
          : "It's too short to sell anyone on clicking.",
      fix: `Aim for ${DESC_MIN}–${DESC_MAX} characters.`,
      weight: 4,
    });
  } else {
    out.push(pass("description", "Google", "Google description is a good length"));
  }

  const h1s = $("h1");
  if (h1s.length === 0) {
    out.push({
      id: "h1",
      category: "Google",
      severity: "warning",
      title: "No main heading on the page",
      detail:
        "Google uses the main heading to work out what the page is about. Without one it has to guess.",
      fix: "Add one main heading saying what you do and where.",
      weight: 6,
    });
  } else if (h1s.length > 1) {
    out.push({
      id: "h1",
      category: "Google",
      severity: "warning",
      title: `The page has ${h1s.length} main headings`,
      detail:
        "More than one main heading confuses Google about what the page is really about.",
      fix: "Keep one main heading and make the rest subheadings.",
      weight: 3,
    });
  } else {
    out.push(pass("h1", "Google", "Has a clear main heading"));
  }

  const imgs = $("img").toArray();
  const noAlt = imgs.filter((el) => {
    const alt = $(el).attr("alt");
    return alt === undefined || alt.trim() === "";
  }).length;

  if (imgs.length > 0 && noAlt / imgs.length > 0.3) {
    out.push({
      id: "alt-text",
      category: "Google",
      severity: "warning",
      title: `${noAlt} of ${imgs.length} images have no description`,
      detail:
        "Image descriptions help Google understand your photos, and screen readers depend on them entirely.",
      fix: "Add a short alt description to each meaningful image.",
      weight: 5,
    });
  } else if (imgs.length > 0) {
    out.push(pass("alt-text", "Google", "Images are described properly"));
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Getting customers — the checks that actually sell the work          */
/* ------------------------------------------------------------------ */

const PHONE_RE =
  /(\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;

function conversionChecks($: cheerio.CheerioAPI, page: PageData): Finding[] {
  const out: Finding[] = [];
  const text = $("body").text();

  const hasTelLink = $('a[href^="tel:"]').length > 0;
  const hasPhoneText = PHONE_RE.test(text);

  if (!hasPhoneText && !hasTelLink) {
    out.push({
      id: "phone",
      category: "Getting customers",
      severity: "critical",
      title: "No phone number anywhere on the page",
      detail:
        "Someone ready to hire you has no way to call. For a local business this is the single most expensive thing on this list.",
      fix: "Put the phone number in the header, as a tappable link.",
      weight: 20,
    });
  } else if (!hasTelLink) {
    out.push({
      id: "phone",
      category: "Getting customers",
      severity: "warning",
      title: "Your phone number isn't tappable on mobile",
      detail:
        "The number is on the page but it isn't a link, so phone visitors have to memorise it and switch apps to dial. Most won't.",
      fix: 'Wrap the number in a tel: link so one tap calls you.',
      weight: 10,
    });
  } else {
    out.push(pass("phone", "Getting customers", "Phone number is tappable"));
  }

  const hasEmail = $('a[href^="mailto:"]').length > 0 || /@[\w.-]+\.\w{2,}/.test(text);
  const hasForm = $("form").length > 0;

  if (!hasForm && !hasEmail) {
    out.push({
      id: "contact",
      category: "Getting customers",
      severity: "critical",
      title: "No contact form and no email address",
      detail:
        "Anyone who'd rather message than call has no way to reach you. People who won't phone a stranger are a large share of your market.",
      fix: "Add a short contact form — name, phone, what they need.",
      weight: 15,
    });
  } else if (!hasForm) {
    out.push({
      id: "contact",
      category: "Getting customers",
      severity: "warning",
      title: "No contact form",
      detail:
        "There's an email address but no form. Forms get filled out far more often than emails get written.",
      fix: "Add a three-field contact form.",
      weight: 6,
    });
  } else {
    out.push(pass("contact", "Getting customers", "Visitors can get in touch"));
  }

  // Analytics — if they can't measure it, they can't know it's broken.
  const html = page.html;
  // Matches the real snippets these tools ship, not just one call style —
  // a GA4 install may reference gtag, dataLayer or the tag manager URL.
  const hasAnalytics =
    /\bgtag\b|googletagmanager|google-analytics|\bdataLayer\b|gaq|plausible\.io|usefathom|fathom\.js|umami|matomo|piwik|posthog|segment\.(com|io)|hotjar|clarity\.ms|mixpanel/i.test(
      html,
    );
  if (!hasAnalytics) {
    out.push({
      id: "analytics",
      category: "Getting customers",
      severity: "warning",
      title: "Nothing is tracking your visitors",
      detail:
        "There's no analytics installed, so you have no idea how many people visit, what they look at, or where they leave.",
      fix: "Install Google Analytics, or something simpler like Plausible.",
      weight: 5,
    });
  } else {
    out.push(pass("analytics", "Getting customers", "Visitor tracking is installed"));
  }

  // Social preview — what their link looks like when shared.
  const ogTitle = $('meta[property="og:title"]').attr("content");
  const ogImage = $('meta[property="og:image"]').attr("content");
  if (!ogTitle || !ogImage) {
    out.push({
      id: "social-preview",
      category: "Getting customers",
      severity: "warning",
      title: "Your link looks broken when shared",
      detail:
        "When someone pastes your website into Facebook, WhatsApp or a text, there's no picture or title — just a bare URL. It looks like spam and gets fewer clicks.",
      fix: "Add social preview tags with your logo and a headline.",
      weight: 6,
    });
  } else {
    out.push(pass("social-preview", "Getting customers", "Shared links show a proper preview"));
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

/**
 * Turn findings into a 0–100 score.
 *
 * Starts at 100 and subtracts each finding's weight. Deliberately harsh:
 * a report that says "78/100, looking good" does not start a sales
 * conversation, and an average small-business site genuinely does have
 * this many problems.
 */
export function scoreOf(findings: Finding[]): number {
  const lost = findings.reduce((sum, f) => sum + f.weight, 0);
  return Math.max(0, Math.min(100, 100 - lost));
}

export function gradeOf(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 55) return "D";
  return "F";
}
