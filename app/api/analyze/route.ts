import { NextResponse } from "next/server";
import {
  IngestError,
  getTranscript,
  probe,
  toTranscriptText,
  parseVideoId,
  type Cue,
} from "@/lib/youtube";
import { fetchMeta, fetchViaProvider, hasProvider } from "@/lib/transcript";
import { selectMoments } from "@/lib/moments";
import type { AnalyzeResult } from "@/lib/sample";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED_COUNTS = [2, 4, 6];
const ALLOWED_LENGTHS = [15, 25, 30];

/** Vercel sets this on every deployment. Locally it's undefined, and the
 *  direct-to-YouTube path still works from a home connection. */
const DEPLOYED = Boolean(process.env.VERCEL);

/** Shown when the deployment has no transcript key - the one thing it cannot
 *  work without. Deliberately says nothing about YouTube blocking servers or
 *  about variable names; nothing a visitor could act on. The owner's step
 *  lives in the banner on the page. */
const NOT_SET_UP =
  "Clipper isn't finished being set up, so it can't read videos yet. " +
  "The step to finish it is listed just below.";

function buildDensity(
  cues: Cue[],
  duration: number,
  buckets = 60,
): number[] {
  const counts = new Array(buckets).fill(0);

  for (const cue of cues) {
    const idx = Math.min(
      buckets - 1,
      Math.max(0, Math.floor((cue.start / duration) * buckets)),
    );
    counts[idx] += cue.text.length;
  }

  const max = Math.max(...counts, 1);
  return counts.map((c) => Math.max(0.12, Math.min(1, c / max)));
}

/**
 * Get the transcript, preferring the proxied provider.
 *
 * YouTube blocks this server directly (verified: FAILED_PRECONDITION on
 * mobile clients, bot wall on web), so the provider is the real path in
 * production. The direct path stays for running locally, where a home IP
 * works fine and costs nothing.
 */
async function gather(url: string): Promise<{
  cues: Cue[];
  id: string;
  title: string;
  author: string;
  durationSeconds: number;
  thumbnail: string;
}> {
  if (hasProvider()) {
    const { cues, durationSeconds, videoId } = await fetchViaProvider(url);
    const meta = await fetchMeta(videoId);

    return {
      cues,
      id: videoId,
      title: meta.title || "Your video",
      author: meta.author,
      durationSeconds,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    };
  }

  // No provider key. On a deployment that is simply not set up yet, so say
  // that rather than letting YouTube's bot wall answer for us: its refusal
  // reads like a fault in the site, and there is nothing a visitor can do
  // about it either way.
  if (DEPLOYED) throw new IngestError(NOT_SET_UP);

  // Local: a home connection reaches YouTube fine.
  const { meta, player } = await probe(url);
  return {
    cues: await getTranscript(player),
    id: meta.id,
    title: meta.title,
    author: meta.author,
    durationSeconds: meta.durationSeconds,
    thumbnail: meta.thumbnail,
  };
}

export async function POST(request: Request) {
  let body: { url?: string; count?: number; length?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }

  const count = Number(body.count ?? 4);
  if (!ALLOWED_COUNTS.includes(count)) {
    return NextResponse.json(
      { error: "Pick 2, 4 or 6 clips." },
      { status: 400 },
    );
  }

  const length = Number(body.length ?? 30);
  if (!ALLOWED_LENGTHS.includes(length)) {
    return NextResponse.json(
      { error: "Pick a clip length of 15, 25 or 30 seconds." },
      { status: 400 },
    );
  }

  const url = String(body.url ?? "");

  try {
    // Validate the link shape before spending a provider credit.
    parseVideoId(url);

    const video = await gather(url);

    if (video.durationSeconds < 60) {
      return NextResponse.json(
        { error: "That video is under a minute — nothing to clip." },
        { status: 400 },
      );
    }

    const { segments, picker } = await selectMoments(
      video.cues,
      toTranscriptText(video.cues),
      { n: count, duration: video.durationSeconds, target: length },
    );

    if (!segments.length) {
      return NextResponse.json(
        { error: "Couldn't find clean moments in that video. Try another." },
        { status: 422 },
      );
    }

    const result: AnalyzeResult = {
      video: {
        id: video.id,
        title: video.title,
        author: video.author,
        durationSeconds: video.durationSeconds,
        thumbnail: video.thumbnail,
      },
      segments,
      density: buildDensity(video.cues, video.durationSeconds),
      picker,
    };

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof IngestError) {
      return NextResponse.json({ error: err.userMessage }, { status: 400 });
    }

    const message = err instanceof Error ? err.message : "";

    if (message.includes("TRANSCRIPT_API_KEY")) {
      return NextResponse.json({ error: NOT_SET_UP }, { status: 503 });
    }

    // A model key that is present but rejected. Not the same as not being set
    // up, so it gets its own message rather than pointing at the wrong step.
    if (/401|403|authentication|invalid[_ ]?api[_ ]?key|credit/i.test(message)) {
      return NextResponse.json(
        {
          error:
            "The model key on this site was rejected - it's wrong, expired, " +
            "or out of credit. Remove it to fall back to the free picker.",
        },
        { status: 503 },
      );
    }

    if (/rate|429|overloaded/i.test(message)) {
      return NextResponse.json(
        { error: "The model is busy right now. Try again in a moment." },
        { status: 503 },
      );
    }

    console.error("analyze failed:", err);
    return NextResponse.json(
      { error: "Something broke while reading that video. Try again." },
      { status: 500 },
    );
  }
}
