import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { MarketingHeader, SiteFooter } from "@/components/site-chrome";
import { PricingTable } from "@/components/pricing-table";
import { Faq, PRICING_FAQ } from "@/components/faq";
import { CHECK_COUNT } from "@/lib/checks";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "One site free forever, no card. Pro is $19/month for 10 sites with daily checks and email alerts. Agency watches 50.",
};

/**
 * Static, for the same reason as the home page: it is a page we want indexed
 * and served instantly. Which plan the visitor is already on is shown on the
 * account page, next to their actual usage, where it is more use anyway.
 */
export default function PricingPage() {
  return (
    <div className="min-h-dvh">
      <MarketingHeader />

      <main className="px-4 pt-14 pb-10 sm:pt-20">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-4xl font-extrabold leading-tight text-balance sm:text-5xl">
            Pay for the watching, not the report
          </h1>
          <p className="mx-auto mt-5 text-lg leading-relaxed text-ink-muted">
            The {CHECK_COUNT}-point audit is free and always will be — run it on
            anything, as often as you like. What you pay for is Sitegrade
            checking a site every day and telling you the moment it breaks.
          </p>
        </div>

        <div className="mx-auto mt-12 max-w-5xl">
          <PricingTable />
        </div>

        {/* Honest about how payment works today. A fake checkout that
            silently fails would be far worse than one plain sentence. */}
        <div className="mx-auto mt-14 max-w-2xl rounded-xl border border-line bg-white p-6 text-center">
          <h2 className="font-bold">How to start a paid plan right now</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            Card checkout is being set up. In the meantime, create your free
            account and email{" "}
            <a
              href="mailto:support@sitegrade.app?subject=Upgrade%20to%20a%20paid%20plan"
              className="font-semibold text-brand-700 hover:underline"
            >
              support@sitegrade.app
            </a>{" "}
            with the plan you want — we&apos;ll send an invoice and switch your
            account over the same day. You will not be charged before you&apos;ve
            seen it working on your own sites.
          </p>
        </div>

        <div className="mx-auto mt-20 max-w-3xl">
          <h2 className="text-center text-2xl font-extrabold sm:text-3xl">
            Questions about billing
          </h2>
          <Faq items={PRICING_FAQ} className="mt-8" />
        </div>

        <div className="mx-auto mt-16 max-w-3xl rounded-2xl border border-brand-100 bg-brand-50 px-6 py-12 text-center">
          <h2 className="text-2xl font-extrabold text-balance">
            Try it on one site before you decide
          </h2>
          <p className="mx-auto mt-3 max-w-md text-ink-muted">
            The free plan isn&apos;t a trial that expires. Watch one site for as
            long as you like and upgrade only when you want more.
          </p>
          <Link
            href="/signup"
            className="mt-7 inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-brand-600 px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
          >
            Start free
            <ArrowRight weight="bold" className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
