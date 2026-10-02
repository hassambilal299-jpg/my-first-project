import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq, isNull, and, count } from "drizzle-orm";
import { Gauge, Plus, Warning } from "@phosphor-icons/react/dist/ssr";
import { db } from "@/lib/db";
import { alerts, sites } from "@/lib/schema";
import { getCurrentUser } from "@/lib/auth";
import { Card, EmptyState, ScorePill } from "@/components/ui";
import { RelativeTime } from "@/components/relative-time";
import { AddSiteForm } from "@/components/add-site-form";
import { limitsFor, sitesRemaining } from "@/lib/plans";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const watched = await db.query.sites.findMany({
    where: eq(sites.userId, user.id),
    orderBy: desc(sites.createdAt),
  });

  // One query for all unread counts rather than one per site.
  const unreadRows = watched.length
    ? await db
        .select({ siteId: alerts.siteId, n: count() })
        .from(alerts)
        .where(isNull(alerts.readAt))
        .groupBy(alerts.siteId)
    : [];
  const unread = new Map(unreadRows.map((r) => [r.siteId, Number(r.n)]));

  const plan = limitsFor(user.plan);
  const remaining = sitesRemaining(user.plan, watched.length);

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        <div>
          <h1 className="text-2xl font-extrabold">Sites you&apos;re watching</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Checked automatically. You only hear from us when something changes.
          </p>
        </div>

        <Card>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-bold">
              <Plus weight="bold" className="size-4 text-brand-600" aria-hidden="true" />
              Watch another site
            </h2>
            <span className="text-xs text-ink-muted tabular-nums">
              {watched.length} of {plan.sites} used
            </span>
          </div>

          {remaining > 0 ? (
            <div className="mt-3">
              <AddSiteForm />
            </div>
          ) : (
            // The form is replaced rather than disabled: a form that silently
            // refuses on submit is worse than one that explains itself first.
            <p className="mt-3 rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-700">
              You&apos;re watching all {plan.sites}{" "}
              {plan.sites === 1 ? "site" : "sites"} the {plan.name} plan
              includes. Remove one, or{" "}
              <Link href="/pricing" className="font-bold underline">
                move up a plan
              </Link>
              .
            </p>
          )}
        </Card>

        {watched.length === 0 ? (
          <Card className="p-0 sm:p-0">
            <EmptyState icon={<Gauge weight="fill" className="size-6" />} title="Nothing watched yet">
              Add a website above. We&apos;ll check it, then tell you whenever
              something breaks.
            </EmptyState>
          </Card>
        ) : (
          <Card className="p-0 sm:p-0">
            <ul className="divide-y divide-line">
              {watched.map((site) => {
                const n = unread.get(site.id) ?? 0;
                return (
                  <li key={site.id}>
                    <Link
                      href={`/dashboard/${site.id}`}
                      className="flex min-h-18 items-center gap-3 px-4 py-4 transition-colors hover:bg-slate-50 sm:px-6"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-bold text-ink">{site.label}</span>
                          <ScorePill score={site.lastScore} />
                          {site.paused && (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-ink-muted">
                              Paused
                            </span>
                          )}
                        </span>
                        <span className="mt-1 block truncate text-sm text-ink-muted">
                          {site.lastCheckedAt ? (
                            <>
                              Checked <RelativeTime date={site.lastCheckedAt} />
                            </>
                          ) : (
                            "Not checked yet"
                          )}
                          {" · "}
                          {site.frequency === "DAILY" ? "Daily" : "Weekly"}
                        </span>
                      </span>

                      {n > 0 && (
                        <span className="flex shrink-0 items-center gap-1 rounded-full bg-critical px-2.5 py-1 text-xs font-bold text-white">
                          <Warning weight="fill" className="size-3" aria-hidden="true" />
                          {n}
                          <span className="sr-only">unread alerts</span>
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
    </main>
  );
}
