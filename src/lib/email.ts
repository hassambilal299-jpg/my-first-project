/**
 * Alert emails.
 *
 * Resend is optional on purpose. Without an API key the product still works —
 * alerts are stored and shown in the dashboard — it just can't push them to
 * an inbox. That keeps the app runnable before any email setup exists.
 */
import type { Alert } from "@/lib/diff";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type AlertEmail = {
  to: string;
  subject: string;
  siteLabel: string;
  siteUrl: string;
  score: number;
  alerts: Alert[];
};

/** Returns true only when an email was actually accepted by the provider. */
export async function sendAlertEmail(email: AlertEmail): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ALERT_FROM_EMAIL;

  if (!apiKey || !from) {
    // Not an error. The dashboard is still the source of truth.
    console.info(
      `[email] skipped "${email.subject}" — RESEND_API_KEY / ALERT_FROM_EMAIL not set`,
    );
    return false;
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email.to],
        subject: email.subject,
        html: renderHtml(email),
        text: renderText(email),
      }),
    });

    if (!res.ok) {
      console.error(`[email] Resend rejected the message: ${await res.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[email] failed to send:", err);
    return false;
  }
}

/* ------------------------------------------------------------------ */

const ORDER = { urgent: 0, normal: 1, good_news: 2 } as const;

function sorted(alerts: Alert[]): Alert[] {
  return [...alerts].sort((a, b) => ORDER[a.urgency] - ORDER[b.urgency]);
}

function escape(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Deliberately plain HTML with inline styles. Email clients strip stylesheets
 * and most of modern CSS, so anything cleverer would arrive broken.
 */
function renderHtml(email: AlertEmail): string {
  const rows = sorted(email.alerts)
    .map((a) => {
      const color =
        a.urgency === "urgent"
          ? "#dc2626"
          : a.urgency === "normal"
            ? "#d97706"
            : "#16a34a";
      return `
      <tr><td style="padding:16px 0;border-bottom:1px solid #e2e8f0;">
        <div style="font:600 15px/1.4 -apple-system,Segoe UI,sans-serif;color:${color};">
          ${escape(a.title)}
        </div>
        <div style="font:400 14px/1.6 -apple-system,Segoe UI,sans-serif;color:#475569;margin-top:6px;">
          ${escape(a.detail)}
        </div>
        ${
          a.fix
            ? `<div style="font:500 14px/1.5 -apple-system,Segoe UI,sans-serif;color:#4338ca;margin-top:8px;">Fix: ${escape(a.fix)}</div>`
            : ""
        }
      </td></tr>`;
    })
    .join("");

  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f8fafc;">
  <table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;">
    <tr><td style="padding:24px;">
      <div style="font:800 18px/1.3 -apple-system,Segoe UI,sans-serif;color:#0f172a;">
        ${escape(email.siteLabel)}
      </div>
      <div style="font:400 14px/1.5 -apple-system,Segoe UI,sans-serif;color:#475569;margin-top:4px;">
        ${escape(email.siteUrl)} &middot; score ${email.score}/100
      </div>
      <table role="presentation" width="100%" style="margin-top:8px;">${rows}</table>
      <div style="font:400 12px/1.5 -apple-system,Segoe UI,sans-serif;color:#94a3b8;margin-top:20px;">
        You're getting this because you asked Sitegrade to watch this site.
      </div>
    </td></tr>
  </table>
</body></html>`;
}

function renderText(email: AlertEmail): string {
  const lines = sorted(email.alerts).map((a) => {
    const fix = a.fix ? `\n  Fix: ${a.fix}` : "";
    return `- ${a.title}\n  ${a.detail}${fix}`;
  });

  return [
    `${email.siteLabel} (${email.siteUrl})`,
    `Score: ${email.score}/100`,
    "",
    ...lines,
    "",
    "You're getting this because you asked Sitegrade to watch this site.",
  ].join("\n");
}
