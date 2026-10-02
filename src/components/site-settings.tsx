"use client";

import { useActionState, useState } from "react";
import { Check, Copy, LinkSimple } from "@phosphor-icons/react/dist/ssr";
import { Button, Field, Input, Notice } from "@/components/ui";
import { setAlertEmail } from "@/app/dashboard/actions";

export function AlertEmailForm({
  siteId,
  current,
}: {
  siteId: string;
  current: string;
}) {
  const [state, action, pending] = useActionState(setAlertEmail, {});

  return (
    <form action={action} className="mt-3 space-y-3">
      <input type="hidden" name="siteId" value={siteId} />
      <Field label="Send alerts to">
        <Input
          name="alertEmail"
          type="email"
          autoComplete="email"
          defaultValue={current}
          required
        />
      </Field>

      <div aria-live="polite">
        {state.error && <Notice>{state.error}</Notice>}
        {state.success && <Notice tone="success">{state.success}</Notice>}
      </div>

      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Saving…" : "Save address"}
      </Button>
    </form>
  );
}

/**
 * The public report link, with a copy button.
 *
 * `url` is built on the server from the request host, so it is correct on a
 * preview deployment and a custom domain alike without an environment
 * variable to keep in sync.
 */
export function ShareLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the input is selectable as a fallback.
      setCopied(false);
    }
  }

  return (
    <div className="mt-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="share-url">
          Public report link
        </label>
        <input
          id="share-url"
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="min-h-11 flex-1 rounded-lg border border-line bg-slate-50 px-3 text-sm text-ink-muted"
        />
        <Button type="button" variant="secondary" onClick={copy}>
          {copied ? (
            <>
              <Check weight="bold" className="size-4" aria-hidden="true" /> Copied
            </>
          ) : (
            <>
              <Copy className="size-4" aria-hidden="true" /> Copy
            </>
          )}
        </Button>
      </div>

      <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-muted">
        <LinkSimple className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        Anyone with this link sees the latest report — no account needed. It
        updates itself after every check.
      </p>

      {/* Announce the copy to a screen reader, which can't see the icon swap. */}
      <span aria-live="polite" className="sr-only">
        {copied ? "Link copied to clipboard" : ""}
      </span>
    </div>
  );
}
