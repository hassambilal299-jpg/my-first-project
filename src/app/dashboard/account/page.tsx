import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { count, eq } from "drizzle-orm";
import { ArrowRight, Check, Minus } from "@phosphor-icons/react/dist/ssr";
import { db } from "@/lib/db";
import { sites } from "@/lib/schema";
import { getCurrentUser } from "@/lib/auth";
import { Card } from "@/components/ui";
import { ChangePasswordForm, DeleteAccountForm } from "@/components/account-forms";
import { PLANS, annualTotal, asPlan, limitsFor, sitesRemaining } from "@/lib/plans";

export const metadata: Metadata = { title: "Your account" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [{ n }] = await db
    .select({ n: count() })
    .from(sites)
    .where(eq(sites.userId, user.id));

  const used = Number(n);
  const plan = asPlan(user.plan);
  const spec = limitsFor(plan);
  const remaining = sitesRemaining(plan, used);
  const pct = Math.min(100, Math.round((used / spec.sites) * 100));

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-extrabold">Your account</h1>
        <p className="mt-1 text-sm text-ink-muted">{user.email}</p>
      </div>

      {/* -- plan and usage -------------------------------------- */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-bold">Your plan</h2>
            <p className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-extrabold">{spec.name}</span>
              <span className="text-sm text-ink-muted">
                {spec.monthly === 0
                  ? "free"
                  : `$${spec.monthly}/month, or $${annualTotal(plan)} yearly`}
              </span>
            </p>
            {user.planRenewsAt && (
              <p className="mt-1 text-xs text-ink-muted">
                Renews {user.planRenewsAt.toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </p>
            )}
          </div>

          {plan !== "AGENCY" && (
            <Link
              href="/pricing"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
            >
              See plans
              <ArrowRight weight="bold" className="size-4" aria-hidden="true" />
            </Link>
          )}
        </div>

        <div className="mt-6">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-semibold">Sites watched</span>
            <span className="tabular-nums text-ink-muted">
              {used} of {spec.sites}
            </span>
          </div>
          {/* A plain div rather than <progress>, which is near-impossible to
              style consistently across browsers. */}
          <div
            role="img"
            aria-label={`${used} of ${spec.sites} sites used`}
            className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"
          >
            <div
              className={`h-full rounded-full transition-all ${
                pct >= 100 ? "bg-critical" : pct >= 80 ? "bg-warning" : "bg-brand-600"
              }`}
              style={{ width: `${Math.max(pct, used > 0 ? 6 : 0)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            {remaining > 0
              ? `Room for ${remaining} more.`
              : `You're at the limit for the ${spec.name} plan.`}
          </p>
        </div>

        <ul className="mt-6 grid gap-2.5 border-t border-line pt-5 sm:grid-cols-2">
          <Entitlement on>{`Up to ${spec.sites} ${spec.sites === 1 ? "site" : "sites"}`}</Entitlement>
          <Entitlement on={spec.daily}>
            {spec.daily ? "Checked daily" : "Checked weekly"}
          </Entitlement>
          <Entitlement on={spec.emailAlerts}>Email alerts</Entitlement>
          <Entitlement on={spec.shareReports}>Shareable report links</Entitlement>
        </ul>

        {plan === "FREE" && (
          <p className="mt-5 rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-700">
            On {PLANS.PRO.name} you&apos;d get {PLANS.PRO.sites} sites, daily
            checks and an email the moment something breaks — rather than having
            to come here and look.
          </p>
        )}
      </Card>

      {/* -- password -------------------------------------------- */}
      <Card>
        <h2 className="text-sm font-bold">Password</h2>
        <ChangePasswordForm />
      </Card>

      {/* -- danger zone ----------------------------------------- */}
      <Card className="border-red-200">
        <h2 className="text-sm font-bold text-critical">Close your account</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Removes everything. Nothing is kept and nothing can be restored.
        </p>
        <DeleteAccountForm email={user.email} />
      </Card>
    </main>
  );
}

function Entitlement({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      {on ? (
        <Check weight="bold" className="mt-0.5 size-4 shrink-0 text-good" aria-hidden="true" />
      ) : (
        <Minus weight="bold" className="mt-0.5 size-4 shrink-0 text-slate-300" aria-hidden="true" />
      )}
      <span className={on ? "text-ink-muted" : "text-slate-400"}>{children}</span>
    </li>
  );
}
