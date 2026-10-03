/**
 * Running a scheduled check on one site, and alerting on what changed.
 *
 * Shared by the cron endpoint and by "check now" in the dashboard, so both
 * paths behave identically — a manual check is the same code as a scheduled
 * one, which is the only way to be confident the scheduled one works.
 */
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { alerts, checks, sites, users, type Site } from "@/lib/schema";
import { auditSite } from "@/lib/audit";
import { diffSnapshots, emailSubject, worthEmailing, type Snapshot } from "@/lib/diff";
import { sendAlertEmail } from "@/lib/email";
import { allowedFrequency, canEmailAlerts } from "@/lib/plans";

export type CheckOutcome = {
  siteId: string;
  label: string;
  score: number;
  alertCount: number;
  emailed: boolean;
  error?: string;
};

/**
 * Audit one site, store the result, and raise alerts for anything that
 * changed since last time.
 *
 * Never throws — a single unreachable site must not abort a cron run that
 * still has fifty other sites to get through.
 *
 * `plan` decides whether alerts are emailed as well as recorded. Pass it when
 * the caller already knows it; left out, it is looked up. Alerts are always
 * written to the dashboard regardless of plan — the free tier sees everything,
 * it just has to come and look.
 */
export async function runCheck(
  site: Site,
  plan?: string | null,
): Promise<CheckOutcome> {
  const base = { siteId: site.id, label: site.label };

  try {
    // The previous check is what "changed" is measured against.
    const previousRow = await db.query.checks.findFirst({
      where: eq(checks.siteId, site.id),
      orderBy: desc(checks.createdAt),
    });

    const result = await auditSite(site.url);
    const down = result.findings.some(
      (f) => f.id === "reachable" && f.severity === "critical",
    );

    const [stored] = await db
      .insert(checks)
      .values({
        siteId: site.id,
        score: result.score,
        grade: result.grade,
        down,
        findings: result.findings,
        loadMs: result.loadMs,
      })
      .returning();

    await db
      .update(sites)
      .set({ lastCheckedAt: new Date(), lastScore: result.score })
      .where(eq(sites.id, site.id));

    const previous: Snapshot | null = previousRow
      ? {
          score: previousRow.score,
          findings: previousRow.findings,
          down: previousRow.down,
        }
      : null;

    const changes = diffSnapshots(previous, {
      score: result.score,
      findings: result.findings,
      down,
    });

    if (changes.length === 0) {
      return { ...base, score: result.score, alertCount: 0, emailed: false };
    }

    const rows = await db
      .insert(alerts)
      .values(
        changes.map((c) => ({
          siteId: site.id,
          checkId: stored.id,
          kind: c.kind,
          subject: c.subject,
          title: c.title,
          detail: c.detail,
          fix: c.fix ?? null,
          urgency: c.urgency,
        })),
      )
      .returning();

    let emailed = false;

    const effectivePlan =
      plan ??
      (await db.query.users.findFirst({
        where: eq(users.id, site.userId),
        columns: { plan: true },
      }))?.plan ??
      "FREE";

    if (canEmailAlerts(effectivePlan) && worthEmailing(changes)) {
      const sent = await sendAlertEmail({
        to: site.alertEmail,
        subject: emailSubject(site.label, changes),
        siteLabel: site.label,
        siteUrl: site.url,
        score: result.score,
        alerts: changes,
      });

      if (sent) {
        emailed = true;
        const now = new Date();
        await Promise.all(
          rows.map((r) =>
            db.update(alerts).set({ emailedAt: now }).where(eq(alerts.id, r.id)),
          ),
        );
      }
    }

    return { ...base, score: result.score, alertCount: changes.length, emailed };
  } catch (err) {
    return {
      ...base,
      score: site.lastScore ?? 0,
      alertCount: 0,
      emailed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Every site that is due for a check right now.
 *
 * The interval is checked in code rather than SQL so the rule stays readable
 * and testable; the number of monitored sites is small enough that fetching
 * the unpaused ones and filtering is not worth optimising.
 */
export async function dueSites(now = new Date()): Promise<Site[]> {
  // Joined to users so the owner's plan is known here. Without it a customer
  // who downgrades keeps every site on daily for ever: allowedFrequency was
  // only applied when someone edited the setting, so a stored DAILY survived
  // the downgrade untouched. The FAQ promises daily drops back to weekly, so
  // this is also the code that makes that sentence true.
  const rows = await db
    .select({ site: sites, plan: users.plan })
    .from(sites)
    .innerJoin(users, eq(sites.userId, users.id))
    .where(eq(sites.paused, false))
    // Longest-waiting first. A run that hits its time budget then truncates
    // the freshest sites rather than starving the same unlucky tail every
    // day — without an explicit order, Postgres returns a stable arbitrary
    // order and the sites past the cutoff are never checked at all.
    .orderBy(asc(sites.lastCheckedAt));

  return rows
    .filter(({ site, plan }) => {
      if (!site.lastCheckedAt) return true; // never checked
      const hours = (now.getTime() - site.lastCheckedAt.getTime()) / 3_600_000;
      const frequency = allowedFrequency(plan, site.frequency);
      // A little under the nominal interval, so a cron that fires a few
      // minutes early doesn't skip a site until the next day.
      return frequency === "DAILY" ? hours >= 23 : hours >= 167;
    })
    .map(({ site }) => site);
}
