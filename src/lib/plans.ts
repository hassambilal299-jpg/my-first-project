/**
 * Plans, prices and limits.
 *
 * Deliberately pure data plus pure functions: no database, no network, no
 * environment. Every limit the product enforces is decided here, so the
 * pricing page and the server actions can never disagree about what a plan
 * includes — a class of bug that quietly loses money.
 *
 * Prices are in US dollars. Annual billing is charged once for ten months'
 * worth, which is the convention customers already recognise.
 */

export type Plan = "FREE" | "PRO" | "AGENCY";

export type PlanSpec = {
  id: Plan;
  name: string;
  /** Price per month when billed monthly. */
  monthly: number;
  /** Price per month when billed annually (charged yearly, see annualTotal). */
  annualMonthly: number;
  /** How many sites this plan may watch at once. */
  sites: number;
  /** Whether daily checking may be selected. Free is weekly only. */
  daily: boolean;
  /** Whether alerts are emailed as well as shown in the dashboard. */
  emailAlerts: boolean;
  /** Whether reports can be shared on a public link. */
  shareReports: boolean;
  /** One line under the plan name. */
  blurb: string;
  /** Bullets, in the order they should be read. */
  features: string[];
};

export const PLANS: Record<Plan, PlanSpec> = {
  FREE: {
    id: "FREE",
    name: "Free",
    monthly: 0,
    annualMonthly: 0,
    sites: 1,
    daily: false,
    emailAlerts: false,
    shareReports: false,
    blurb: "Watch your own site. No card needed.",
    features: [
      "1 website",
      "Checked every week",
      "The full report, every check",
      "Alerts in your dashboard",
      "Unlimited one-off audits",
    ],
  },
  PRO: {
    id: "PRO",
    name: "Pro",
    monthly: 19,
    annualMonthly: 15,
    sites: 10,
    daily: true,
    emailAlerts: true,
    shareReports: true,
    blurb: "For a freelancer or a small agency.",
    features: [
      "10 websites",
      "Checked every day",
      "Emailed the moment something breaks",
      "Shareable report links for clients",
      "Full history and score trend",
    ],
  },
  AGENCY: {
    id: "AGENCY",
    name: "Agency",
    monthly: 49,
    annualMonthly: 39,
    sites: 50,
    daily: true,
    emailAlerts: true,
    shareReports: true,
    blurb: "For a shop looking after a book of clients.",
    features: [
      "50 websites",
      "Checked every day",
      "Alerts to any address per site",
      "Shareable report links for clients",
      "Priority email support",
    ],
  },
};

/** In display order. */
export const PLAN_ORDER: Plan[] = ["FREE", "PRO", "AGENCY"];

/** The plan most people should pick, highlighted on the pricing page. */
export const RECOMMENDED: Plan = "PRO";

/* ------------------------------------------------------------------ */
/* Prices                                                              */
/* ------------------------------------------------------------------ */

/** What an annual subscription is charged, once. */
export function annualTotal(plan: Plan): number {
  return PLANS[plan].annualMonthly * 12;
}

/** Whole-percent saving from paying yearly. 0 for the free plan. */
export function annualSavingPct(plan: Plan): number {
  const { monthly, annualMonthly } = PLANS[plan];
  if (monthly === 0) return 0;
  return Math.round(((monthly - annualMonthly) / monthly) * 100);
}

/** The largest saving on offer — the number worth putting on the toggle. */
export function bestAnnualSavingPct(): number {
  return Math.max(...PLAN_ORDER.map(annualSavingPct));
}

/* ------------------------------------------------------------------ */
/* Limits                                                              */
/* ------------------------------------------------------------------ */

/**
 * Tolerates anything — a plan string read straight out of the database, an
 * old value, null — and falls back to FREE. A row with a plan we no longer
 * recognise must not crash a dashboard; it should just be treated as the
 * least generous thing it could be.
 */
export function asPlan(value: unknown): Plan {
  return value === "PRO" || value === "AGENCY" || value === "FREE" ? value : "FREE";
}

export function limitsFor(value: unknown): PlanSpec {
  return PLANS[asPlan(value)];
}

export function canAddSite(value: unknown, currentCount: number): boolean {
  return currentCount < limitsFor(value).sites;
}

/** How many more sites this plan allows. Never negative. */
export function sitesRemaining(value: unknown, currentCount: number): number {
  return Math.max(0, limitsFor(value).sites - currentCount);
}

/**
 * The message shown when someone is at their limit. Returns null when there
 * is room, so a caller can write `const err = addSiteError(...); if (err) ...`.
 */
export function addSiteError(value: unknown, currentCount: number): string | null {
  const plan = limitsFor(value);
  if (currentCount < plan.sites) return null;

  if (plan.id === "AGENCY") {
    return `The Agency plan watches ${plan.sites} sites. Email us and we'll raise it.`;
  }
  const next = plan.id === "FREE" ? PLANS.PRO : PLANS.AGENCY;
  return `The ${plan.name} plan watches ${plan.sites} ${
    plan.sites === 1 ? "site" : "sites"
  }. ${next.name} watches ${next.sites}.`;
}

/**
 * Clamps a requested frequency to what the plan allows, rather than
 * rejecting it. Someone downgrading from Pro has daily sites already; they
 * should quietly fall back to weekly, not break.
 */
export function allowedFrequency(
  value: unknown,
  requested: "DAILY" | "WEEKLY",
): "DAILY" | "WEEKLY" {
  if (requested === "DAILY" && !limitsFor(value).daily) return "WEEKLY";
  return requested;
}

export function canEmailAlerts(value: unknown): boolean {
  return limitsFor(value).emailAlerts;
}

export function canShareReports(value: unknown): boolean {
  return limitsFor(value).shareReports;
}
