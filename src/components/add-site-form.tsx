"use client";

import { useActionState, useEffect, useState } from "react";
import { addSite } from "@/app/dashboard/actions";
import { Button, Input, Notice } from "@/components/ui";

export function AddSiteForm() {
  const [state, formAction, pending] = useActionState(addSite, {});

  /**
   * The input is controlled on purpose.
   *
   * React 19 resets a form automatically once its action finishes, including
   * when the action came back with an error — so an uncontrolled field would
   * throw away the address someone just typed and tell them it was wrong,
   * leaving them nothing to correct. Holding the value here keeps a rejected
   * URL in the box, and it is cleared only when the site was really added.
   */
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (state.success) setUrl("");
  }, [state.success]);

  return (
    <form action={formAction} className="space-y-3">
      {state.error && <Notice>{state.error}</Notice>}
      {state.success && <Notice tone="success">{state.success}</Notice>}

      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex-1">
          <span className="sr-only">Website address</span>
          <Input
            name="url"
            type="text"
            inputMode="url"
            required
            placeholder="mikesplumbing.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? "Checking…" : "Watch it"}
        </Button>
      </div>
      <p className="text-xs text-ink-muted">
        We run the first check right away, then once a week after that.
      </p>
    </form>
  );
}
