"use server";

import { auditSite, normalizeUrl, type AuditResult } from "@/lib/audit";
import { clientKey, rateLimitMessage, takeAuditSlot } from "@/lib/rate-limit";
import { getUserId } from "@/lib/auth";

export type AuditState = {
  result?: AuditResult;
  error?: string;
};

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

  /**
   * Signed-in visitors aren't capped. The cap exists to stop an anonymous
   * script using us to hammer other people's websites; someone with an
   * account is identifiable and can be suspended, which is a better control
   * than a counter. It also makes the free plan's "unlimited one-off audits"
   * true, and gives the refusal message somewhere real to send people.
   *
   * Checked after parsing, so a typo never burns one of their audits.
   */
  let signedIn = false;
  try {
    signedIn = Boolean(await getUserId());
  } catch {
    signedIn = false;
  }

  if (!signedIn) {
    const slot = await takeAuditSlot(await clientKey());
    if (!slot.ok) return { error: rateLimitMessage(slot) };
  }

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
