import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clipper — find the moments worth posting",
  description:
    "Paste a YouTube link and get the handful of moments worth cutting into shorts, with timecodes and the reasoning behind each one.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75..125,400..700&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
