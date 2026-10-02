"use client";

import { useActionState } from "react";
import { Button, Field, Input, Notice } from "@/components/ui";
import { changePassword, deleteAccount } from "@/app/dashboard/actions";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePassword, {});

  return (
    <form action={action} className="mt-4 space-y-4">
      <Field label="Current password">
        <Input
          name="current"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>

      <Field label="New password" hint="At least 8 characters.">
        <Input
          name="next"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </Field>

      <div aria-live="polite">
        {state.error && <Notice>{state.error}</Notice>}
        {state.success && <Notice tone="success">{state.success}</Notice>}
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Change password"}
      </Button>
    </form>
  );
}

/**
 * Deliberately awkward: it asks for the password AND for the word DELETE.
 * Everything the account holds — every site, every check, the whole history —
 * goes with it, and there is no undo.
 */
export function DeleteAccountForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(deleteAccount, {});

  return (
    <details className="mt-4 group">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-sm font-semibold text-critical hover:underline">
        Delete my account
      </summary>

      <form action={action} className="mt-4 space-y-4 border-t border-line pt-4">
        <p className="text-sm leading-relaxed text-ink-muted">
          This deletes <span className="font-semibold text-ink">{email}</span>,
          every site you watch, and the whole check history behind them. It
          happens immediately and cannot be undone.
        </p>

        <Field label="Your password">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>

        <Field label="Type DELETE to confirm">
          <Input
            name="confirm"
            type="text"
            autoComplete="off"
            placeholder="DELETE"
            required
          />
        </Field>

        <div aria-live="polite">{state.error && <Notice>{state.error}</Notice>}</div>

        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? "Deleting…" : "Delete this account permanently"}
        </Button>
      </form>
    </details>
  );
}
