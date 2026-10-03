/**
 * Set a customer's plan by hand.
 *
 * There is no card checkout yet, so a paid plan is started the way a lot of
 * first customers are: you invoice them, they pay, you flip the plan. This is
 * the endpoint that flips it.
 *
 *   curl -X POST -H "Authorization: Bearer $ADMIN_SECRET" \
 *     "https://your-domain/api/admin/plan?email=them@example.com&plan=PRO&months=1"
 *
 * POST, not GET, and header-only: it grants paid entitlements, so it must not
 * be reachable by following a link, by a prefetcher, or by anyone reading an
 * access log. When a real payment provider is wired up, its webhook should
 * call the same logic rather than a second copy of it.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { asPlan, PLANS } from "@/lib/plans";
import { requireSecret } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const guard = requireSecret(req, "admin");
  if (!guard.ok) return guard.response;

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
    const whole = Number.isFinite(months) ? Math.floor(months) : 1;
    renewsAt = addMonths(new Date(), Math.max(1, whole));
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

/**
 * Adds whole months without JavaScript's end-of-month overflow.
 *
 * `setMonth` alone turns 31 January + 1 month into 3 March, because
 * 31 February rolls forward. Someone who pays on the 31st would get a few
 * days free every cycle, and the renewal date shown on their account page
 * would be wrong. Clamping to the last day of the target month is what every
 * billing system actually does.
 */
function addMonths(from: Date, months: number): Date {
  const day = from.getDate();
  const result = new Date(from);
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDayOfTarget = new Date(
    result.getFullYear(),
    result.getMonth() + 1,
    0,
  ).getDate();
  result.setDate(Math.min(day, lastDayOfTarget));
  return result;
}
