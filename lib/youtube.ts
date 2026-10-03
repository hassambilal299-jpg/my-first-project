/**
 * YouTube, direct. Used only when no transcript key is configured, which in
 * practice means running on a laptop.
 *
 * This will NOT work from a server. Verified against the live deployment:
 * mobile InnerTube clients answer HTTP 400 FAILED_PRECONDITION (they now
 * require device attestation), and the web client answers HTTP 200 with
 * "Sign in to confirm you're not a bot" because datacenter IPs are walled.
 * An earlier version of this file tried four client shapes to get around
 * that; none worked, so the table is gone. Production goes through
 * lib/transcript.ts instead.
 */

export class IngestError extends Error {
  readonly userMessage: string;
  constructor(userMessage: string) {
    super(userMessage);
    this.name = "IngestError";
    this.userMessage = userMessage;
  }
}

export interface VideoMeta {
  id: string;
  title: string;
  author: string;
  durationSeconds: number;
  thumbnail: string;
}

export interface Cue {
  start: number;
  end: number;
  text: string;
}

const MIN_DURATION = 60;
const MAX_DURATION = 4 * 60 * 60;

const INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const BLOCKED_MESSAGE =
  "This site can't reach YouTube directly - YouTube blocks servers from " +
  "doing that. It needs its transcript key set up. See the setup note above.";

export function parseVideoId(input: string): string {
  const raw = input.trim();
  if (!raw) throw new IngestError("Paste a YouTube link to get started.");

  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    throw new IngestError("That doesn't look like a YouTube link.");
  }

  const host = url.hostname.replace(/^www\.|^m\./, "");

  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    if (/^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
  }

  if (host === "youtube.com" || host === "music.youtube.com") {
    const v = url.searchParams.get("v");
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;

    const m = url.pathname.match(
      /^\/(?:embed|shorts|live|v)\/([a-zA-Z0-9_-]{11})/,
    );
    if (m) return m[1];
  }

  throw new IngestError("That doesn't look like a YouTube video link.");
}

/** Map YouTube's refusal to something a person can act on. The bot wall is
 *  checked first: its message is "Sign in to confirm you're not a bot",
 *  which contains the same "sign in to confirm" as the age gate. Matching
 *  age first would label every server block an age restriction. */
export function classifyMessage(status: string, reason: string): string {
  const text = `${status} ${reason}`.toLowerCase();

  if (
    text.includes("not a bot") ||
    text.includes("bot") ||
    text.includes("unusual traffic")
  ) {
    return BLOCKED_MESSAGE;
  }
  if (text.includes("private")) return "That video is private.";
  if (text.includes("members") || text.includes("join this channel")) {
    return "That video is members-only.";
  }
  if (text.includes("confirm your age") || text.includes("age_verification")) {
    return "That video is age-restricted, so its captions aren't readable.";
  }
  if (text.includes("country") || text.includes("not available in")) {
    return "That video is blocked in this region.";
  }
  if (text.includes("unavailable") || text.includes("removed")) {
    return "That video is unavailable or was removed.";
  }
  return BLOCKED_MESSAGE;
}

