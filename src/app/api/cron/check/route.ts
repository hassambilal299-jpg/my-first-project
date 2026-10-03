/**
 * The scheduled check. Vercel Cron hits this once a day (see vercel.json).
 *
 * Protected by CRON_SECRET: without it, anyone who finds the URL could make
 * your server audit sites and send emails on your bill.
 */
import { NextRequest, NextResponse } from "next/server";
import { dueSites, runCheck } from "@/lib/monitor";
import { purgeOldAuditHits } from "@/lib/rate-limit";
import { requireSecret } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Audits are network-bound; give the run room to finish. */
export const maxDuration = 300;

/** Audit this many sites at once. Enough to be quick, polite to the targets. */
const CONCURRENCY = 4;

/**
 * Stop starting new batches with less than this left of the run's budget.
 *
 * One audit can take the full 20-second fetch timeout, so a batch started
 * with only a few seconds to spare is killed halfway through: the sites in
 * it never get their lastCheckedAt written, and the run returns nothing at
 * all. Better to finish cleanly, report how many were left, and let the next
 * run take them — they are now the oldest, so they go first.
 */
const RESERVE_MS = 30_000;
const BUDGET_MS = maxDuration * 1000 - RESERVE_MS;

export async function GET(req: NextRequest) {
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. The query
  // parameter is accepted here, and only here, so you can trigger a run by
  // hand while testing — it grants nothing but a check.
  const guard = requireSecret(req, "cron");
  if (!guard.ok) return guard.response;

  const started = Date.now();
  const sites = await dueSites();
  const results = [];
  let ranOutOfTime = false;

  for (let i = 0; i < sites.length; i += CONCURRENCY) {
    if (Date.now() - started > BUDGET_MS) {
      ranOutOfTime = true;
      break;
    }
    const batch = sites.slice(i, i + CONCURRENCY);
    // Wrapped rather than passed straight to map: Array.map hands the
    // callback an index too, which would arrive as runCheck's `plan`.
    results.push(...(await Promise.all(batch.map((site) => runCheck(site)))));
  }

  // The rate-limit table records a visitor's IP for an hour. Clearing it here
  // is what actually makes the privacy policy true; the opportunistic sweep
  // inside takeAuditSlot only runs while there is traffic.
  const purged = await purgeOldAuditHits();

  return NextResponse.json({
    checked: results.length,
    due: sites.length,
    skippedForTime: sites.length - results.length,
    ranOutOfTime,
    alertsRaised: results.reduce((n, r) => n + r.alertCount, 0),
    emailsSent: results.filter((r) => r.emailed).length,
    failed: results.filter((r) => r.error).length,
    auditHitsPurged: purged,
    tookMs: Date.now() - started,
    results,
  });
}
