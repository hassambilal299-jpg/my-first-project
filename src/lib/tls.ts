/**
 * Reads the expiry date off a site's TLS certificate.
 *
 * This exists because the product was advertising something it didn't do.
 * The home page showed an example alert reading "The SSL certificate expires
 * in 9 days", the report offered to warn you about "SSL expiring", and the
 * check list promised "a valid, in-date SSL certificate" — while the only
 * actual test was whether the final URL started with https. An expired
 * certificate surfaced as a vague "the site isn't loading".
 *
 * A lapsed certificate is one of the few failures that takes a small
 * business's website down completely and without warning, so it is worth
 * doing properly rather than deleting the claim.
 */
import { connect } from "tls";

export type CertInfo = {
  /** Whole days until expiry. Negative once it has already lapsed. */
  daysLeft: number;
  /** Who issued it, when we can tell. Shown in the finding. */
  issuer?: string;
};

const TIMEOUT_MS = 8000;

/**
 * Never throws and never rejects: a certificate we can't read is simply
 * unknown, and an unknown certificate must not turn into a finding or stop
 * the rest of the audit.
 *
 * `rejectUnauthorized: false` is deliberate and is NOT a security hole here.
 * We are not trusting this connection with anything — no request is sent and
 * no response is read. Refusing untrusted certificates would mean we could
 * never report on the one case the customer most needs to hear about: a
 * certificate that has already expired.
 */
export function readCertificate(
  hostname: string,
  port = 443,
): Promise<CertInfo | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: CertInfo | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    const socket = connect(
      {
        host: hostname,
        port,
        servername: hostname, // SNI, or a shared host hands back the wrong cert
        rejectUnauthorized: false,
        timeout: TIMEOUT_MS,
      },
      () => {
        try {
          const cert = socket.getPeerCertificate();
          if (!cert || !cert.valid_to) return finish(null);

          const expiresAt = new Date(cert.valid_to);
          if (Number.isNaN(expiresAt.getTime())) return finish(null);

          const msLeft = expiresAt.getTime() - Date.now();
          finish({
            daysLeft: Math.floor(msLeft / 86_400_000),
            issuer:
              typeof cert.issuer?.O === "string" ? cert.issuer.O : undefined,
          });
        } catch {
          finish(null);
        }
      },
    );

    socket.on("error", () => finish(null));
    socket.on("timeout", () => finish(null));
  });
}
