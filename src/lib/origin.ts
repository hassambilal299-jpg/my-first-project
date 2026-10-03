/**
 * The site's own public address.
 *
 * Needed by anything that has to emit an absolute URL without a request to
 * read the host from — the sitemap, social preview tags, links inside alert
 * emails. Preference order:
 *
 *   1. SITE_URL, if you've set a custom domain.
 *   2. VERCEL_PROJECT_PRODUCTION_URL, which Vercel sets to the project's
 *      stable production hostname. Note that VERCEL_URL is NOT used: it
 *      points at the individual immutable deployment, so an email sent six
 *      weeks ago would link to a deployment nobody looks at.
 *   3. localhost, for development.
 */
export function siteOrigin(): string {
  const configured = process.env.SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (production) return `https://${production.replace(/\/+$/, "")}`;

  return "http://localhost:3000";
}
