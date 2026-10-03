import Anthropic from "@anthropic-ai/sdk";
import type { Cue } from "./youtube";

const MODEL = "claude-sonnet-4-5";

export interface Segment {
  start: number;
  end: number;
  title: string;
  hook: string;
  reason: string;
  /** 0-100. How likely this stands alone and holds attention. */
  score: number;
  /** The three things the score is made of, each 0-100. */
  marks: { hook: number; standalone: number; payoff: number };
  /** Ready to paste when posting. */
  caption: string;
  hashtags: string[];
  /** Filled in server-side from the transcript, not by the model. */
  excerpt?: string;
}

const NICHE_GUIDANCE = `
A good clip stands on its own. It makes sense to someone who has not watched
the rest of the video, opens on a hook within the first two seconds - a claim,
a number, a question, a contradiction - and resolves rather than trailing off.
No setup that depends on earlier context.
`.trim();

function buildPrompt(
  transcript: string,
  n: number,
  minLen: number,
  maxLen: number,
  target: number,
): string {
  return `You are selecting short-form clips from a long video transcript.

${NICHE_GUIDANCE}

The transcript below is timestamped in seconds. Select exactly ${n} segments.

Length rules:
- Aim for about ${target} seconds per segment. Never shorter than ${minLen}
  seconds or longer than ${maxLen}.
- A complete thought at ${target} seconds beats a padded one. If the idea
  finishes early, end the clip there rather than running on.
- Start and end on sentence boundaries. Never cut mid-word.
- Segments must not overlap.
- Spread them across the video; do not take all ${n} from one stretch.

Score each segment honestly, 0-100, on three marks:
- hook: does the first sentence stop a scroll on its own?
- standalone: does it make sense with zero context from the rest?
- payoff: does it land something before it ends?
Use the whole range. A mediocre clip should score in the 40s. Do not give
everything 80+; the point of the score is to rank them against each other.

Also write, for each segment:
- caption: one or two lines to post with the clip. Written as the creator,
  in their voice, not a description of the clip. No emoji unless the
  speaker's own tone invites it.
- hashtags: 3 to 5, lowercase, no '#' character, specific to the topic
  rather than generic reach tags.

Return ONLY a JSON array, no prose:
[{"start": 123.4, "end": 168.2,
  "title": "short punchy title",
  "hook": "the opening line, verbatim",
  "reason": "why this one works, one sentence",
  "marks": {"hook": 82, "standalone": 90, "payoff": 74},
  "caption": "the line to post with it",
  "hashtags": ["onboarding", "saas", "churn"]}]

TRANSCRIPT:
${transcript}`;
}

export function extractJson(raw: string): string {
  let text = raw.trim();
  if (text.startsWith("```")) {
    const parts = text.split("```");
    if (parts.length > 1) {
      text = parts[1].replace(/^json\s*/i, "");
    }
  }
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1) {
    throw new Error("Model did not return a JSON array");
  }
  return text.slice(start, end + 1);
}

