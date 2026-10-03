import { CaretDown } from "@phosphor-icons/react/dist/ssr";
import { CHECK_COUNT } from "@/lib/checks";

export type QA = { q: string; a: string };

/**
 * Built on <details>, so it works without JavaScript, is keyboard operable
 * for free, and the browser's own find-in-page can reach the answers.
 */
export function Faq({ items, className = "" }: { items: QA[]; className?: string }) {
  return (
    <div className={`divide-y divide-line overflow-hidden rounded-xl border border-line bg-white ${className}`}>
      {items.map(({ q, a }) => (
        <details key={q} className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-left font-bold text-ink hover:bg-slate-50 sm:px-6">
            {q}
            <CaretDown
              weight="bold"
              className="size-4 shrink-0 text-ink-muted transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <p className="px-5 pb-5 text-sm leading-relaxed text-ink-muted sm:px-6">{a}</p>
        </details>
      ))}
    </div>
  );
}

/** Shared between the home page and the pricing page. */
export const GENERAL_FAQ: QA[] = [
  {
    q: "What exactly do you check?",
    a: `${CHECK_COUNT} things, in five groups: whether the site loads at all and how fast, whether it works on a phone, whether its SSL certificate is valid and how long before it expires, whether Google has what it needs to list it properly, and whether a visitor can actually contact the business — a tappable phone number, a contact form, an email address. Every result says what it costs in plain English and what fixes it.`,
  },
  {
    q: "How is this different from Google PageSpeed?",
    a: "PageSpeed grades one page once, in developer language, and tells you nothing tomorrow. Sitegrade watches the site on a schedule and emails you the day something changes — the certificate expires, the site goes down, the contact form disappears in a redesign. The report is also written for the business owner, not for an engineer.",
  },
  {
    q: "Do I need to install anything on the website?",
    a: "No. There is no script, no plugin, no access to the hosting account. Sitegrade loads the public page exactly as a visitor's browser would, which is why you can check a site you don't own.",
  },
  {
    q: "Can I check a client's site before I've signed them?",
    a: "Yes, and that's what a lot of people use it for. The free audit on the home page needs no account, and the report is written so you can send it to the business as-is.",
  },
  {
    q: "How often do the automatic checks run?",
    a: "Weekly on the free plan, daily on Pro and Agency. You can also hit \"Check now\" on any site whenever you want.",
  },
  {
    q: "Will you email me every week even when nothing is wrong?",
    a: "No. Email only goes out when something actually changed for the worse — a new problem, an existing problem getting worse, the score dropping sharply, or the site going down. A quiet inbox means the site is fine.",
  },
  {
    q: "Does the free plan email me too?",
    a: "No — email alerts are the main thing you're paying for on Pro and Agency. On the free plan every alert still appears in your dashboard, with the same detail; you just have to come and look rather than being told.",
  },
];

export const PRICING_FAQ: QA[] = [
  {
    q: "Is the free plan really free?",
    a: "Yes, and it does not ask for a card. One site, checked weekly, with the full report and every alert visible in your dashboard. It stays free indefinitely.",
  },
  {
    q: "What happens if I go over my site limit?",
    a: "Nothing breaks. The sites you already watch keep being checked; you just can't add another until you remove one or move up a plan.",
  },
  {
    q: "Can I cancel whenever I want?",
    a: "Yes. Monthly plans stop at the end of the month you've paid for, and nothing auto-escalates. Your sites and history drop back to free-plan limits rather than being deleted.",
  },
  {
    q: "What do I lose if I downgrade?",
    a: "Daily checking becomes weekly, email alerts stop (the alerts themselves still appear in your dashboard), and shared report links are switched off. Nothing is deleted.",
  },
  {
    q: "Do you offer a plan for more than 50 sites?",
    a: "Yes — email support@sitegrade.app with roughly how many and we'll quote it.",
  },
];
