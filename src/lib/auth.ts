/**
 * Session handling — a signed JWT in an httpOnly cookie.
 * No auth service to pay for, nothing to configure beyond AUTH_SECRET.
 */
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";

const COOKIE = "sitegrade_session";
const MAX_AGE_SECS = 60 * 60 * 24 * 30;

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value || value === "change-me") {
    throw new Error(
      "AUTH_SECRET is missing or still the placeholder. Generate one with: openssl rand -base64 32",
    );
  }
  return new TextEncoder().encode(value);
}

export async function createSession(userId: string): Promise<void> {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECS}s`)
    .sign(secret());

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECS,
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export async function getUserId(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null; // expired or tampered with
  }
}

export async function getCurrentUser() {
  const userId = await getUserId();
  if (!userId) return null;
  return (await db.query.users.findFirst({ where: eq(users.id, userId) })) ?? null;
}
