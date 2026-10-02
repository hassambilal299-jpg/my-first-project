import type { Metadata, Viewport } from "next";
import "./globals.css";
import { CHECK_COUNT } from "@/lib/checks";

const TITLE = "Sitegrade — know the day a website breaks";
const DESCRIPTION = `Run a free ${CHECK_COUNT}-point check on any website in seconds, then let Sitegrade watch it and email you the day something breaks.`;

export const metadata: Metadata = {
  title: { default: TITLE, template: "%s" },
  description: DESCRIPTION,
  applicationName: "Sitegrade",
  // Resolved from the deployment host at runtime where possible, so preview
  // deployments don't advertise the production domain.
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ??
      (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : "https://sitegrade-tau.vercel.app"),
  ),
  openGraph: {
    type: "website",
    siteName: "Sitegrade",
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#4f46e5",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Warm the connection to the font host while the HTML is still
            streaming, so the font request isn't waiting on a TLS handshake. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
