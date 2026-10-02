/**
 * Change detection — the heart of the monitoring product.
 *
 * A one-off audit says "here is what's broken". Monitoring says "something
 * CHANGED since last week", and that difference is the whole reason someone
 * keeps paying. Everything in this file is about comparing two audits.
 *
 * Pure functions, no database and no network, so every rule below is
 * testable against hand-built fixtures.
 */
import type { Finding, Severity } from "@/lib/checks";

export type AlertKind =
  | "site_down" // was up, now unreachable — the most urgent thing we send
  | "new_problem" // something that was fine is now broken
  | "got_worse" // a warning became critical
  | "score_drop" // overall score fell sharply
  | "fixed"; // good news, batched into the digest rather than sent alone

export type Alert = {
  kind: AlertKind;
  /** The finding id this came from, or "score" for an overall move. */
  subject: string;
  title: string;
  detail: string;
  fix?: string;
  /** Drives email subject lines and what gets sent immediately. */
  urgency: "urgent" | "normal" | "good_news";
};

export type Snapshot = {
  score: number;
  findings: Finding[];
  /** True when the site could not be reached at all. */
  down: boolean;
};

/** A score falling by at least this much is worth telling someone about. */
const SCORE_DROP_THRESHOLD = 10;

const RANK: Record<Severity, number> = { pass: 0, warning: 1, critical: 2 };

/**
 * Compare the newest audit against the previous one.
 *
 * Returns an empty array when nothing meaningful changed — which is the
 * common case, and the reason the weekly email must not be sent on a fixed
 * schedule regardless of content. Nobody keeps paying for "still fine".
 */
export function diffSnapshots(
  previous: Snapshot | null,
  current: Snapshot,
): Alert[] {
  // First ever check. There is nothing to compare against, so we report
  // nothing — the signup flow already showed them the full report.
  if (!previous) return [];

  const alerts: Alert[] = [];

  /* -- the site falling over outranks everything else ---------------- */

  if (current.down && !previous.down) {
    const reason = current.findings[0]?.detail ?? "";
    alerts.push({
      kind: "site_down",
      subject: "reachable",
      title: "Your website is down",
      detail: reason || "We couldn't reach your site on the last check.",
      fix: "Check your hosting and that the domain hasn't expired.",
      urgency: "urgent",
    });
    // Everything else would be noise next to this.
    return alerts;
  }

  if (previous.down && !current.down) {
    alerts.push({
      kind: "fixed",
      subject: "reachable",
      title: "Your website is back up",
      detail: "The site is responding again.",
      urgency: "good_news",
    });
  }

  /* -- per-check comparison ------------------------------------------ */

  const before = new Map(previous.findings.map((f) => [f.id, f]));
  const after = new Map(current.findings.map((f) => [f.id, f]));

  for (const [id, now] of after) {
    const then = before.get(id);

    // A check that didn't run last time isn't a change. It usually means the
    // page gained its first image, or something similar. Reporting it as
    // "new problem" would be a lie.
    if (!then) continue;

    const wasOk = then.severity === "pass";
    const isOk = now.severity === "pass";

    if (wasOk && !isOk) {
      alerts.push({
        kind: "new_problem",
        subject: id,
        title: now.title,
        detail: `This was working at the last check. ${now.detail}`,
        fix: now.fix,
        urgency: now.severity === "critical" ? "urgent" : "normal",
      });
      continue;
    }

    if (!wasOk && isOk) {
      alerts.push({
        kind: "fixed",
        subject: id,
        title: now.title,
        detail: "This was a problem at the last check and is now resolved.",
        urgency: "good_news",
      });
      continue;
    }

    // Both are problems — did it get worse?
    if (!wasOk && !isOk && RANK[now.severity] > RANK[then.severity]) {
      alerts.push({
        kind: "got_worse",
        subject: id,
        title: now.title,
        detail: `This got worse since the last check. ${now.detail}`,
        fix: now.fix,
        urgency: "urgent",
      });
      continue;
    }

    // Both are problems at the same severity, but the wording changed —
    // e.g. load time went from 3.1s to 4.8s. Worth saying, quietly.
    if (!wasOk && !isOk && now.title !== then.title) {
      alerts.push({
        kind: "got_worse",
        subject: id,
        title: now.title,
        detail: `Changed since the last check (was: ${then.title}).`,
        fix: now.fix,
        urgency: "normal",
      });
    }
  }

  /* -- overall score --------------------------------------------------- */

  const drop = previous.score - current.score;
  if (drop >= SCORE_DROP_THRESHOLD) {
    alerts.push({
      kind: "score_drop",
      subject: "score",
      title: `Your site score dropped ${drop} points`,
      detail: `It went from ${previous.score} to ${current.score} since the last check.`,
      urgency: "normal",
    });
  }

  return alerts;
}

/**
 * Should we email about this batch at all?
 *
 * Good news alone is not worth an email — it arrives in the next digest that
 * has something real in it. Sending "everything is still fine" every week is
 * how a monitoring product trains people to ignore it and then cancel.
 */
export function worthEmailing(alerts: Alert[]): boolean {
  return alerts.some((a) => a.urgency === "urgent" || a.urgency === "normal");
}

/** The subject line. Leads with the worst thing, because that's what's read. */
export function emailSubject(siteLabel: string, alerts: Alert[]): string {
  const down = alerts.find((a) => a.kind === "site_down");
  if (down) return `${siteLabel} is DOWN`;

  const urgent = alerts.filter((a) => a.urgency === "urgent");
  if (urgent.length === 1) return `${siteLabel}: ${urgent[0].title}`;
  if (urgent.length > 1) {
    return `${siteLabel}: ${urgent.length} new problems`;
  }

  const normal = alerts.filter((a) => a.urgency === "normal");
  if (normal.length === 1) return `${siteLabel}: ${normal[0].title}`;
  return `${siteLabel}: ${normal.length} changes this week`;
}
