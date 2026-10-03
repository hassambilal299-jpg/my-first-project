/**
 * Fetching the page. The only part of the audit that touches the network.
 *
 * Kept separate from checks.ts so the rules can be tested against fixture
 * HTML without any network at all.
 */
import { runChecks, scoreOf, gradeOf, type Finding, type PageData } from "@/lib/checks";
import { readCertificate } from "@/lib/tls";

/** Long enough for a genuinely slow site, short enough not to hang the UI. */
const TIMEOUT_MS = 20_000;

/** Don't download a 40MB page into memory. */
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Identify the crawler honestly. Pretending to be Chrome gets you blocked by
 * the same WAFs that would block you anyway, and it's the wrong thing to do.
 */
const USER_AGENT =
  "Mozilla/5.0 (compatible; SitegradeBot/1.0; +https://sitegrade.app/bot)";

export type AuditResult = {
  url: string;
  finalUrl: string;
  score: number;
  grade: string;
  findings: Finding[];
  loadMs: number;
  auditedAt: Date;
};

/**
 * Normalise whatever the user typed into a URL we can fetch.
 * "mikesplumbing.com" and "MIKESPLUMBING.COM/" both become
 * "https://mikesplumbing.com/".
 */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withScheme);

    // Block anything pointing back at our own infrastructure. Without this,
    // someone can type "http://localhost:5432" and use the auditor to probe
    // our internal network (server-side request forgery).
    if (isPrivateHost(url.hostname)) return null;

    // A real website address has a dot in it. Skipped when private hosts are
    // allowed, so "localhost:3000" works during local development.
    if (!url.hostname.includes(".") && !privateHostsAllowed()) return null;

    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Hostnames that must never be fetched from the server.
 *
 * ALLOW_PRIVATE_HOSTS=1 lifts this for local development, so you can point
 * the auditor at a site running on your own machine. NEVER set it in
 * production — it is what stops a visitor using your server to probe your
 * internal network.
 */
function privateHostsAllowed(): boolean {
  return (
    process.env.ALLOW_PRIVATE_HOSTS === "1" &&
    process.env.NODE_ENV !== "production"
  );
}

function isPrivateHost(hostname: string): boolean {
  if (privateHostsAllowed()) return false;
  return isPrivateHostname(hostname);
}

/** The hostname test on its own, without the environment escape hatch. */
export function isPrivateHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal")) {
    return true;
  }
  return isPrivateIp(h);
}

/**
 * Whether a literal IP address is one we must never fetch.
 *
 * Checking the hostname is not enough on its own: nothing stops someone
 * pointing a perfectly ordinary domain at 169.254.169.254 and handing it to
 * us. Everything that reaches the network is checked against this after the
 * name has been resolved.
 */
export function isPrivateIp(value: string): boolean {
  const ip = value.toLowerCase().replace(/^\[|\]$/g, "");

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0) return true;                        // "this network"
    if (a === 10) return true;                       // private
    if (a === 127) return true;                      // loopback
    if (a === 169 && b === 254) return true;         // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true;         // private
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a === 192 && b === 0) return true;            // IETF protocol assignments
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true;                        // multicast and reserved
    return false;
  }

  const v6 = expandIpv6(ip);
  if (!v6) return false; // not an IP literal at all — an ordinary hostname

  /**
   * IPv4-mapped (::ffff:0:0/96) and IPv4-compatible (::/96) addresses are
   * really IPv4 addresses, so they are judged by the embedded one.
   *
   * Matching this on the text used to be the bug: `::ffff:127.0.0.1` was
   * caught, but the WHATWG URL parser rewrites that exact address to
   * `::ffff:7f00:1`, which sailed straight through to loopback. Comparing
   * the expanded numbers instead means both spellings land on the same rule.
   */
  const quadFrom = (hi: number, lo: number) =>
    [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");

  const embedsIpv4 =
    (v6.slice(0, 5).every((x) => x === 0) && (v6[5] === 0xffff || v6[5] === 0)) ||
    // 64:ff9b::/96, the well-known NAT64 prefix, embeds one too.
    (v6[0] === 0x64 && v6[1] === 0xff9b && v6.slice(2, 6).every((x) => x === 0));

  if (embedsIpv4) return isPrivateIp(quadFrom(v6[6], v6[7]));

  /**
   * 6to4 (2002::/16) carries its IPv4 address in the next two groups, so
   * 2002:7f00:1:: is loopback wearing a hat. It sits inside the global
   * unicast range below, so without this it would be waved through.
   */
  if (v6[0] === 0x2002) return isPrivateIp(quadFrom(v6[1], v6[2]));

  /**
   * Everything else is DENIED unless it is global unicast.
   *
   * 2000::/3 is the only range currently allocated for globally routable
   * unicast, so an address outside it is loopback, link-local, unique-local,
   * multicast, or something not yet defined — none of which a customer's
   * website is ever served from. Default-deny is the right way round here:
   * a new reserved range should fail closed, not become a fresh hole.
   */
  return !(v6[0] >= 0x2000 && v6[0] <= 0x3fff);
}

