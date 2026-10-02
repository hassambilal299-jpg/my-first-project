/**
 * Fetching the page. The only part of the audit that touches the network.
 *
 * Kept separate from checks.ts so the rules can be tested against fixture
 * HTML without any network at all.
 */
import { runChecks, scoreOf, gradeOf, type Finding, type PageData } from "@/lib/checks";

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

  // IPv4-mapped IPv6 (::ffff:127.0.0.1) unwraps to the IPv4 rules below.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return isPrivateIp(mapped[1]);

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

  if (ip === "::" || ip === "::1") return true;       // unspecified, loopback
  if (/^f[cd]/.test(ip)) return true;                 // fc00::/7 unique local
  if (/^fe[89ab]/.test(ip)) return true;              // fe80::/10 link-local
  return false;
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

    return {
      url,
      // `current` is where we actually ended up after following the chain
      // ourselves; res.url is empty on a manual-redirect response.
      finalUrl: current || res.url || url,
      status: res.status,
      html,
      loadMs,
      htmlBytes: buffer.byteLength,
      headers,
    };
  } catch (err) {
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
