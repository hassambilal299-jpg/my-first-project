import type { ReactNode } from "react";
import { MarketingHeader, SiteFooter } from "@/components/site-chrome";

/**
 * Shell for the terms and privacy pages.
 *
 * Plain prose on a white card, narrow measure. These pages exist to be read
 * and to be found, so there is nothing clever here on purpose.
 */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      <MarketingHeader />

      <main className="mx-auto max-w-2xl px-4 py-14">
        <h1 className="text-3xl font-extrabold sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-ink-muted">Last updated {updated}</p>

        <div className="mt-8 space-y-7 rounded-xl border border-line bg-white p-6 sm:p-8">
          {children}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

export function Clause({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-bold text-ink">{heading}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-ink-muted">
        {children}
      </div>
    </section>
  );
}