function clampMark(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** The headline score is the mean of the three marks, hook weighted highest
 *  because a clip nobody stops for scores zero in practice. */
export function overallScore(marks: {
  hook: number;
  standalone: number;
  payoff: number;
}): number {
  return Math.round(
    marks.hook * 0.45 + marks.standalone * 0.3 + marks.payoff * 0.25,
  );
}

export function sanitise(
  raw: unknown,
  opts: { n: number; minLen: number; maxLen: number; duration: number },
): Segment[] {
  const { n, minLen, maxLen, duration } = opts;
  if (!Array.isArray(raw)) return [];

  const taken: Array<[number, number]> = [];
  const clean: Segment[] = [];

  for (const item of raw) {
    const s = Number((item as any)?.start);
    const e = Number((item as any)?.end);
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;

    const start = Math.max(0, s);
    let end = Math.min(duration, e);

    if (end - start < minLen) end = Math.min(duration, start + minLen);
    if (end - start > maxLen) end = start + maxLen;
    if (end - start < minLen) continue;
    if (start >= duration) continue;

    if (taken.some(([ts, te]) => start < te && end > ts)) continue;
    taken.push([start, end]);

    const rawMarks = (item as any)?.marks || {};
    const marks = {
      hook: clampMark(rawMarks.hook),
      standalone: clampMark(rawMarks.standalone),
      payoff: clampMark(rawMarks.payoff),
    };

    const tags = Array.isArray((item as any)?.hashtags)
      ? (item as any).hashtags
          .map((t: unknown) =>
            String(t).replace(/^#/, "").trim().toLowerCase().slice(0, 30),
          )
          .filter(Boolean)
          .slice(0, 5)
      : [];

    clean.push({
      start: Math.round(start * 100) / 100,
      end: Math.round(end * 100) / 100,
      title: String((item as any)?.title || "Clip").slice(0, 80),
      hook: String((item as any)?.hook || "").slice(0, 200),
      reason: String((item as any)?.reason || "").slice(0, 300),
      marks,
      score: overallScore(marks),
      caption: String((item as any)?.caption || "").slice(0, 300),
      hashtags: tags,
    });
  }

  clean.sort((a, b) => a.start - b.start);
  return clean.slice(0, n);
}

/** Turn a target clip length into the window the model may work inside. */
export function lengthWindow(target: number): {
  minLen: number;
  maxLen: number;
} {
  return {
    minLen: Math.max(8, Math.round(target * 0.8)),
    maxLen: Math.round(target * 1.3),
  };
}

/** Which picker produced a set of segments. Surfaced to the UI so nobody is
 *  told a heuristic's guess came from a model. */
export type Picker = "model" | "signals";

export async function selectMoments(
  cues: Cue[],
  transcript: string,
  opts: { n: number; duration: number; target?: number },
): Promise<{ segments: Segment[]; picker: Picker }> {
  const target = opts.target ?? 30;
  const { minLen, maxLen } = lengthWindow(target);

  const apiKey = process.env.ANTHROPIC_API_KEY;

  // No model key: score the transcript on measurable signals instead. Worse
  // picks, no captions in the creator's voice, but it costs nothing and needs
  // no second account - so the site is useful with one free key.
  if (!apiKey) {
    const { selectByHeuristic } = await import("./heuristic");
    return {
      segments: selectByHeuristic(cues, {
        n: opts.n,
        duration: opts.duration,
        minLen,
        maxLen,
        target,
      }),
      picker: "signals",
    };
  }

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: MODEL,
    // Captions and hashtags per clip need more room than timecodes alone.
    max_tokens: 4000,
    messages: [
      {
        role: "user",
        content: buildPrompt(transcript, opts.n, minLen, maxLen, target),
      },
    ],
  });

  const block = message.content[0];
  const text = block?.type === "text" ? block.text : "";
  const parsed = JSON.parse(extractJson(text));

  const segments = sanitise(parsed, {
    n: opts.n,
    minLen,
    maxLen,
    duration: opts.duration,
  });

  // Attach what is actually said, straight from the transcript. Free, and
  // it keeps the model from paraphrasing the source.
  for (const seg of segments) {
    seg.excerpt = excerptFor(cues, seg.start, seg.end);
  }

  return { segments, picker: "model" };
}

/** The spoken words inside a segment, joined into readable text. */
export function excerptFor(
  cues: Cue[],
  start: number,
  end: number,
  maxChars = 600,
): string {
  const words: string[] = [];
  for (const cue of cues) {
    if (cue.end <= start || cue.start >= end) continue;
    words.push(cue.text);
    if (words.join(" ").length > maxChars) break;
  }
  const text = words.join(" ").replace(/\s+/g, " ").trim();
  return text.length > maxChars ? `${text.slice(0, maxChars).trim()}…` : text;
}

export function cuesForSegment(cues: Cue[], start: number, end: number): Cue[] {
  const out: Cue[] = [];
  for (const cue of cues) {
    if (cue.end <= start || cue.start >= end) continue;
    out.push({
      start: Math.max(0, cue.start - start),
      end: Math.min(end - start, cue.end - start),
      text: cue.text,
    });
  }
  return out;
}
