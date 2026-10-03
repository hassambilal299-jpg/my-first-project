"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Minus } from "@phosphor-icons/react/dist/ssr";
import {
  PLANS,
  PLAN_ORDER,
  RECOMMENDED,
  annualTotal,
  bestAnnualSavingPct,
  type Plan,
} from "@/lib/plans";

type Billing = "monthly" | "annual";

export function PricingTable({
  /** The plan this visitor is already on, if they're signed in. */
  currentPlan,
}: {
  currentPlan?: Plan;
}) {
  const [billing, setBilling] = useState<Billing>("annual");
  const saving = bestAnnualSavingPct();

  return (
    <div>
      <BillingToggle value={billing} onChange={setBilling} savingPct={saving} />

      <div className="mt-10 grid gap-5 lg:grid-cols-3">
        {PLAN_ORDER.map((id) => (
          <PlanCard
            key={id}
            plan={id}
            billing={billing}
            featured={id === RECOMMENDED}
            current={currentPlan === id}
          />
        ))}
      </div>

      <p className="mt-8 text-center text-sm text-ink-muted">
        Prices in US dollars.{" "}
        {billing === "annual"
          ? "Annual plans are charged once for the year."
          : "Monthly plans can be cancelled any time."}{" "}
        No contract, no setup fee.
      </p>
    </div>
  );
}

function BillingToggle({
  value,
  onChange,
  savingPct,
}: {
  value: Billing;
  onChange: (v: Billing) => void;
  savingPct: number;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Billing period"
      className="mx-auto flex w-fit items-center gap-1 rounded-xl border border-line bg-white p-1"
    >
      {(["monthly", "annual"] as const).map((option) => {
        const selected = value === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option)}
            className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors ${
              selected ? "bg-brand-600 text-white" : "text-ink-muted hover:text-ink"
            }`}
          >
            {option === "monthly" ? "Monthly" : "Yearly"}
            {option === "annual" && savingPct > 0 && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                  selected ? "bg-white/20 text-white" : "bg-green-100 text-green-800"
                }`}
              >
                Save {savingPct}%
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function PlanCard({
  plan,
  billing,
  featured,
  current,
}: {
  plan: Plan;
  billing: Billing;
  featured: boolean;
  current: boolean;
}) {
  const spec = PLANS[plan];
  const perMonth = billing === "annual" ? spec.annualMonthly : spec.monthly;
  const free = spec.monthly === 0;

  return (
    <section
      className={`relative flex flex-col rounded-2xl border bg-white p-6 ${
        featured ? "border-brand-600 shadow-lg shadow-brand-600/5 lg:-mt-3 lg:pb-9" : "border-line"
      }`}
    >
      {featured && (
        <span className="absolute -top-3 left-6 rounded-full bg-brand-600 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
          Most popular
        </span>
      )}

      <h3 className="text-lg font-extrabold">{spec.name}</h3>
      {/* Fixed height so a blurb that wraps to two lines doesn't push this
          card's price and button out of line with its neighbours. */}
      <p className="mt-1 min-h-10 text-sm text-ink-muted">{spec.blurb}</p>

      <p className="mt-4 flex items-baseline gap-1.5">
        <span className="text-4xl font-extrabold tabular-nums">${perMonth}</span>
        <span className="text-sm font-medium text-ink-muted">
          {free ? "forever" : "/month"}
        </span>
      </p>

      <p className="mt-1.5 min-h-5 text-xs text-ink-muted">
        {!free &&
          (billing === "annual"
            ? `$${annualTotal(plan)} billed yearly`
            : `or $${spec.annualMonthly}/month billed yearly`)}
      </p>

      {current ? (
        <span className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-slate-50 px-5 text-sm font-semibold text-ink-muted">
          Your current plan
        </span>
      ) : (
        <Link
          href={free ? "/signup" : `/signup?plan=${plan.toLowerCase()}&billing=${billing}`}
          className={`mt-6 inline-flex min-h-11 items-center justify-center rounded-lg px-5 text-sm font-semibold transition-colors ${
            featured
              ? "bg-brand-600 text-white hover:bg-brand-700"
              : "border border-line bg-white text-ink hover:bg-slate-50"
          }`}
        >
          {free ? "Start free" : `Start with ${spec.name}`}
        </Link>
      )}

      <ul className="mt-7 space-y-3 border-t border-line pt-6 text-sm">
        {spec.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5">
            <Check
              weight="bold"
              className="mt-0.5 size-4 shrink-0 text-good"
              aria-hidden="true"
            />
            <span className="text-ink-muted">{feature}</span>
          </li>
        ))}
        {!spec.emailAlerts && (
          <li className="flex items-start gap-2.5">
            <Minus
              weight="bold"
              className="mt-0.5 size-4 shrink-0 text-slate-300"
              aria-hidden="true"
            />
            <span className="text-slate-400">No email alerts</span>
          </li>
        )}
      </ul>
    </section>
  );
}
