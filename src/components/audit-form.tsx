"use client";

import { useActionState, useState } from "react";
import { MagnifyingGlass, Warning } from "@phosphor-icons/react/dist/ssr";
import { runAudit } from "@/app/actions";
import { Report } from "@/components/report";
import { CHECK_COUNT } from "@/lib/checks";

export function AuditForm() {
  const [state, formAction, pending] = useActionState(runAudit, {});

  /**
   * Controlled, because React 19 resets a form once its action finishes —
   * even on an error. Uncontrolled, a visitor who mistyped an address would
   * be told it was wrong and handed an empty box, which is the fastest way
   * to lose someone on the first screen.
   */
  const [url, setUrl] = useState("");

  return (
    <div>
      <form action={formAction}>
        <label htmlFor="url" className="sr-only">
          Website address
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id="url"
            name="url"
            type="text"
            inputMode="url"
            autoComplete="url"
            required
            placeholder="mikesplumbing.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="min-h-13 flex-1 rounded-xl border border-line bg-white px-4 text-base text-ink placeholder:text-slate-400 focus:border-brand-600 focus:outline-none"
          />
          <button
            type="submit"
            disabled={pending}
            className="inline-flex min-h-13 cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 font-semibold text-white transition-colors duration-150 hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <MagnifyingGlass weight="bold" className="size-5" aria-hidden="true" />
            {pending ? "Checking…" : "Check site"}
          </button>
        </div>
      </form>

      {/* Announced to screen readers without stealing focus. */}
      <div aria-live="polite">
        {pending && (
          <p className="mt-4 text-center text-sm text-ink-muted">
            Fetching the site and running {CHECK_COUNT} checks…
          </p>
        )}

        {state.error && (
          <p
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            <Warning weight="fill" className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {state.error}
          </p>
        )}
      </div>

      {state.result && !pending && (
        <div className="mt-10">
          <Report result={state.result} />
        </div>
      )}
    </div>
  );
}
