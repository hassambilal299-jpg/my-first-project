/**
 * Rate limiting for the free audit on the home page.
 *
 * The audit is the whole marketing funnel: anyone can run it without an
 * account, which also means anyone can point a script at it and use our
 * server to hammer somebody else's website. That is the one thing that could
 * get the domain blocked, so it is capped per visitor.
 *
 * The counter lives in Postgres rather than in memory because this runs on
 * serverless functions: each request may land on a different instance, so an
 * in-process Map would count almost nothing.
 *
 * It FAILS OPEN. If the database is unreachable, the audit still runs. A
 * broken limiter must not take down the home page — losing the cap for a few
 * minutes is much cheaper than losing every visitor.
 */
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditHits } from "@/lib/schema";

/** Generous enough that a curious visitor checking their competitors never notices. */
export const AUDITS_PER_HOUR = 12;
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

const ALLOWED: RateDecision = {
  ok: true,
  remaining: AUDITS_PER_HOUR,
  retryAfterMins: 0,
};

/**
 * Records one audit against this visitor and says whether it may proceed.
 *
 * `key` should be the client IP. An empty key means we could not identify
 * the caller, in which case the request is allowed — better than lumping
 * every anonymous visitor into one shared bucket and locking them all out.
 */
export async function takeAuditSlot(key: string): Promise<RateDecision> {
  if (!key) return ALLOWED;

  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MS);

  try {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int`, oldest: sql<Date | null>`min(created_at)` })
      .from(auditHits)
      .where(and(eq(auditHits.key, key), gte(auditHits.createdAt, windowStart)));

    const used = Number(row?.n ?? 0);

    if (used >= AUDITS_PER_HOUR) {
      // The cap lifts when the oldest hit in the window ages out.
      const oldest = row?.oldest ? new Date(row.oldest) : windowStart;
      const freesAt = oldest.getTime() + WINDOW_MS;
      const mins = Math.max(1, Math.ceil((freesAt - now.getTime()) / 60_000));
      return { ok: false, remaining: 0, retryAfterMins: mins };
    }

    await db.insert(auditHits).values({ key });

    // Opportunistic cleanup — cheap, indexed, and saves running a cron for it.
    // One in roughly twenty requests, so it isn't paid for on every audit.
    if (Math.random() < 0.05) {
      await db
        .delete(auditHits)
        .where(lt(auditHits.createdAt, new Date(now.getTime() - KEEP_MS)));
    }

    return { ok: true, remaining: AUDITS_PER_HOUR - used - 1, retryAfterMins: 0 };
  } catch (err) {
    // Fail open, but leave a trace so a persistently broken limiter is
    // visible in the logs rather than silently absent.
    console.error("[rate-limit] unavailable, allowing request:", err);
    return ALLOWED;
  }
}

/** Human wording for a refusal. Kept here so the message is testable. */
export function rateLimitMessage(d: RateDecision): string {
  const unit = d.retryAfterMins === 1 ? "a minute" : `${d.retryAfterMins} minutes`;
  return `That's ${AUDITS_PER_HOUR} audits in an hour — enough to be a script rather than a person. Try again in ${unit}, or create a free account for unlimited checks.`;
}
