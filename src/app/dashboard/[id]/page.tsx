import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import {
  ArrowLeft,
  ArrowsClockwise,
  CheckCircle,
  Lock,
  Pause,
  Play,
  Trash,
  Warning,
  WarningOctagon,
} from "@phosphor-icons/react/dist/ssr";
import { db } from "@/lib/db";
import { alerts, checks, sites } from "@/lib/schema";
import { getCurrentUser } from "@/lib/auth";
import { Button, Card, EmptyState, ScorePill } from "@/components/ui";
import { RelativeTime } from "@/components/relative-time";
import { ScoreHistory } from "@/components/score-history";
import { AlertEmailForm, ShareLink } from "@/components/site-settings";
import { limitsFor } from "@/lib/plans";
import {
  checkNow,
  markAlertsRead,
  removeSite,
  setFrequency,
  setPaused,
  setShareLink,
} from "../actions";

export const dynamic = "force-dynamic";

export default async function SitePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Scoped to this user — without the userId check anyone could read anyone
  // else's site by guessing an id.
  const site = await db.query.sites.findFirst({
    where: and(eq(sites.id, id), eq(sites.userId, user.id)),
  });
  if (!site) notFound();

  const [feed, history] = await Promise.all([
    db
      .select()
      .from(alerts)
      .where(eq(alerts.siteId, site.id))
      .orderBy(desc(alerts.createdAt))
      .limit(50),
    db
      .select({ score: checks.score, createdAt: checks.createdAt, down: checks.down })
      .from(checks)
      .where(eq(checks.siteId, site.id))
      .orderBy(desc(checks.createdAt))
      .limit(20),
  ]);

  const unread = feed.filter((a) => !a.readAt).length;
  const plan = limitsFor(user.plan);

  // Built from the request host so the copied link is right on a preview
  // deployment, a custom domain, or localhost, with nothing to configure.
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="flex size-11 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-slate-100 hover:text-ink"
          >
            <ArrowLeft className="size-5" aria-hidden="true" />
            <span className="sr-only">Back to all sites</span>
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-extrabold">{site.label}</h1>
            <a
              href={site.url}
              target="_blank"
              rel="noreferrer noopener"
              className="truncate text-sm text-ink-muted hover:underline"
            >
              {site.url}
            </a>
          </div>
        </div>

        {/* -- status + controls ----------------------------------- */}
        <Card className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ScorePill score={site.lastScore} />
            <span className="text-sm text-ink-muted">
              {site.lastCheckedAt ? (
                <>
                  Checked <RelativeTime date={site.lastCheckedAt} />
                </>
              ) : (
                "Not checked yet"
              )}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <form action={checkNow}>
              <input type="hidden" name="siteId" value={site.id} />
              <Button type="submit" variant="secondary">
                <ArrowsClockwise className="size-4" aria-hidden="true" />
                Check now
              </Button>
            </form>

            <form action={setPaused}>
              <input type="hidden" name="siteId" value={site.id} />
              <input type="hidden" name="paused" value={String(!site.paused)} />
              <Button type="submit" variant="secondary">
                {site.paused ? (
                  <>
                    <Play className="size-4" aria-hidden="true" /> Resume
                  </>
                ) : (
                  <>
                    <Pause className="size-4" aria-hidden="true" /> Pause
                  </>
                )}
              </Button>
            </form>
          </div>
        </Card>

        {/* -- how often ------------------------------------------- */}
        <Card>
          <h2 className="text-sm font-bold">How often should we check?</h2>
          <form action={setFrequency} className="mt-3 flex flex-wrap gap-2">
            <input type="hidden" name="siteId" value={site.id} />
            {(["WEEKLY", "DAILY"] as const).map((value) => {
              const locked = value === "DAILY" && !plan.daily;
              return (
                <button
                  key={value}
                  type="submit"
                  name="frequency"
                  value={value}
                  disabled={locked}
                  className={`flex min-h-11 items-center gap-1.5 rounded-lg border px-4 text-sm font-semibold transition-colors ${
                    locked
                      ? "cursor-not-allowed border-line bg-slate-50 text-slate-400"
                      : site.frequency === value
                        ? "cursor-pointer border-brand-600 bg-brand-50 text-brand-700"
                        : "cursor-pointer border-line bg-white text-ink-muted hover:bg-slate-50"
                  }`}
                >
                  {locked && <Lock weight="fill" className="size-3.5" aria-hidden="true" />}
                  {value === "WEEKLY" ? "Weekly" : "Daily"}
                </button>
              );
            })}
          </form>

          {!plan.daily && (
            <p className="mt-3 text-xs text-ink-muted">
              Daily checking is on the paid plans.{" "}
              <Link href="/pricing" className="font-semibold text-brand-700 hover:underline">
                See pricing
              </Link>
            </p>
          )}

          {plan.emailAlerts ? (
            <AlertEmailForm siteId={site.id} current={site.alertEmail} />
          ) : (
            <p className="mt-3 text-xs text-ink-muted">
              Alerts appear below on every plan. Emailing them the moment they
              happen is on{" "}
              <Link href="/pricing" className="font-semibold text-brand-700 hover:underline">
                Pro and Agency
              </Link>
              .
            </p>
          )}
        </Card>

        {/* -- shareable report ------------------------------------ */}
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold">Share this report</h2>
              <p className="mt-1 text-sm text-ink-muted">
                A read-only page you can send to the site&apos;s owner.
              </p>
            </div>

            {plan.shareReports ? (
              <form action={setShareLink} className="flex gap-2">
                <input type="hidden" name="siteId" value={site.id} />
                {site.shareToken ? (
                  <>
                    {/* Re-issuing is how you revoke a link already sent. */}
                    <Button type="submit" name="enabled" value="true" variant="secondary">
                      New link
                    </Button>
                    <Button type="submit" name="enabled" value="false" variant="danger">
                      Turn off
                    </Button>
                  </>
                ) : (
                  <Button type="submit" name="enabled" value="true">
                    Create a link
                  </Button>
                )}
              </form>
            ) : (
              <Link
                href="/pricing"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line bg-slate-50 px-4 text-sm font-semibold text-ink-muted transition-colors hover:bg-slate-100"
              >
                <Lock weight="fill" className="size-3.5" aria-hidden="true" />
                On paid plans
              </Link>
            )}
          </div>

          {site.shareToken && <ShareLink url={`${origin}/r/${site.shareToken}`} />}
        </Card>

        {/* -- score over time -------------------------------------- */}
        {history.length > 1 && (
          <Card>
            <h2 className="text-sm font-bold">Score over time</h2>
            <div className="mt-4">
              <ScoreHistory points={[...history].reverse()} />
            </div>
          </Card>
        )}

        {/* -- what changed ----------------------------------------- */}
        <Card className="p-0 sm:p-0">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
            <h2 className="text-sm font-bold">What changed</h2>
            {unread > 0 && (
              <form action={markAlertsRead}>
                <input type="hidden" name="siteId" value={site.id} />
                <button
                  type="submit"
                  className="min-h-11 cursor-pointer px-2 text-sm font-semibold text-brand-600 hover:underline"
                >
                  Mark all read
                </button>
              </form>
            )}
          </div>

          {feed.length === 0 ? (
            <EmptyState
              icon={<CheckCircle weight="fill" className="size-6" />}
              title="Nothing has changed yet"
            >
              We&apos;ll list every change here
              {plan.emailAlerts ? " — and email you when it matters." : "."}
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {feed.map((alert) => (
                <li
                  key={alert.id}
                  className={`px-5 py-4 sm:px-6 ${alert.readAt ? "" : "bg-brand-50/40"}`}
                >
                  <div className="flex items-start gap-3">
                    <AlertIcon urgency={alert.urgency} />
                    <div className="min-w-0 flex-1">
                      <h3 className="font-bold text-ink">{alert.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                        {alert.detail}
                      </p>
                      {alert.fix && (
                        <p className="mt-2 text-sm font-medium text-brand-700">
                          Fix: {alert.fix}
                        </p>
                      )}
                      <p className="mt-2 text-xs text-ink-muted">
                        <RelativeTime date={alert.createdAt} />
                        {alert.emailedAt && " · emailed"}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* -- danger zone ------------------------------------------ */}
        <form action={removeSite} className="flex justify-end">
          <input type="hidden" name="siteId" value={site.id} />
          <Button type="submit" variant="danger">
            <Trash className="size-4" aria-hidden="true" />
            Stop watching this site
          </Button>
      </form>
    </main>
  );
}

function AlertIcon({ urgency }: { urgency: "urgent" | "normal" | "good_news" }) {
  if (urgency === "good_news") {
    return (
      <CheckCircle weight="fill" className="mt-0.5 size-5 shrink-0 text-good" aria-label="Fixed" />
    );
  }
  if (urgency === "urgent") {
    return (
      <WarningOctagon weight="fill" className="mt-0.5 size-5 shrink-0 text-critical" aria-label="Urgent" />
    );
  }
  return <Warning weight="fill" className="mt-0.5 size-5 shrink-0 text-warning" aria-label="Changed" />;
}
