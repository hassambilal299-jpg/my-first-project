"use server";

import { headers } from "next/headers";
import { auditSite, normalizeUrl, type AuditResult } from "@/lib/audit";
import { rateLimitMessage, takeAuditSlot } from "@/lib/rate-limit";

export type AuditState = {
  result?: AuditResult;
  error?: string;
};

/**
 * Best guess at who is calling, for rate limiting only.
 *
 * On Vercel the real client address is the first entry in x-forwarded-for;
 * the socket address is the proxy's and identical for everyone. An empty
 * string means we could not tell, and the limiter lets those through rather
 * than putting every unidentified visitor in one shared bucket.
 */
async function clientKey(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return h.get("x-real-ip")?.trim() ?? "";
}

/**
 * Run an audit for the URL typed into the form.
 *
 * Runs on the server, which is what makes the whole product possible: the
 * browser can't fetch another site's HTML because of cross-origin rules.
 */
export async function runAudit(
  _prev: AuditState,
  formData: FormData,
): Promise<AuditState> {
  const input = String(formData.get("url") ?? "");

  const url = normalizeUrl(input);
  if (!url) {
    return {
      error:
        "That doesn't look like a website address. Try something like mikesplumbing.com",
    };
  }

  // Checked after parsing, so a typo doesn't burn one of their audits.
  const slot = await takeAuditSlot(await clientKey());
  if (!slot.ok) return { error: rateLimitMessage(slot) };

  try {
    return { result: await auditSite(url) };
  } catch (err) {
    return {
      error:
        err instanceof Error
          ? err.message
          : "Something went wrong running that audit.",
    };
  }
}
