import Link from "next/link";
import { MarketingHeader, SiteFooter } from "@/components/site-chrome";

/**
 * Also what a revoked share link lands on, so the wording avoids implying
 * the address was ever valid.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <MarketingHeader />

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-20 text-center">
        <p className="text-sm font-bold uppercase tracking-widest text-brand-600">
          404
        </p>
        <h1 className="mt-3 text-2xl font-extrabold">That page isn&apos;t here</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          The address may be mistyped, or it may be a shared report link that
          has since been turned off.
        </p>

        <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
          >
            Check a website free
          </Link>
          <Link
            href="/pricing"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-5 text-sm font-semibold transition-colors hover:bg-slate-50"
          >
            See pricing
          </Link>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
