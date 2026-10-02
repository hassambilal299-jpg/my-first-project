/**
 * The scheduled check. Vercel Cron hits this once a day (see vercel.json).
 *
 * Protected by CRON_SECRET: without it, anyone who finds the URL could make
 * your server audit sites and send emails on your bill.
 */
import { NextRequest, NextResponse } from "next/server";
import { dueSites, runCheck } from "@/lib/monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Audits are network-bound; give the run room to finish. */
export const maxDuration = 300;

/** Audit this many sites at once. Enough to be quick, polite to the targets. */
const CONCURRENCY = 4;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 500 });
  }

  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. The query
  // parameter is there so you can trigger a run by hand while testing.
  const header = req.headers.get("authorization");
  const query = req.nextUrl.searchParams.get("secret");
  if (header !== `Bearer ${secret}` && query !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const sites = await dueSites();
  const results = [];

  for (let i = 0; i < sites.length; i += CONCURRENCY) {
    const batch = sites.slice(i, i + CONCURRENCY);
    // Wrapped rather than passed straight to map: Array.map hands the
    // callback an index too, which would arrive as runCheck's `plan`.
    results.push(...(await Promise.all(batch.map((site) => runCheck(site)))));
  }

  return NextResponse.json({
    checked: results.length,
    alertsRaised: results.reduce((n, r) => n + r.alertCount, 0),
    emailsSent: results.filter((r) => r.emailed).length,
    failed: results.filter((r) => r.error).length,
    tookMs: Date.now() - started,
    results,
  });
}
