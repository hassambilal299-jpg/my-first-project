import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  BellRinging,
  Check,
  ClockCounterClockwise,
  Envelope,
  Lightning,
  LockKey,
  PaperPlaneTilt,
  Plugs,
  ShieldWarning,
  TrendDown,
  X,
} from "@phosphor-icons/react/dist/ssr";
import { AuditForm } from "@/components/audit-form";
import { MarketingHeader, SiteFooter } from "@/components/site-chrome";
import { Faq, GENERAL_FAQ } from "@/components/faq";
import { CHECK_COUNT, CHECK_REGISTRY } from "@/lib/checks";
import { PLANS, annualSavingPct } from "@/lib/plans";

export const metadata: Metadata = {
  // `absolute` so the root layout's "%s — Sitegrade" template doesn't append
  // a second "— Sitegrade" to a title that already ends in it.
  title: { absolute: "Sitegrade — know the day a website breaks" },
  description: `Run a free ${CHECK_COUNT}-point check on any website in seconds, then let Sitegrade watch it and email you the day something breaks.`,
};

/**
 * Deliberately a static page: it reads no cookies and touches no database,
 * so it is prerendered once and served from the edge.
 *
 * An earlier version read the session here to show "Dashboard" instead of
 * "Log in" in the header. That one nav link turned the busiest, most
 * SEO-sensitive page in the product into a per-request server render. The
 * signed-in case is handled instead by /login and /signup redirecting
 * straight to the dashboard, which gets a returning visitor to the same
 * place in one hop.
 */
/**
 * The free audit runs as a server action from this page, and an audit can
 * take the full 20-second fetch timeout. Route segment config applies to the
 * actions a page invokes, so the limit belongs here rather than in the
 * "use server" file, which may only export async functions.
 */
export const maxDuration = 60;

