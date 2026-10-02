"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { login } from "@/app/dashboard/actions";
import { Button, Field, Input, Notice } from "@/components/ui";
import { Wordmark } from "@/components/site-chrome";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, {});

  // React 19 resets the form after the action, so an uncontrolled email field
  // would be wiped by a wrong password. Retyping the address to fix a typo in
  // the password is pure friction.
  const [email, setEmail] = useState("");

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-12">
      <Link
        href="/"
        aria-label="Sitegrade home"
        className="mb-6 flex min-h-11 items-center justify-center self-center px-3 text-lg"
      >
        <Wordmark className="text-lg" />
      </Link>

      <div className="rounded-xl border border-line bg-white p-6">
        <h1 className="text-xl font-bold">Log in</h1>
        <form action={formAction} className="mt-5 space-y-4">
          {state.error && <Notice>{state.error}</Notice>}
          <Field label="Email">
            <Input
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@business.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Password">
            <Input name="password" type="password" autoComplete="current-password" required />
          </Field>
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Logging in…" : "Log in"}
          </Button>
        </form>
      </div>

      <p className="mt-5 text-center text-sm text-ink-muted">
        No account?{" "}
        <Link href="/signup" className="font-semibold text-brand-600 hover:underline">Create one</Link>
      </p>
    </main>
  );
}
