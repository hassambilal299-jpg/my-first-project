import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { MarketingHeader, SiteFooter } from "@/components/site-chrome";

export const metadata: Metadata = {
  title: "Account deleted",
  robots: { index: false, follow: false },
};

/** Where deleteAccount lands, so the deletion is visibly confirmed. */
export default function GoodbyePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <MarketingHeader />

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-20 text-center">
        <CheckCircle
          weight="fill"
          className="mx-auto size-12 text-good"
          aria-hidden="true"
        />
        <h1 className="mt-5 text-2xl font-extrabold">Your account is deleted</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          Everything went with it — the sites you were watching, their check
          history, and every alert. Nothing of yours is kept.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          The free audit still works without an account, and you&apos;re welcome
          back any time.
        </p>

        <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
          >
            Check a website
          </Link>
          <Link
            href="/signup"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-5 text-sm font-semibold transition-colors hover:bg-slate-50"
          >
            Start again
          </Link>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
