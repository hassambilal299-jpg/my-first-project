"use client";

/**
 * Catches any error thrown while rendering a page.
 *
 * The common one in a fresh deployment is a missing DATABASE_URL, so that
 * case gets a specific message — a stack trace tells a visitor nothing, and
 * "Application error" tells the owner nothing either.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const notConfigured = /DATABASE_URL|AUTH_SECRET/.test(error.message);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-12 text-center">
      <h1 className="text-xl font-bold">
        {notConfigured ? "Monitoring isn't set up yet" : "Something went wrong"}
      </h1>

      <p className="mt-3 text-sm leading-relaxed text-ink-muted">
        {notConfigured ? (
          <>
            This deployment has no database connected, so accounts and site
            monitoring can&apos;t run. The free audit on the home page still
            works.
          </>
        ) : (
          <>That page failed to load. Trying again often fixes it.</>
        )}
      </p>

      <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <button
          onClick={reset}
          className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg bg-brand-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
        >
          Try again
        </button>
        <a
          href="/"
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-5 text-sm font-semibold transition-colors hover:bg-slate-50"
        >
          Back to the audit
        </a>
      </div>
    </main>
  );
}
