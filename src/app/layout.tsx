import type { Metadata, Viewport } from "next";
import { siteOrigin } from "@/lib/origin";
import { CHECK_COUNT } from "@/lib/checks";
import "./globals.css";

const DESCRIPTION = `Run a free ${CHECK_COUNT}-point check on any website in seconds. Then let Sitegrade watch it and email you the day something breaks.`;

export const metadata: Metadata = {
  // Makes every relative URL in metadata — including the social image —
  // resolve to an absolute one, which is required for link previews.
  metadataBase: new URL(siteOrigin()),

  title: {
    default: "Sitegrade — know the day a website breaks",
    // Page titles become "Pricing — Sitegrade" without repeating the suffix
    // in every file.
    template: "%s — Sitegrade",
  },
  description: DESCRIPTION,
  applicationName: "Sitegrade",

  openGraph: {
    type: "website",
    siteName: "Sitegrade",
    title: "Sitegrade — know the day a website breaks",
    description: DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Sitegrade — know the day a website breaks",
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: "#4f46e5",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
