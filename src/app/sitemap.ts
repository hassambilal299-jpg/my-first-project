import { headers } from "next/headers";
import type { MetadataRoute } from "next";

/**
 * The public pages only. Built from the request host so it is correct on a
 * preview deployment and a custom domain without an environment variable to
 * keep in sync.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? "sitegrade.app"}`;
  const now = new Date();

  return [
    { url: `${origin}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${origin}/pricing`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${origin}/signup`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${origin}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${origin}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];
}