/**
 * Expands an IPv6 literal to its eight 16-bit groups, or null if the text
 * isn't one. Handles `::` compression and a trailing dotted-quad.
 */
function expandIpv6(input: string): number[] | null {
  if (!input.includes(":")) return null;

  let text = input;

  // A trailing IPv4 part (…:1.2.3.4) becomes the two hex groups it stands for.
  const dotted = /:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (dotted) {
    const octets = dotted.slice(1, 5).map(Number);
    if (octets.some((n) => n > 255)) return null;
    const hex = [
      ((octets[0] << 8) | octets[1]).toString(16),
      ((octets[2] << 8) | octets[3]).toString(16),
    ].join(":");
    text = `${text.slice(0, dotted.index)}:${hex}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];

  let groups: string[];
  if (halves.length === 2) {
    const gap = 8 - head.length - tail.length;
    if (gap < 0) return null;
    groups = [...head, ...Array<string>(gap).fill("0"), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  const numbers = groups.map((g) =>
    /^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN,
  );
  return numbers.some(Number.isNaN) ? null : numbers;
}

/**
 * Resolves a hostname and reports whether any address behind it is private.
 *
 * All addresses are checked, not just the first: a name with both a public
 * and a private record must be refused, because which one gets connected to
 * is not ours to decide.
 */
async function resolvesToPrivate(hostname: string): Promise<boolean> {
  const bare = hostname.replace(/^\[|\]$/g, "");

  // A literal address needs no lookup.
  if (/^[\d.]+$/.test(bare) || bare.includes(":")) return isPrivateIp(bare);

  try {
    const { lookup } = await import("dns/promises");
    const records = await lookup(bare, { all: true });
    if (records.length === 0) return true;
    return records.some((r) => isPrivateIp(r.address));
  } catch {
    // A name that cannot be resolved is refused rather than attempted; the
    // fetch would fail anyway, and failing closed is the right default here.
    return true;
  }
}

/** How many redirects to follow before giving up. */
const MAX_REDIRECTS = 5;

export type FetchOptions = {
  /**
   * Relaxes the private-address checks.
   *
   * `true` turns them off entirely. A list of hostnames exempts just those,
   * which is what the tests use: a fixture on localhost is reachable, while a
   * redirect from it to 169.254.169.254 is still refused — so the redirect
   * guard is exercised rather than bypassed.
   *
   * The application only ever passes `privateHostsAllowed()`, which is itself
   * disabled in production builds.
   */
  allowPrivate?: boolean | string[];
};

/** Fetch a page and time it. Never throws — failures come back as PageData.error. */
export async function fetchPage(
  url: string,
  { allowPrivate = false }: FetchOptions = {},
): Promise<PageData> {
  const started = Date.now();

  const exempt = (hostname: string): boolean => {
    if (allowPrivate === true) return true;
    if (Array.isArray(allowPrivate)) {
      return allowPrivate.includes(hostname.toLowerCase().replace(/^\[|\]$/g, ""));
    }
    return false;
  };

  try {
    // Redirects are followed by hand rather than by fetch, because each hop
    // has to be checked. `redirect: "follow"` would happily chase a 302 from
    // a public page straight to an internal address.
    let current = url;
    let res: Response | undefined;

    for (let hop = 0; ; hop++) {
      const target = new URL(current);

      // Only ever speak HTTP. file:, gopher: and friends are not websites,
      // and this is checked even for an exempt host.
      if (target.protocol !== "https:" && target.protocol !== "http:") {
        throw new Error("We can only check http and https addresses.");
      }

      if (!exempt(target.hostname)) {
        if (isPrivateHostname(target.hostname) || (await resolvesToPrivate(target.hostname))) {
          throw new Error(
            hop === 0
              ? "That address points to a private network, so we can't check it."
              : "That site redirects to a private address, so we stopped there.",
          );
        }
      }

      res = await fetch(current, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*" },
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!location) break;

      if (hop >= MAX_REDIRECTS) {
        throw new Error("That site redirects in a loop we couldn't follow.");
      }
      // Relative Location headers are legal and common.
      current = new URL(location, current).toString();
    }

    if (!res) throw new Error("No response.");

    // Read with a cap so a huge page can't exhaust memory.
    const reader = res.body?.getReader();
    let bytes = 0;
    const chunks: Uint8Array[] = [];

    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > MAX_BYTES) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }

    const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const html = buffer.toString("utf8");
    const loadMs = Date.now() - started;

    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));

    const finalUrl = current || res.url || url;

    // Read after the page, not instead of it, so a certificate probe that
    // hangs can never stop the audit producing a report.
    let certDaysLeft: number | undefined;
    if (finalUrl.startsWith("https://")) {
      const target = new URL(finalUrl);
      const cert = await readCertificate(
        target.hostname.replace(/^\[|\]$/g, ""),
        target.port ? Number(target.port) : 443,
      );
      if (cert) certDaysLeft = cert.daysLeft;
    }

    return {
      url,
      // `current` is where we actually ended up after following the chain
      // ourselves; res.url is empty on a manual-redirect response.
      finalUrl,
      status: res.status,
      html,
      loadMs,
      htmlBytes: buffer.byteLength,
      headers,
      certDaysLeft,
    };
  } catch (err) {
    /**
     * A bare domain gets https:// put in front of it, so a small business
     * still serving only port 80 failed here with ECONNREFUSED — and was
     * then reported as DOWN, which emailed its owner to say their working
     * website was offline. It is the worst kind of false alarm: it trains
     * people to ignore the alerts.
     *
     * So before giving up on an https connection failure, try plain http
     * once. If that answers, the site is up and the real finding is that it
     * has no SSL at all, which trustChecks reports from the http finalUrl.
     */
    if (canRetryOverHttp(url, err)) {
      const overHttp = await fetchPage(url.replace(/^https:/i, "http:"), {
        allowPrivate,
      });
      if (!overHttp.error) {
        return { ...overHttp, url, httpsUnavailable: true };
      }
    }

    return {
      url,
      finalUrl: url,
      status: 0,
      html: "",
      loadMs: Date.now() - started,
      htmlBytes: 0,
      headers: {},
      error: describeFetchError(err),
    };
  }
}

/**
 * Only for connection-level https failures. A 500, a timeout on a site that
 * did answer, or our own private-address refusal must not be retried — the
 * first two aren't about SSL, and retrying the third would walk straight
 * around the SSRF guard.
 */
function canRetryOverHttp(url: string, err: unknown): boolean {
  if (!/^https:/i.test(url)) return false;

  const text = describeFetchError(err).toLowerCase();
  if (text.includes("private")) return false;

  return (
    text.includes("refused") ||
    text.includes("ssl") ||
    text.includes("certificate") ||
    text.includes("tls") ||
    text.includes("protocol") ||
    text.includes("reset")
  );
}

/** Turn a raw fetch error into something a business owner can act on. */
function describeFetchError(err: unknown): string {
  // Node's fetch throws a generic "fetch failed" and hides the real reason in
  // `cause`, sometimes nested. Walk the chain or every network problem would
  // be reported to the user as "fetch failed", which tells them nothing.
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    parts.push(current.message);
    const code = (current as NodeJS.ErrnoException).code;
    if (code) parts.push(code);
    current = (current as { cause?: unknown }).cause;
  }
  const message = parts.join(" ");

  if (/timeout|aborted|timed out|ETIMEDOUT/i.test(message)) {
    return "the site took too long to respond (over 20 seconds)";
  }
  if (/ENOTFOUND|getaddrinfo|dns/i.test(message)) {
    return "the domain name doesn't resolve — it may have expired";
  }
  if (/certificate|SSL|TLS/i.test(message)) {
    return "the security certificate is invalid or expired";
  }
  if (/ECONNREFUSED|refused/i.test(message)) {
    return "the server refused the connection";
  }
  // Our own refusals, raised before any request goes out. Passed through as
  // written rather than mapped to a network reason they aren't.
  if (/private network|private address|redirects in a loop|http and https/i.test(message)) {
    return parts[0];
  }
  if (/ECONNRESET|socket hang up/i.test(message)) {
    return "the server closed the connection unexpectedly";
  }
  // Last resort. Never surface a bare "fetch failed" to a business owner.
  return message.trim() && !/^fetch failed\s*$/i.test(message.trim())
    ? message
    : "the server didn't respond";
}

/** Fetch a site and grade it. */
export async function auditSite(rawUrl: string): Promise<AuditResult> {
  const url = normalizeUrl(rawUrl);
  if (!url) throw new Error("That doesn't look like a website address.");

  // The only place the escape hatch reaches the fetcher, and it is itself
  // off in production builds.
  const page = await fetchPage(url, { allowPrivate: privateHostsAllowed() });
  const findings = runChecks(page);
  const score = scoreOf(findings);

  return {
    url,
    finalUrl: page.finalUrl,
    score,
    grade: gradeOf(score),
    findings,
    loadMs: page.loadMs,
    auditedAt: new Date(),
  };
}