export default function HomePage() {
  return (
    <div className="min-h-dvh">
      <MarketingHeader />

      {/* ---------------- hero ---------------- */}
      <section className="px-4 pt-14 pb-4 sm:pt-20">
        <div className="mx-auto max-w-3xl text-center">
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1 text-xs font-semibold text-ink-muted">
            <Lightning weight="fill" className="size-3.5 text-brand-600" aria-hidden="true" />
            No account needed · {CHECK_COUNT} checks · about 15 seconds
          </p>

          <h1 className="mt-6 text-4xl font-extrabold leading-[1.1] text-balance sm:text-6xl">
            Know the day a website breaks
          </h1>

          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-ink-muted">
            Check any site free, right now, and get a plain-English list of
            everything costing that business customers. Then let Sitegrade keep
            watching it and email you the moment something changes.
          </p>
        </div>

        <div className="mx-auto mt-10 max-w-3xl">
          <AuditForm />
        </div>
      </section>

      {/* ---------------- what we check ---------------- */}
      <section className="px-4 py-20">
        <div className="mx-auto max-w-5xl">
          <SectionHeading
            eyebrow="The report"
            title={`${CHECK_COUNT} checks, written for the business owner`}
            lead="Not a developer audit. Every problem says what it costs in money or customers, and exactly what fixes it — so you can forward the report untouched."
          />

          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {(Object.keys(CHECK_REGISTRY) as (keyof typeof CHECK_REGISTRY)[]).map(
              (category) => (
                <div
                  key={category}
                  className="rounded-xl border border-line bg-white p-5"
                >
                  <h3 className="flex items-baseline justify-between gap-2 font-bold">
                    {category}
                    <span className="text-xs font-semibold text-ink-muted tabular-nums">
                      {CHECK_REGISTRY[category].length}
                    </span>
                  </h3>
                  <ul className="mt-3 space-y-2">
                    {CHECK_REGISTRY[category].map((item) => (
                      <li key={item} className="flex items-start gap-2 text-sm text-ink-muted">
                        <Check
                          weight="bold"
                          className="mt-1 size-3.5 shrink-0 text-good"
                          aria-hidden="true"
                        />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ),
            )}
          </div>
        </div>
      </section>

      {/* ---------------- monitoring ---------------- */}
      <section className="bg-white px-4 py-20">
        <div className="mx-auto max-w-5xl">
          <SectionHeading
            eyebrow="The part worth paying for"
            title="A one-off audit goes stale in a week"
            lead="Websites break quietly. A certificate expires, a plugin update eats the contact form, a new image makes the homepage take nine seconds. Nobody notices until the calls stop. Sitegrade re-checks on a schedule and compares every result against the last one."
          />

          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            <Pillar
              icon={<ClockCounterClockwise weight="fill" className="size-5" />}
              title="Checked on a schedule"
              body="Every day on a paid plan, every week on free. You do nothing after adding the site."
            />
            <Pillar
              icon={<TrendDown weight="fill" className="size-5" />}
              title="Compared, not repeated"
              body="We only tell you what's different since last time — a new problem, one getting worse, or the score falling off a cliff."
            />
            <Pillar
              icon={<Envelope weight="fill" className="size-5" />}
              title="A quiet inbox means fine"
              body="No weekly digest to ignore. Email arrives when something actually went wrong, and never for good news alone."
            />
          </div>

          {/* Illustrative examples of the alerts the engine produces. Labelled
              as examples, because they are not from a real customer's site. */}
          <div className="mt-14">
            <h3 className="text-center text-sm font-bold uppercase tracking-wide text-ink-muted">
              Example alerts
            </h3>
            <ul className="mx-auto mt-5 max-w-2xl space-y-3">
              <AlertExample
                icon={<ShieldWarning weight="fill" className="size-5 text-critical" />}
                tone="critical"
                title="mikesplumbing.com is down"
                detail="The site returned a 503 error. Visitors see a blank page and Google will start dropping it from results."
              />
              <AlertExample
                icon={<X weight="bold" className="size-5 text-critical" />}
                tone="critical"
                title="The contact form has disappeared"
                detail="Last week this page had a form and a tappable phone number. Today it has neither — anyone who wants a quote has no way to ask."
              />
              <AlertExample
                icon={<LockKey weight="fill" className="size-5 text-warning" />}
                tone="warning"
                title="The SSL certificate expires in 9 days"
                detail="When it lapses, every browser shows a full-page security warning instead of the site."
              />
            </ul>
          </div>
        </div>
      </section>

      {/* ---------------- how it works ---------------- */}
      <section className="px-4 py-20">
        <div className="mx-auto max-w-3xl">
          <SectionHeading
            eyebrow="How it works"
            title="Three steps, no install"
            lead="There is no script to add, no plugin, and no access to anyone's hosting account. Sitegrade loads the public page exactly as a visitor's browser would — which is why you can check a site you don't own yet."
          />

          <ol className="mt-12 space-y-4">
            <Step
              n={1}
              icon={<Plugs weight="fill" className="size-5" />}
              title="Paste an address"
              body="Yours, a client's, or a business you'd like to work with. The report comes back in about fifteen seconds."
            />
            <Step
              n={2}
              icon={<BellRinging weight="fill" className="size-5" />}
              title="Add it to your watch list"
              body="One click from the report. From then on it's checked automatically and compared against its own history."
            />
            <Step
              n={3}
              icon={<PaperPlaneTilt weight="fill" className="size-5" />}
              title="Forward the proof"
              body="Share a live report link with the owner, or paste the findings into a quote. The language is already theirs, not ours."
            />
          </ol>
        </div>
      </section>

      {/* ---------------- vs pagespeed ---------------- */}
      <section className="bg-white px-4 py-20">
        <div className="mx-auto max-w-3xl">
          <SectionHeading
            eyebrow="Honest comparison"
            title="You could just run PageSpeed"
            lead="It's free and it's good at what it does. Here's the actual difference, so you can decide before paying anything."
          />

          <div className="mt-10 overflow-hidden rounded-xl border border-line">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">
                Sitegrade compared with Google PageSpeed Insights
              </caption>
              <thead>
                <tr className="border-b border-line bg-slate-50">
                  <th scope="col" className="px-4 py-3 font-bold sm:px-5" />
                  <th scope="col" className="px-4 py-3 font-bold sm:px-5">
                    PageSpeed
                  </th>
                  <th scope="col" className="px-4 py-3 font-bold text-brand-700 sm:px-5">
                    Sitegrade
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-white">
                <CompareRow label="Written for" them="Developers" us="Business owners" />
                <CompareRow label="Runs" them="When you remember" us="Every day, by itself" />
                <CompareRow label="Tells you what changed" them="No" us="Yes, versus last check" />
                <CompareRow label="Emails you when it breaks" them="No" us="Yes" />
                <CompareRow
                  label="Checks contact details"
                  them="No"
                  us="Phone, form, email"
                />
                <CompareRow label="Shareable with a client" them="Raw metrics" us="A finished report" />
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ---------------- pricing teaser ---------------- */}
      <section className="px-4 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <SectionHeading
            eyebrow="Pricing"
            title="Start free. Pay when it's watching money."
            lead={`One site free forever, no card. ${PLANS.PRO.name} is $${PLANS.PRO.monthly} a month for ${PLANS.PRO.sites} sites, daily checks and email alerts — about ${annualSavingPct("PRO")}% less if you pay yearly.`}
          />

          <Link
            href="/pricing"
            className="mt-8 inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-brand-600 px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
          >
            See all three plans
            <ArrowRight weight="bold" className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </section>

      {/* ---------------- faq ---------------- */}
      <section className="px-4 pb-20">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center text-2xl font-extrabold sm:text-3xl">
            Questions people ask first
          </h2>
          <Faq items={GENERAL_FAQ} className="mt-8" />
        </div>
      </section>

      {/* ---------------- final cta ---------------- */}
      <section className="px-4 pb-4">
        <div className="mx-auto max-w-3xl rounded-2xl border border-brand-100 bg-brand-50 px-6 py-12 text-center">
          <h2 className="text-2xl font-extrabold text-balance sm:text-3xl">
            Check a website before you read any further
          </h2>
          <p className="mx-auto mt-3 max-w-md text-ink-muted">
            It takes fifteen seconds and costs nothing. Scroll back up, or make
            an account and start watching one.
          </p>
          <Link
            href="/signup"
            className="mt-7 inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-brand-600 px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
          >
            Create a free account
            <ArrowRight weight="bold" className="size-4" aria-hidden="true" />
          </Link>
          <p className="mt-3 text-xs text-ink-muted">
            No card. One site, watched weekly, free for as long as you want it.
          </p>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SectionHeading({
  eyebrow,
  title,
  lead,
}: {
  eyebrow: string;
  title: string;
  lead: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-xs font-bold uppercase tracking-widest text-brand-600">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-2xl font-extrabold text-balance sm:text-4xl">{title}</h2>
      <p className="mt-4 leading-relaxed text-ink-muted">{lead}</p>
    </div>
  );
}

function Pillar({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-line p-5">
      <div
        aria-hidden="true"
        className="flex size-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600"
      >
        {icon}
      </div>
      <h3 className="mt-3 font-bold">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{body}</p>
    </div>
  );
}

function Step({
  n,
  icon,
  title,
  body,
}: {
  n: number;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <li className="flex items-start gap-4 rounded-xl border border-line bg-white p-5">
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white"
      >
        {icon}
      </span>
      <div className="min-w-0">
        <h3 className="font-bold">
          <span className="text-ink-muted tabular-nums">{n}.</span> {title}
        </h3>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{body}</p>
      </div>
    </li>
  );
}

function AlertExample({
  icon,
  tone,
  title,
  detail,
}: {
  icon: React.ReactNode;
  tone: "critical" | "warning";
  title: string;
  detail: string;
}) {
  return (
    <li
      className={`flex items-start gap-3 rounded-xl border p-4 ${
        tone === "critical" ? "border-red-200 bg-red-50/50" : "border-amber-200 bg-amber-50/50"
      }`}
    >
      <span aria-hidden="true" className="mt-0.5 shrink-0">
        {icon}
      </span>
      <div className="min-w-0">
        <h4 className="font-bold text-ink">{title}</h4>
        <p className="mt-1 text-sm leading-relaxed text-ink-muted">{detail}</p>
      </div>
    </li>
  );
}

function CompareRow({ label, them, us }: { label: string; them: string; us: string }) {
  return (
    <tr>
      <th scope="row" className="px-4 py-3 font-semibold text-ink sm:px-5">
        {label}
      </th>
      <td className="px-4 py-3 text-ink-muted sm:px-5">{them}</td>
      <td className="px-4 py-3 font-semibold text-ink sm:px-5">{us}</td>
    </tr>
  );
}
