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
import { addSiteError, allowedFrequency, canShareReports } from "@/lib/plans";

export type FormState = { error?: string; success?: string };

const credentials = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

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

  const email = parsed.data.email.toLowerCase();

  if (await db.query.users.findFirst({ where: eq(users.email, email) })) {
    return { error: "An account with that email already exists." };
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

  const user = await db.query.users.findFirst({
    where: eq(users.email, parsed.data.email.toLowerCase()),
  });

  // Same message either way, so the form can't be used to discover which
  // addresses have accounts.
  const ok = user && (await bcrypt.compare(parsed.data.password, user.passwordHash));
  if (!ok || !user) return { error: "Email or password is incorrect." };

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
  redirect("/?deleted=1");
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

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return { error: "Not signed in." };

  const existing = await db.query.sites.findFirst({
    where: and(eq(sites.userId, userId), eq(sites.url, url)),
  });
  if (existing) return { error: "You're already watching that site." };

  // Checked after the duplicate test, so re-adding a site they already watch
  // reads as a duplicate rather than as a billing wall.
  const [{ n }] = await db
    .select({ n: count() })
    .from(sites)
    .where(eq(sites.userId, userId));

  const limit = addSiteError(user.plan, Number(n));
  if (limit) return { error: limit };

  const label =
    String(formData.get("label") ?? "").trim() ||
    new URL(url).hostname.replace(/^www\./, "");

  const [site] = await db
    .insert(sites)
    .values({ userId, url, label, alertEmail: user.email })
    .returning();

  // Run the first check now so the dashboard isn't empty, and so there's a
  // baseline for the next run to compare against.
  await runCheck(site);

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
