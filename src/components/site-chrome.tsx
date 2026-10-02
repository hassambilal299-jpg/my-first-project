import Link from "next/link";
import { Gauge } from "@phosphor-icons/react/dist/ssr";

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2 font-extrabold tracking-tight ${className}`}>
      <Gauge weight="fill" className="size-6 text-brand-600" aria-hidden="true" />
      Sitegrade
    </span>
  );
}

/**
 * Header for the public pages. Sticky, because the pricing page is long
 * enough that losing the way back to the audit would be annoying.
 */
export function MarketingHeader({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4">
        {/* Full-height so the tappable area matches the header, not just the
            cap height of the text. */}
        <Link href="/" aria-label="Sitegrade home" className="flex h-full items-center pr-2">
          <Wordmark />
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          <Link
            href="/pricing"
            className="flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-ink-muted transition-colors hover:text-ink"
          >
            Pricing
          </Link>

          {signedIn ? (
            <Link
              href="/dashboard"
              className="flex min-h-11 items-center rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
            >
              Dashboard
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-ink-muted transition-colors hover:text-ink"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="flex min-h-11 items-center rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
              >
                Start free
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

/**
 * Footer for every public page.
 *
 * The legal links are not decoration: a visitor deciding whether to hand over
 * an email address looks for them, and a payment provider will not approve an
 * account without them.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-20 border-t border-line bg-white">
      <div className="mx-auto max-w-5xl px-4 py-12">
        <div className="flex flex-col gap-10 sm:flex-row sm:justify-between">
          <div className="max-w-xs">
            <Wordmark />
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">
              Automatic website checks for the people who look after small
              business websites.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-10 sm:gap-16">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wide text-ink-muted">
                Product
              </h2>
              <ul className="mt-1 text-sm">
                <FooterLink href="/">Free website audit</FooterLink>
                <FooterLink href="/pricing">Pricing</FooterLink>
                <FooterLink href="/signup">Create an account</FooterLink>
                <FooterLink href="/login">Log in</FooterLink>
              </ul>
            </div>

            <div>
              <h2 className="text-xs font-bold uppercase tracking-wide text-ink-muted">
                Company
              </h2>
              <ul className="mt-1 text-sm">
                <FooterLink href="/terms">Terms of service</FooterLink>
                <FooterLink href="/privacy">Privacy policy</FooterLink>
                <FooterLink href="mailto:support@sitegrade.app" external>
                  Contact support
                </FooterLink>
              </ul>
            </div>
          </div>
        </div>

        <p className="mt-10 border-t border-line pt-6 text-xs text-ink-muted">
          © {year} Sitegrade. Every check runs against the public version of a
          website, exactly as a visitor would see it.
        </p>
      </div>
    </footer>
  );
}

/**
 * A standalone navigation link, so it gets a comfortable tap target rather
 * than the 16px of its own text. The inline links inside sentences elsewhere
 * are a different case and are left alone.
 */
function FooterLink({
  href,
  children,
  external = false,
}: {
  href: string;
  children: React.ReactNode;
  external?: boolean;
}) {
  const className =
    "flex min-h-11 items-center text-ink-muted transition-colors hover:text-ink";

  return (
    <li>
      {external ? (
        <a href={href} className={className}>
          {children}
        </a>
      ) : (
        <Link href={href} className={className}>
          {children}
        </Link>
      )}
    </li>
  );
}
