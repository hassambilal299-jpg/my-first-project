"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { signup } from "@/app/dashboard/actions";
import { Button, Field, Input, Notice } from "@/components/ui";
import { Wordmark } from "@/components/site-chrome";
import { PLANS } from "@/lib/plans";

function SignupForm() {
  const [state, formAction, pending] = useActionState(signup, {});

  // Controlled for the same reason as on the login page: React resets the
  // form after the action runs, error or not.
  const [email, setEmail] = useState("");
  const params = useSearchParams();

  // Carried over from the free audit, so the site they just checked is the
  // first thing we start watching.
  const watchUrl = params.get("watch") ?? "";

  // Carried over from the pricing page. Every account starts free whatever
  // this says — it only changes the wording, so the person who clicked
  // "Start with Pro" isn't left wondering where Pro went.
  const wanted = asKnownPlan(params.get("plan"));

  return (
    <div className="rounded-xl border border-line bg-white p-6">
      <h1 className="text-xl font-bold">Start watching your site</h1>
      <p className="mt-1 text-sm text-ink-muted">
        We check it automatically and email you the day something breaks.
      </p>

      <form action={formAction} className="mt-5 space-y-4">
        {state.error && <Notice>{state.error}</Notice>}
        {watchUrl && <input type="hidden" name="watchUrl" value={watchUrl} />}

        {watchUrl && (
          <Notice tone="info">
            We&apos;ll start watching <strong>{watchUrl}</strong> straight away.
          </Notice>
        )}

        {wanted && (
          <Notice tone="info">
            Your account starts on the free plan. Once you&apos;re in, email us
            and we&apos;ll move you to <strong>{PLANS[wanted].name}</strong> —
            no card needed up front.
          </Notice>
        )}

        <Field label="Email" hint="Where alerts get sent.">
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
        <Field label="Password" hint="At least 8 characters.">
          <Input name="password" type="password" autoComplete="new-password" required minLength={8} />
        </Field>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Setting up…" : "Start watching"}
        </Button>

        <p className="text-xs leading-relaxed text-ink-muted">
          By creating an account you agree to our{" "}
          <Link href="/terms" className="font-semibold text-brand-700 hover:underline">
            terms of service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="font-semibold text-brand-700 hover:underline">
            privacy policy
          </Link>
          . No card, and the free plan doesn&apos;t expire.
        </p>
      </form>
    </div>
  );
}

/** Narrows an arbitrary query parameter to a paid plan, or nothing. */
function asKnownPlan(value: string | null): "PRO" | "AGENCY" | null {
  const upper = value?.toUpperCase();
  return upper === "PRO" || upper === "AGENCY" ? upper : null;
}

export default function SignupPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-12">
      <Link
        href="/"
        aria-label="Sitegrade home"
        className="mb-6 flex min-h-11 items-center justify-center self-center px-3"
      >
        <Wordmark className="text-lg" />
      </Link>

      <Suspense fallback={<div className="rounded-xl border border-line bg-white p-6">Loading…</div>}>
        <SignupForm />
      </Suspense>

      <p className="mt-5 text-center text-sm text-ink-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-brand-600 hover:underline">Log in</Link>
      </p>
    </main>
  );
}
