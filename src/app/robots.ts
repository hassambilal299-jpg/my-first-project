import type { MetadataRoute } from "next";

/**
 * Shared report links live under /r/ and are secret by design — a crawler
 * indexing one would publish a named business's weaknesses. The dashboard and
 * the admin endpoints have nothing to offer a search engine either.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/r/", "/dashboard", "/dashboard/", "/api/"],
      },
    ],
  };
}
