import { redirect } from "next/navigation";
import { getUserId } from "@/lib/auth";

/** signup runs a first audit for the site carried over from the free check. */
export const maxDuration = 60;

/**
 * Someone already signed in has no business on the login or signup form, so
 * they go straight to their dashboard.
 *
 * This is also what lets the home page and the pricing page stay static: they
 * no longer need to read the session to decide what the header says, because
 * a returning visitor who clicks "Log in" ends up in the right place anyway.
 *
 * getUserId only reads a cookie and verifies a signature — no database — so
 * these pages still render if the database is unreachable.
 */
export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let signedIn = false;
  try {
    signedIn = Boolean(await getUserId());
  } catch {
    signedIn = false;
  }

  if (signedIn) redirect("/dashboard");

  return children;
}
