/**
 * Set a customer's plan by hand.
 *
 * There is no card checkout yet, so a paid plan is started the way a lot of
 * first customers are: you invoice them, they pay, you flip the plan. This is
 * the endpoint that flips it.
 *
 *   /api/admin/plan?secret=CRON_SECRET&email=them@example.com&plan=PRO&months=1
 *
 * Guarded by CRON_SECRET, because it grants paid entitlements. When a real
 * payment provider is wired up, its webhook should call the same logic rather
 * than a second copy of it.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { asPlan, PLANS } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 500 });
  }

  const header = req.headers.get("authorization");
  const query = req.nextUrl.searchParams.get("secret");
  if (header !== `Bearer ${secret}` && query !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const email = req.nextUrl.searchParams.get("email")?.toLowerCase().trim();
  const requested = req.nextUrl.searchParams.get("plan")?.toUpperCase().trim();

  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }
  // Checked explicitly rather than coerced: silently downgrading someone to
  // FREE because of a typo in the query string would be a billing incident.
  if (!requested || !(requested in PLANS)) {
    return NextResponse.json(
      { error: `plan must be one of ${Object.keys(PLANS).join(", ")}` },
      { status: 400 },
    );
  }

  const plan = asPlan(requested);

  // How long they've paid for. Ignored on the free plan, which never expires.
  const months = Number(req.nextUrl.searchParams.get("months") ?? "1");
  let renewsAt: Date | null = null;
  if (plan !== "FREE") {
    const whole = Number.isFinite(months) && months > 0 ? Math.floor(months) : 1;
    renewsAt = new Date();
    renewsAt.setMonth(renewsAt.getMonth() + whole);
  }

  const [updated] = await db
    .update(users)
    .set({ plan, planRenewsAt: renewsAt })
    .where(eq(users.email, email))
    .returning({ email: users.email, plan: users.plan, planRenewsAt: users.planRenewsAt });

  if (!updated) {
    return NextResponse.json({ error: `no account for ${email}` }, { status: 404 });
  }

  return NextResponse.json({ ok: true, user: updated, limits: PLANS[plan] });
}
