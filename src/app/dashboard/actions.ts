"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, count, eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { alerts, createId, sites, users } from "@/lib/schema";
import { createSession, destroySession, getUserId } from "@/lib/auth";
import { normalizeUrl } from "@/lib/audit";
import { runCheck } from "@/lib/monitor";
import { addSiteError, allowedFrequency, canShareReports, limitsFor } from "@/lib/plans";
import {
  clientKey,
  loginLimitMessage,
  signupLimitMessage,
  takeLoginSlot,
  takeSignupSlot,
} from "@/lib/rate-limit";

export type FormState = { error?: string; success?: string };

const credentials = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

/**
 * A real bcrypt hash of a value nobody knows, compared against when the email
 * doesn't exist so that login takes the same time either way. Cost 12, to
 * match what signup produces.
 */
const DUMMY_HASH =
  "$2b$12$CIl0ovKYxO11tPYgqDOtguKUWNf/ll4RoAFvXbzq1diFZN5Y9Hx2u";

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

export async function signup(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  // Capped per address: signup creates an account AND runs an audit of
  // whatever URL is handed to it, so without this a script gets unlimited
  // accounts and unlimited server-side fetches of any site it names.
  const slot = await takeSignupSlot(await clientKey());
  if (!slot.ok) return { error: signupLimitMessage(slot) };

  const email = parsed.data.email.toLowerCase();

  if (await db.query.users.findFirst({ where: eq(users.email, email) })) {
    // Deliberately vague. Saying "that email is already registered" turns
    // this form into a way to test whether any given address has an account
    // here, which is worth knowing to someone with a stolen password list.
    return {
      error:
        "We couldn't create that account. If you already have one, log in instead — or reset the password from the login page.",
    };
  }

  const [user] = await db
    .insert(users)
    .values({ email, passwordHash: await bcrypt.hash(parsed.data.password, 12) })
    .returning();

  await createSession(user.id);

  // If they came from the free audit, start watching that site immediately —
  // it's the whole reason they signed up.
  const pendingUrl = String(formData.get("watchUrl") ?? "");
  if (pendingUrl) {
    const url = normalizeUrl(pendingUrl);
    if (url) {
      const [site] = await db
        .insert(sites)
        .values({
          userId: user.id,
          url,
          label: new URL(url).hostname.replace(/^www\./, ""),
          alertEmail: email,
        })
        .returning();

      // Run the first check now. Landing on a dashboard that says "not
      // checked yet" is the worst possible first impression, and this also
      // gives the next run a baseline to compare against.
      await runCheck(site);
    }
  }

  redirect("/dashboard");
}

export async function login(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const slot = await takeLoginSlot(await clientKey());
  if (!slot.ok) return { error: loginLimitMessage(slot) };

  const user = await db.query.users.findFirst({
    where: eq(users.email, parsed.data.email.toLowerCase()),
  });

  /**
   * The comparison always runs, even when there is no such account.
   *
   * Writing this as `user && await bcrypt.compare(...)` short-circuits, so an
   * unknown address comes back in about a millisecond while a real one costs
   * a full cost-12 hash. That difference is easily measurable over the
   * network and turns the login form into an account-enumeration oracle, no
   * matter how carefully the message is worded.
   */
  const hash = user?.passwordHash ?? DUMMY_HASH;
  const passwordMatches = await bcrypt.compare(parsed.data.password, hash);

  // Same message either way, so the form can't be used to discover which
  // addresses have accounts.
  if (!user || !passwordMatches) return { error: "Email or password is incorrect." };

  await createSession(user.id);
  redirect("/dashboard");
}

export async function logout() {
  await destroySession();
  redirect("/");
}

export async function changePassword(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = await getUserId();
  if (!userId) return { error: "Not signed in." };

  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");

  if (next.length < 8) {
    return { error: "The new password must be at least 8 characters." };
  }
  if (next === current) {
    return { error: "That's the password you already have." };
  }

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return { error: "Not signed in." };

  if (!(await bcrypt.compare(current, user.passwordHash))) {
    return { error: "Your current password isn't right." };
  }

  await db
    .update(users)
    .set({ passwordHash: await bcrypt.hash(next, 12) })
    .where(eq(users.id, userId));

  return { success: "Password changed." };
}

/**
 * Deletes the account and everything attached to it.
 *
 * Requires the password, not just a session: an unattended laptop should not
 * be enough to wipe someone's monitoring history. The cascade on sites takes
 * the checks and alerts with it.
 */
export async function deleteAccount(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = await getUserId();
  if (!userId) return { error: "Not signed in." };

  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "").trim();

  if (confirm !== "DELETE") {
    return { error: 'Type DELETE in the box to confirm.' };
  }

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return { error: "Not signed in." };

  if (!(await bcrypt.compare(password, user.passwordHash))) {
    return { error: "That password isn't right." };
  }

  await db.delete(users).where(eq(users.id, userId));
  await destroySession();

  // Its own page rather than a query parameter on the home page: the home
  // page is static, so it cannot read one, and silently landing back on the
  // marketing site leaves you wondering whether it actually worked.
  redirect("/goodbye");
}

/* ------------------------------------------------------------------ */
/* Monitored sites                                                     */
/* ------------------------------------------------------------------ */

