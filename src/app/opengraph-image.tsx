import { ImageResponse } from "next/og";
import { CHECK_COUNT } from "@/lib/checks";

/**
 * The card people see when a Sitegrade link is pasted into a chat.
 *
 * Rendered at request time by next/og rather than shipped as a PNG, so the
 * check count can't drift out of date. Plain layout on purpose: no webfont
 * fetch, so it cannot fail at render time in a region where the font CDN is
 * slow — the system stack is enough at this size.
 *
 * Satori (what next/og renders with) is not a browser. Any element with more
 * than one child needs an explicit `display`, and `<br />` counts as a child —
 * so each line of the headline is its own flex row rather than one div with
 * line breaks in it. Leaving that out fails the production build, not just
 * the image.
 */
export const alt = "Sitegrade — know the day a website breaks";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 80,
          background: "#0f172a",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 64,
              height: 64,
              marginRight: 20,
              borderRadius: 16,
              background: "#4f46e5",
              fontSize: 36,
              fontWeight: 800,
            }}
          >
            S
          </div>
          <div style={{ display: "flex", fontSize: 36, fontWeight: 700 }}>
            Sitegrade
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 48,
            fontSize: 76,
            fontWeight: 800,
            letterSpacing: -2,
          }}
        >
          <div style={{ display: "flex" }}>Know the day a</div>
          <div style={{ display: "flex", marginTop: 8 }}>website breaks</div>
        </div>

        <div style={{ display: "flex", marginTop: 36, fontSize: 30, color: "#94a3b8" }}>
          {CHECK_COUNT} checks · free, no account · watched automatically
        </div>
      </div>
    ),
    size,
  );
}
