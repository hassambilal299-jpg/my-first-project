/**
 * Rate limiting, backed by Postgres.
 *
 * Two things are capped:
 *
 *  - The free audit on the home page. It is the whole marketing funnel —
 *    anyone can run it without an account, which also means anyone can point
 *    a script at it and use our server to hammer somebody else's website.
 *    That is the one thing that could get the domain blocked.
 *  - Sign-in and sign-up attempts, so a stolen password list can't be tried
 *    against us at speed.
 *
 * The counter lives in the database rather than in memory because this runs
 * on serverless functions: each request may land on a different instance, so
 * an in-process Map would count almost nothing.
 *
 * It FAILS OPEN. If the database is unreachable the request still goes
 * through. A broken limiter must not take down the home page or lock
 * everyone out of their account — losing the cap for a few minutes is much
 * cheaper than losing every visitor.
 */
import { headers } from "next/headers";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditHits } from "@/lib/schema";

/**
 * Best guess at who is calling, for rate limiting only.
 *
 * On Vercel the real client address is the LAST entry in x-forwarded-for
 * that the platform itself appended; the leftmost entry is supplied by the
 * caller and can be forged, so keying on it lets anyone defeat the cap by
 * rotating a header. x-real-ip is set by the platform and is preferred when
 * present. An empty string means we could not tell, and the limiter lets
 * those through.
 */
export async function clientKey(): Promise<string> {
  const h = await headers();

  const real = h.get("x-real-ip")?.trim();
  if (real) return real;

  const forwarded = h.get("x-forwarded-for");
  if (!forwarded) return "";

  const hops = forwarded.split(",").map((s) => s.trim()).filter(Boolean);
  return hops[hops.length - 1] ?? "";
}

/** Generous enough that a curious visitor checking competitors never notices. */
export const AUDITS_PER_HOUR = 12;

/** Deliberately tighter. Nobody legitimately fails this many logins an hour. */
export const LOGIN_ATTEMPTS_PER_HOUR = 10;
export const SIGNUPS_PER_HOUR = 5;

const WINDOW_MS = 60 * 60 * 1000;

/** Rows older than this are useless; cleared out as we go. */
const KEEP_MS = 3 * 60 * 60 * 1000;

export type RateDecision = {
  ok: boolean;
  /** How many remain in the current window. */
  remaining: number;
  /** Minutes until the next one frees up. Only meaningful when !ok. */
  retryAfterMins: number;
};

const allowed = (limit: number): RateDecision => ({
  ok: true,
  remaining: limit,
  retryAfterMins: 0,
});

/**
 * Records one attempt and says whether it may proceed.
 *
 * `bucket` separates the counters, so burning your audit allowance never
 * locks you out of logging in. `key` identifies the caller — usually the
 * client IP. An empty key means we could not identify them, in which case
 * the request is allowed rather than lumping every anonymous visitor into
 * one shared bucket and locking them all out together.
 */
export async function takeSlot(
  bucket: string,
  key: string,
  limit: number,
): Promise<RateDecision> {
  if (!key) return allowed(limit);

  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MS);
  const scoped = `${bucket}:${key}`;

  try {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int`, oldest: sql<Date | null>`min(created_at)` })
      .from(auditHits)
      .where(and(eq(auditHits.key, scoped), gte(auditHits.createdAt, windowStart)));

    const used = Number(row?.n ?? 0);

    if (used >= limit) {
      // The cap lifts when the oldest hit in the window ages out.
      const oldest = row?.oldest ? new Date(row.oldest) : windowStart;
      const freesAt = oldest.getTime() + WINDOW_MS;
      const mins = Math.max(1, Math.ceil((freesAt - now.getTime()) / 60_000));
      return { ok: false, remaining: 0, retryAfterMins: mins };
    }

    await db.insert(auditHits).values({ key: scoped });

    // Opportunistic cleanup, roughly one request in twenty, so it isn't paid
    // for on every request. It is only a top-up: the scheduled run calls
    // purgeOldAuditHits unconditionally, because this sweep never fires at
    // all during a quiet week and the privacy policy promises these rows are
    // gone within hours either way.
    if (Math.random() < 0.05) await purgeOldAuditHits(now);

    return { ok: true, remaining: limit - used - 1, retryAfterMins: 0 };
  } catch (err) {
    // Fail open, but leave a trace so a persistently broken limiter is
    // visible in the logs rather than silently absent.
    console.error("[rate-limit] unavailable, allowing request:", err);
    return allowed(limit);
  }
}

export const takeAuditSlot = (key: string) =>
  takeSlot("audit", key, AUDITS_PER_HOUR);

export const takeLoginSlot = (key: string) =>
  takeSlot("login", key, LOGIN_ATTEMPTS_PER_HOUR);

export const takeSignupSlot = (key: string) =>
  takeSlot("signup", key, SIGNUPS_PER_HOUR);

/**
 * Deletes IP records older than the window we could possibly need.
 *
 * Called from the scheduled run so it happens on a timetable rather than
 * only when someone happens to be using the site. Returns how many rows went,
 * and never throws — tidying up must not fail a cron run.
 */
export async function purgeOldAuditHits(now = new Date()): Promise<number> {
  try {
    const removed = await db
      .delete(auditHits)
      .where(lt(auditHits.createdAt, new Date(now.getTime() - KEEP_MS)))
      .returning({ id: auditHits.id });
    return removed.length;
  } catch (err) {
    console.error("[rate-limit] purge failed:", err);
    return 0;
  }
}

/* ------------------------------------------------------------------ */
/* Wording — kept here so the messages are testable                    */
/* ------------------------------------------------------------------ */

const inWords = (mins: number) => (mins === 1 ? "a minute" : `${mins} minutes`);

export function rateLimitMessage(d: RateDecision): string {
  return `That's ${AUDITS_PER_HOUR} audits in an hour — enough to be a script rather than a person. Try again in ${inWords(
    d.retryAfterMins,
  )}, or sign in: audits don't count against this once you have an account.`;
}

export function loginLimitMessage(d: RateDecision): string {
  return `Too many sign-in attempts from here. Try again in ${inWords(
    d.retryAfterMins,
  )}.`;
}

export function signupLimitMessage(d: RateDecision): string {
  return `Too many accounts created from here. Try again in ${inWords(
    d.retryAfterMins,
  )}.`;
}
