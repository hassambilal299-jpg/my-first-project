/**
 * Shared guard for the scheduled and administrative endpoints.
 *
 * Three things went wrong in the first version, all of them worth keeping
 * fixed:
 *
 *  1. The secret was accepted in the query string. A URL that grants paid
 *     entitlements ends up in platform access logs, in an uptime monitor's
 *     configuration, and in browser history. Header only now, except for the
 *     cron endpoint, where the query form is kept because it is how you
 *     trigger a run by hand and it grants nothing but a check.
 *  2. A placeholder value was accepted. A deployment copied from
 *     .env.example ran with CRON_SECRET="change-me", which anyone could
 *     guess. Rejected the way AUTH_SECRET already is.
 *  3. Comparison was `!==`, which leaks the secret a character at a time to
 *     anyone patient enough to measure. Constant-time now.
 *
 * ADMIN_SECRET guards the endpoints that change data. It falls back to
 * CRON_SECRET so an existing deployment keeps working, but setting a
 * separate one means the value you paste into a cron configuration cannot
 * also hand out Agency plans.
 */
import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

const PLACEHOLDERS = new Set(["change-me", "changeme", "secret", "todo", ""]);

function usable(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || PLACEHOLDERS.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

/** Length-safe constant-time comparison. */
function matches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length, so both sides are compared at a fixed width.
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

export type Guard = { ok: true } | { ok: false; response: NextResponse };

/**
 * @param scope  "admin" for anything that changes data, "cron" for the
 *               scheduled check. Only "cron" accepts ?secret=.
 */
export function requireSecret(req: NextRequest, scope: "admin" | "cron"): Guard {
  const expected =
    scope === "admin"
      ? usable(process.env.ADMIN_SECRET) ?? usable(process.env.CRON_SECRET)
      : usable(process.env.CRON_SECRET);

  if (!expected) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            scope === "admin"
              ? "ADMIN_SECRET (or CRON_SECRET) is not set, or is still a placeholder value."
              : "CRON_SECRET is not set, or is still a placeholder value.",
        },
        { status: 500 },
      ),
    };
  }

  const header = req.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (bearer && matches(bearer, expected)) return { ok: true };

  if (scope === "cron") {
    const query = req.nextUrl.searchParams.get("secret");
    if (query && matches(query, expected)) return { ok: true };
  }

  return {
    ok: false,
    response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
  };
}
