import Link from "next/link";
import { redirect } from "next/navigation";
import { Gauge, SignOut, UserCircle } from "@phosphor-icons/react/dist/ssr";
import { getCurrentUser } from "@/lib/auth";
import { limitsFor } from "@/lib/plans";
import { logout } from "./actions";

/**
 * Shared chrome for every signed-in page. Lives in a layout rather than in
 * each page so the header can't go missing on one of them.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 font-extrabold tracking-tight"
          >
            <Gauge weight="fill" className="size-6 text-brand-600" aria-hidden="true" />
            Sitegrade
          </Link>

          <div className="flex items-center gap-1">
            <Link
              href="/dashboard/account"
              className="flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm text-ink-muted transition-colors hover:text-ink"
            >
              <UserCircle className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Account</span>
              <span className="sr-only sm:hidden">Account</span>
              {/* The plan is on the header so "why can't I add another site?"
                  has an answer in view before they go looking. */}
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-ink-muted">
                {limitsFor(user.plan).name}
              </span>
            </Link>

            <form action={logout}>
              <button
                type="submit"
                className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-sm text-ink-muted transition-colors hover:text-ink"
              >
                <SignOut className="size-4" aria-hidden="true" />
                {/* Visually hidden on narrow screens, but the button must keep
                    an accessible name. */}
                <span className="hidden sm:inline">Log out</span>
                <span className="sr-only sm:hidden">Log out</span>
              </button>
            </form>
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}
