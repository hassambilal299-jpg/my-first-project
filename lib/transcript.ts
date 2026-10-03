/**
 * Transcript provider.
 *
 * YouTube refuses this server directly: mobile InnerTube clients return
 * HTTP 400 FAILED_PRECONDITION (they now require device attestation), and
 * the web client returns "Sign in to confirm you're not a bot" because
 * Vercel runs on datacenter IPs. Both verified against the live deployment.
 *
 * So when TRANSCRIPT_API_KEY is set we fetch transcripts through Supadata,
 * which does the proxying. Without the key we fall back to talking to
 * YouTube directly, which works fine from a home connection.
 */

import type { Cue } from "./youtube";
import { IngestError, parseVideoId } from "./youtube";

const SUPADATA_ENDPOINT = "https://api.supadata.ai/v1/transcript";

export interface ProviderResult {
  cues: Cue[];
  /** Derived from the last cue — the provider doesn't return video length. */
  durationSeconds: number;
  videoId: string;
}

export function hasProvider(): boolean {
  return Boolean(process.env.TRANSCRIPT_API_KEY);
}

/** Supadata returns offset/duration in MILLISECONDS. */
interface SupadataChunk {
  text?: string;
  offset?: number;
  duration?: number;
  lang?: string;
}

function toCues(chunks: SupadataChunk[]): Cue[] {
  const cues: Cue[] = [];

  for (const chunk of chunks) {
    const text = String(chunk?.text ?? "").trim();
    if (!text) continue;

    const start = Number(chunk?.offset ?? 0) / 1000;
    const dur = Number(chunk?.duration ?? 0) / 1000;
    if (!Number.isFinite(start)) continue;

    cues.push({ start, end: start + (Number.isFinite(dur) ? dur : 0), text });
  }

  cues.sort((a, b) => a.start - b.start);

  // Tighten each cue against the next so nothing overlaps.
  for (let i = 0; i < cues.length - 1; i++) {
    cues[i].end = Math.min(cues[i].end, cues[i + 1].start);
  }

  return cues.filter((c) => c.end > c.start);
}

export async function fetchViaProvider(input: string): Promise<ProviderResult> {
  const apiKey = process.env.TRANSCRIPT_API_KEY;
  if (!apiKey) {
    throw new Error("TRANSCRIPT_API_KEY is not set on this deployment.");
  }

  const videoId = parseVideoId(input);
  const url = `${SUPADATA_ENDPOINT}?url=${encodeURIComponent(
    `https://www.youtube.com/watch?v=${videoId}`,
  )}&lang=en&text=false`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "x-api-key": apiKey },
      cache: "no-store",
    });
  } catch {
    throw new IngestError(
      "Couldn't reach the transcript service. Try again in a moment.",
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.log(`[provider] HTTP ${res.status} ${body.slice(0, 300)}`);

    if (res.status === 401 || res.status === 403) {
      throw new IngestError(
        "The transcript service rejected this site's key - it's wrong or " +
          "expired. See the setup note above.",
      );
    }
    if (res.status === 402 || res.status === 429) {
      throw new IngestError(
        "The transcript service is out of credits for this month, or is " +
          "rate-limiting. Check your plan, or try again shortly.",
      );
    }
    if (res.status === 404) {
      throw new IngestError(
        "No transcript available for that video. It likely has no captions.",
      );
    }
    throw new IngestError(
      "The transcript service couldn't read that video. Try another link.",
    );
  }

  const data = await res.json().catch(() => null);
  const content = data?.content;

  if (!Array.isArray(content) || !content.length) {
    throw new IngestError(
      "That video has no captions, so there's no transcript to read. " +
        "Try one with subtitles turned on.",
    );
  }

  const cues = toCues(content as SupadataChunk[]);
  if (!cues.length) {
    throw new IngestError("That video's caption track came back empty.");
  }

  return {
    cues,
    durationSeconds: Math.ceil(cues[cues.length - 1].end),
    videoId,
  };
}

/**
 * Title and channel via YouTube's public oEmbed endpoint. It is a plain
 * embed API, not the player, so it is not behind the bot wall. Metadata is
 * cosmetic here, so any failure degrades quietly rather than failing the run.
 */
export async function fetchMeta(
  videoId: string,
): Promise<{ title: string; author: string }> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(
        `https://www.youtube.com/watch?v=${videoId}`,
      )}&format=json`,
      { cache: "no-store" },
    );
    if (!res.ok) return { title: "", author: "" };

    const j = await res.json();
    return {
      title: String(j?.title || ""),
      author: String(j?.author_name || ""),
    };
  } catch {
    return { title: "", author: "" };
  }
}
