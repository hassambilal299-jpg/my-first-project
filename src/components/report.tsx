import Link from "next/link";
import { Bell, CheckCircle, Warning, WarningOctagon, Wrench } from "@phosphor-icons/react/dist/ssr";
import type { AuditResult } from "@/lib/audit";
import type { Finding, Severity } from "@/lib/checks";

const CATEGORY_ORDER: Finding["category"][] = [
  "Getting customers",
  "Speed",
  "Mobile",
  "Trust",
  "Google",
];

export function Report({
  result,
  /**
   * The "watch this site" panel. On by default, because on the home page the
   * report IS the pitch. Switched off on a report shared with a client, where
   * a signup prompt for our product would be out of place.
   */
  showWatchPrompt = true,
}: {
  result: AuditResult;
  showWatchPrompt?: boolean;
}) {
  const problems = result.findings.filter((f) => f.severity !== "pass");
  const passes = result.findings.filter((f) => f.severity === "pass");
  const critical = problems.filter((f) => f.severity === "critical").length;

  return (
    <article className="space-y-6">
      <ScoreCard result={result} criticalCount={critical} problemCount={problems.length} />

      {CATEGORY_ORDER.map((category) => {
        const items = problems.filter((f) => f.category === category);
        if (items.length === 0) return null;
        return (
          <section key={category} className="rounded-xl border border-line bg-white p-5 sm:p-6">
            <h3 className="text-sm font-bold uppercase tracking-wide text-ink-muted">
              {category}
            </h3>
            <ul className="mt-4 space-y-5">
              {items.map((f) => (
                <FindingRow key={f.id} finding={f} />
              ))}
            </ul>
          </section>
        );
      })}

      {showWatchPrompt && (
      <section className="rounded-xl border border-brand-100 bg-brand-50 p-5 text-center sm:p-6">
        <h3 className="text-base font-bold text-ink">Want to know when this changes?</h3>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-muted">
          We&apos;ll re-check this site automatically and email you the day
          something breaks — the site going down, SSL expiring, speed getting
          worse.
        </p>
        <Link
          href={`/signup?watch=${encodeURIComponent(result.url)}`}
          className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
        >
          <Bell weight="fill" className="size-4" aria-hidden="true" />
          Watch this site
        </Link>
      </section>
      )}

      {passes.length > 0 && (
        <section className="rounded-xl border border-line bg-white p-5 sm:p-6">
          <h3 className="text-sm font-bold uppercase tracking-wide text-ink-muted">
            Working fine ({passes.length})
          </h3>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {passes.map((f) => (
              <li key={f.id} className="flex items-start gap-2 text-sm text-ink-muted">
                <CheckCircle
                  weight="fill"
                  className="mt-0.5 size-4 shrink-0 text-good"
                  aria-hidden="true"
                />
                {f.title}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

function ScoreCard({
  result,
  criticalCount,
  problemCount,
}: {
  result: AuditResult;
  criticalCount: number;
  problemCount: number;
}) {
  const { score, grade } = result;
  const tone =
    score >= 80
      ? { ring: "text-good", bg: "bg-green-50" }
      : score >= 55
        ? { ring: "text-warning", bg: "bg-amber-50" }
        : { ring: "text-critical", bg: "bg-red-50" };

  // A ring drawn with stroke-dasharray. r=52 gives a circumference of ~327.
  const circumference = 2 * Math.PI * 52;
  const filled = (score / 100) * circumference;

  return (
    <section className={`rounded-xl border border-line p-6 ${tone.bg}`}>
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
        <div className="relative shrink-0">
          <svg width="128" height="128" viewBox="0 0 128 128" role="img"
               aria-label={`Score ${score} out of 100, grade ${grade}`}>
            <circle cx="64" cy="64" r="52" fill="none" stroke="currentColor"
                    strokeWidth="10" className="text-black/10" />
            {/* At a score of 0 a rounded cap still paints a dot, which
                looks like a rendering glitch. Draw nothing instead. */}
            {score > 0 && (
              <circle
                cx="64" cy="64" r="52" fill="none" stroke="currentColor" strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={`${filled} ${circumference}`}
                transform="rotate(-90 64 64)"
                className={tone.ring}
              />
            )}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-extrabold tabular-nums">{score}</span>
            <span className="text-xs font-semibold text-ink-muted">Grade {grade}</span>
          </div>
        </div>

        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="truncate text-sm text-ink-muted">{result.finalUrl}</p>
          <h2 className="mt-1 text-xl font-bold">
            {problemCount === 0
              ? "No problems found"
              : `${problemCount} problem${problemCount === 1 ? "" : "s"} found`}
          </h2>
          {criticalCount > 0 && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-critical px-3 py-1 text-sm font-semibold text-white">
              <WarningOctagon weight="fill" className="size-4" aria-hidden="true" />
              {criticalCount} costing customers right now
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  return (
    <li>
      <div className="flex items-start gap-3">
        <SeverityIcon severity={finding.severity} />
        <div className="min-w-0">
          <h4 className="font-bold text-ink">{finding.title}</h4>
          <p className="mt-1 text-sm leading-relaxed text-ink-muted">{finding.detail}</p>
          {finding.fix && (
            <p className="mt-2 flex items-start gap-1.5 text-sm font-medium text-brand-700">
              <Wrench weight="fill" className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {finding.fix}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

function SeverityIcon({ severity }: { severity: Severity }) {
  if (severity === "critical") {
    return (
      <span className="mt-0.5 shrink-0" title="Critical">
        <WarningOctagon weight="fill" className="size-5 text-critical" aria-hidden="true" />
        <span className="sr-only">Critical:</span>
      </span>
    );
  }
  return (
    <span className="mt-0.5 shrink-0" title="Warning">
      <Warning weight="fill" className="size-5 text-warning" aria-hidden="true" />
      <span className="sr-only">Warning:</span>
    </span>
  );
}
