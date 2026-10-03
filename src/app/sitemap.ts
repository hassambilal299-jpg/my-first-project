import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/origin";

/** Only the public marketing pages. Dashboards and shared reports stay out. */
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();
  const now = new Date();

  return [
    { url: `${origin}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${origin}/pricing`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${origin}/signup`, lastModified: now, changeFrequency: "yearly", priority: 0.5 },
    { url: `${origin}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${origin}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];
}