export async function addSite(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = await getUserId();
  if (!userId) return { error: "Not signed in." };

  const url = normalizeUrl(String(formData.get("url") ?? ""));
  if (!url) {
    return { error: "That doesn't look like a website address." };
  }

  const label =
    String(formData.get("label") ?? "").trim() ||
    new URL(url).hostname.replace(/^www\./, "");

  /**
   * Counting and inserting happen in one transaction, with the user row
   * locked.
   *
   * As two separate statements this was a free-sites bug: submit the form
   * twice at once on the free plan and both requests read a count of 0, both
   * passed the limit check, and both inserted. Scripted, the limit meant
   * nothing at all.
   */
  const outcome = await db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    if (!user) return { error: "Not signed in." };

    const existing = await tx.query.sites.findFirst({
      where: and(eq(sites.userId, userId), eq(sites.url, url)),
    });
    // Checked before the limit, so re-adding a site they already watch reads
    // as a duplicate rather than as a billing wall.
    if (existing) return { error: "You're already watching that site." };

    const [{ n }] = await tx
      .select({ n: count() })
      .from(sites)
      .where(eq(sites.userId, userId));

    const limit = addSiteError(user.plan, Number(n));
    if (limit) return { error: limit };

    const [site] = await tx
      .insert(sites)
      .values({ userId, url, label, alertEmail: user.email })
      .returning();

    return { site, plan: user.plan };
  });

  if ("error" in outcome) return outcome;

  // Deliberately outside the transaction: the audit is a network call that
  // can take twenty seconds, and holding a row lock on the user for that
  // long would block every one of their other requests.
  await runCheck(outcome.site, outcome.plan);

  revalidatePath("/dashboard");
  return { success: `Now watching ${label}.` };
}

export async function checkNow(formData: FormData): Promise<void> {
  const userId = await getUserId();
  if (!userId) return;

  const siteId = String(formData.get("siteId") ?? "");
  const site = await db.query.sites.findFirst({
    where: and(eq(sites.id, siteId), eq(sites.userId, userId)),
  });
  if (!site) return;

  await runCheck(site);
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/${siteId}`);
}

export async function setPaused(formData: FormData): Promise<void> {
  const userId = await getUserId();
  if (!userId) return;

  const siteId = String(formData.get("siteId") ?? "");
  const paused = formData.get("paused") === "true";

  await db
    .update(sites)
    .set({ paused })
    .where(and(eq(sites.id, siteId), eq(sites.userId, userId)));

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/${siteId}`);
}

export async function setFrequency(formData: FormData): Promise<void> {
  const userId = await getUserId();
  if (!userId) return;

  const siteId = String(formData.get("siteId") ?? "");
  const value = String(formData.get("frequency") ?? "");
  if (value !== "DAILY" && value !== "WEEKLY") return;

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return;

  // Clamped rather than refused. The UI already disables daily on the free
  // plan; this is the server-side half of the same rule.
  await db
    .update(sites)
    .set({ frequency: allowedFrequency(user.plan, value) })
    .where(and(eq(sites.id, siteId), eq(sites.userId, userId)));

  revalidatePath(`/dashboard/${siteId}`);
}

export async function removeSite(formData: FormData): Promise<void> {
  const userId = await getUserId();
  if (!userId) return;

  const siteId = String(formData.get("siteId") ?? "");
  await db
    .delete(sites)
    .where(and(eq(sites.id, siteId), eq(sites.userId, userId)));

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export async function markAlertsRead(formData: FormData): Promise<void> {
  const userId = await getUserId();
  if (!userId) return;

  const siteId = String(formData.get("siteId") ?? "");
  // Scoped through the site so one user can't clear another's alerts.
  const site = await db.query.sites.findFirst({
    where: and(eq(sites.id, siteId), eq(sites.userId, userId)),
  });
  if (!site) return;

  await db.update(alerts).set({ readAt: new Date() }).where(eq(alerts.siteId, siteId));

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/${siteId}`);
}

/**
 * Turns the public report link on, off, or rotates it.
 *
 * "on" when a link already exists issues a fresh token, which is how you
 * revoke one you've already sent to a client.
 */
export async function setShareLink(formData: FormData): Promise<void> {
  const userId = await getUserId();
  if (!userId) return;

  const siteId = String(formData.get("siteId") ?? "");
  const enabled = formData.get("enabled") === "true";

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return;

  // Turning it OFF is always allowed, whatever the plan — a downgrade must
  // never trap a link in the on position.
  if (enabled && !canShareReports(user.plan)) return;

  await db
    .update(sites)
    .set({ shareToken: enabled ? createId() : null })
    .where(and(eq(sites.id, siteId), eq(sites.userId, userId)));

  revalidatePath(`/dashboard/${siteId}`);
}

export async function setAlertEmail(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = await getUserId();
  if (!userId) return { error: "Not signed in." };

  const siteId = String(formData.get("siteId") ?? "");
  const email = z.string().email().safeParse(String(formData.get("alertEmail") ?? ""));
  if (!email.success) return { error: "Enter a valid email address." };

  const result = await db
    .update(sites)
    .set({ alertEmail: email.data.toLowerCase() })
    .where(and(eq(sites.id, siteId), eq(sites.userId, userId)))
    .returning({ id: sites.id });

  if (result.length === 0) return { error: "That site isn't on your account." };

  revalidatePath(`/dashboard/${siteId}`);
  return { success: `Alerts for this site now go to ${email.data.toLowerCase()}.` };
}
