/**
 * Health check. GET /api/diag
 *
 * Says which keys are present and whether each upstream actually answers,
 * so a broken deployment can be diagnosed without guessing from the UI.
 * Never returns key values — only whether they are set.
 *
 * Optional: ?v=VIDEO_ID runs a live transcript fetch against that video.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const v = new URL(request.url).searchParams.get("v") || "";
  const out: Record<string, unknown> = {
    keys: {
      TRANSCRIPT_API_KEY: Boolean(process.env.TRANSCRIPT_API_KEY),
      ANTHROPIC_API_KEY: Boolean(process.env.ANTHROPIC_API_KEY),
    },
  };

  // oEmbed supplies the video title. It is a public embed API rather than
  // the player, so it should not be behind the bot wall - worth confirming.
  try {
    const res = await fetch(
      "https://www.youtube.com/oembed?url=" +
        encodeURIComponent("https://www.youtube.com/watch?v=dQw4w9WgXcQ") +
        "&format=json",
      { cache: "no-store" },
    );
    const text = await res.text();
    out.oembed = {
      http: res.status,
      ok: res.ok,
      sample: text.slice(0, 160),
    };
  } catch (e) {
    out.oembed = { threw: e instanceof Error ? e.message : String(e) };
  }

  if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) {
    const key = process.env.TRANSCRIPT_API_KEY;
    if (!key) {
      out.transcript = { skipped: "no TRANSCRIPT_API_KEY set" };
    } else {
      try {
        const res = await fetch(
          "https://api.supadata.ai/v1/transcript?url=" +
            encodeURIComponent(`https://www.youtube.com/watch?v=${v}`) +
            "&lang=en&text=false",
          { headers: { "x-api-key": key }, cache: "no-store" },
        );

        const text = await res.text();
        if (!res.ok) {
          out.transcript = { http: res.status, errorBody: text.slice(0, 400) };
        } else {
          const j = JSON.parse(text);
          const content = Array.isArray(j?.content) ? j.content : [];
          const last = content[content.length - 1];
          out.transcript = {
            http: res.status,
            chunks: content.length,
            lang: j?.lang,
            availableLangs: j?.availableLangs?.slice(0, 8),
            firstText: content[0]?.text,
            // offset/duration are milliseconds per Supadata's docs.
            approxDurationSeconds: last
              ? Math.ceil((Number(last.offset || 0) + Number(last.duration || 0)) / 1000)
              : null,
          };
        }
      } catch (e) {
        out.transcript = { threw: e instanceof Error ? e.message : String(e) };
      }
    }
  }

  return NextResponse.json(out, { status: 200 });
}