export async function probe(
  input: string,
): Promise<{ meta: VideoMeta; player: any }> {
  const videoId = parseVideoId(input);

  let res: Response;
  try {
    res = await fetch(
      `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}&prettyPrint=false`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": UA,
          "Accept-Language": "en-US,en;q=0.9",
        },
        body: JSON.stringify({
          // Nested under `context` - InnerTube answers a bare HTTP 400 if
          // the client object sits at the top level.
          context: {
            client: {
              clientName: "WEB",
              clientVersion: "2.20241202.01.00",
              hl: "en",
              gl: "US",
            },
          },
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
        cache: "no-store",
      },
    );
  } catch {
    throw new IngestError("Couldn't reach YouTube. Try again in a moment.");
  }

  if (!res.ok) {
    console.log(`[direct] HTTP ${res.status}`);
    throw new IngestError(BLOCKED_MESSAGE);
  }

  const player = await res.json().catch(() => null);
  if (!player) throw new IngestError(BLOCKED_MESSAGE);

  const status: string = player?.playabilityStatus?.status || "";
  const reason: string = player?.playabilityStatus?.reason || "";
  console.log(`[direct] status=${status || "none"} reason=${reason || "none"}`);

  if (status && status !== "OK") {
    throw new IngestError(classifyMessage(status, reason));
  }

  const details = player?.videoDetails;
  if (!details) throw new IngestError(BLOCKED_MESSAGE);
  if (details.isLive) {
    throw new IngestError("Live streams can't be clipped.");
  }

  const durationSeconds = Number(details.lengthSeconds || 0);
  if (!durationSeconds) {
    throw new IngestError("Couldn't read that video's length.");
  }
  if (durationSeconds < MIN_DURATION) {
    throw new IngestError("That video is under a minute - nothing to clip.");
  }
  if (durationSeconds > MAX_DURATION) {
    throw new IngestError("That video is over 4 hours. Try a shorter one.");
  }

  const thumbs = details.thumbnail?.thumbnails || [];

  return {
    meta: {
      id: details.videoId || videoId,
      title: details.title || "Untitled",
      author: details.author || "",
      durationSeconds,
      thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url : "",
    },
    player,
  };
}

function pickTrack(tracks: any[]): any | null {
  if (!tracks?.length) return null;
  const manual = tracks.filter((t) => t.kind !== "asr");
  const pool = manual.length ? manual : tracks;
  return (
    pool.find((t) => t.languageCode === "en") ||
    pool.find((t) => String(t.languageCode || "").startsWith("en")) ||
    pool[0]
  );
}

export async function getTranscript(player: any): Promise<Cue[]> {
  const track = pickTrack(
    player?.captions?.playerCaptionsTracklistRenderer?.captionTracks,
  );

  if (!track?.baseUrl) {
    throw new IngestError(
      "That video has no captions, so there's no transcript to read. " +
        "Try one with subtitles turned on.",
    );
  }

  const base = track.baseUrl.startsWith("http")
    ? track.baseUrl
    : `https://www.youtube.com${track.baseUrl}`;

  let res: Response;
  try {
    res = await fetch(`${base}${base.includes("?") ? "&" : "?"}fmt=json3`, {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
      cache: "no-store",
    });
  } catch {
    throw new IngestError("Couldn't download that video's captions.");
  }

  if (!res.ok) throw new IngestError(BLOCKED_MESSAGE);

  const data = await res.json().catch(() => null);
  if (!data) throw new IngestError("That video's captions couldn't be read.");

  const cues = parseJson3(data);
  if (!cues.length) {
    throw new IngestError("That video's caption track is empty.");
  }
  return cues;
}

/** YouTube's json3 caption format to a flat, non-overlapping cue list. */
export function parseJson3(data: any): Cue[] {
  const cues: Cue[] = [];

  for (const event of data?.events || []) {
    const segs = event?.segs;
    if (!segs?.length) continue;

    const base = (event.tStartMs || 0) / 1000;
    const dur = (event.dDurationMs || 0) / 1000;

    for (const seg of segs) {
      const text = String(seg?.utf8 ?? "").trim();
      if (!text) continue;
      cues.push({
        start: base + (seg.tOffsetMs || 0) / 1000,
        end: base + dur,
        text,
      });
    }
  }

  cues.sort((a, b) => a.start - b.start);

  for (let i = 0; i < cues.length - 1; i++) {
    cues[i].end = Math.min(cues[i].end, cues[i + 1].start);
  }

  return cues.filter((c) => c.end > c.start);
}

/** Collapse word-level cues into sentence-ish lines for the model. */
export function toTranscriptText(cues: Cue[], maxChars = 160000): string {
  const lines: string[] = [];
  let buffer: string[] = [];
  let bufferStart = cues[0]?.start ?? 0;
  let size = 0;

  const flush = () => {
    if (!buffer.length) return;
    const line = `[${bufferStart.toFixed(1)}] ${buffer.join(" ")}`;
    size += line.length;
    lines.push(line);
    buffer = [];
  };

  for (const cue of cues) {
    if (!buffer.length) bufferStart = cue.start;
    buffer.push(cue.text);
    if (buffer.join(" ").length > 120) flush();
    if (size > maxChars) break;
  }
  flush();

  return lines.join("\n");
}
