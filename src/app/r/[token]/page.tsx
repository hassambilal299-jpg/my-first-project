import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { db } from "@/lib/db";
import { checks, sites, users } from "@/lib/schema";
import { canShareReports } from "@/lib/plans";
import { Report } from "@/components/report";
import { Wordmark } from "@/components/site-chrome";
import { RelativeTime } from "@/components/relative-time";
import type { AuditResult } from "@/lib/audit";

/**
 * A report on a public, unguessable link — what you send a client.
 *
 * Deliberately not indexable: the token is a secret, and a search engine
 * crawling one of these would publish a named business's weaknesses. Nothing
 * here reveals who owns the account or what else they monitor.
 */
export const metadata: Metadata = {
  title: "Website report",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function SharedReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!token) notFound();

  const [row] = await db
    .select({ site: sites, plan: users.plan })
    .from(sites)
    .innerJoin(users, eq(sites.userId, users.id))
    .where(eq(sites.shareToken, token))
    .limit(1);

  // A revoked link and a link that never existed look identical, which is
  // what you want — neither confirms that a token was once valid.
  if (!row) notFound();

  // Sharing is a paid feature, so the link has to stop working when the
  // owner stops paying. Checked here rather than only at the moment the link
  // is created, because a downgrade doesn't come back through that code —
  // which is exactly how every link a lapsed customer had ever sent stayed
  // live for ever.
  if (!canShareReports(row.plan)) notFound();

  const site = row.site;

  const latest = await db.query.checks.findFirst({
    where: eq(checks.siteId, site.id),
    orderBy: desc(checks.createdAt),
  });
  if (!latest) notFound();

  const result: AuditResult = {
    url: site.url,
    finalUrl: site.url,
    score: latest.score,
    grade: latest.grade,
    findings: latest.findings,
    loadMs: latest.loadMs,
    auditedAt: latest.createdAt,
  };

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
          <Wordmark />
          <span className="text-xs font-semibold text-ink-muted">Shared report</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold sm:text-3xl">{site.label}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Checked <RelativeTime date={latest.createdAt} /> ·{" "}
            <a
              href={site.url}
              target="_blank"
              rel="noreferrer noopener nofollow"
              className="hover:underline"
            >
              {site.url}
            </a>
          </p>
        </div>

        <Report result={result} showWatchPrompt={false} />

        <div className="mt-10 rounded-xl border border-line bg-white p-6 text-center">
          <p className="text-sm leading-relaxed text-ink-muted">
            This report was produced by Sitegrade, which re-checks this website
            automatically and flags anything that changes.
          </p>
          <Link
            href="/"
            className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line bg-white px-5 text-sm font-semibold transition-colors hover:bg-slate-50"
          >
            Check another website free
            <ArrowRight weight="bold" className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </main>
    </div>
  );
}
