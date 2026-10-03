/**
 * Picking moments with no model and no API key.
 *
 * This is how clip tools worked before LLMs: score stretches of transcript on
 * signals you can measure. It is worse than a model at judging whether an idea
 * actually lands, and it cannot write a caption in the creator's voice. It is
 * genuinely good at the mechanical part - finding stretches that open on a
 * claim, do not depend on earlier context, and close on something.
 *
 * It exists so the site works with one free key instead of two keys and a card.
 * The signals it scores on live in ./signals.
 */

import type { Cue } from "./youtube";
import { overallScore, excerptFor, type Segment } from "./moments";
import {
  ENDER,
  HAS_NUMBER,
  CONTRAST_WORDS,
  HOOK_WORDS,
  PAYOFF_WORDS,
  BACK_REFERENCE,
  has,
  markHook,
  markPayoff,
  markStandalone,
  tagsFrom,
} from "./signals";

/* ------------------------------------------------------------------ tokens */

interface Token {
  text: string;
  start: number;
  end: number;
}

/**
 * Cue text to timed words. A cue's words are spread evenly across its own
 * duration - not exact, but the error is a fraction of a second and segment
 * edges land on sentence gaps anyway.
 */
export function tokenize(cues: Cue[]): Token[] {
  const tokens: Token[] = [];

  for (const cue of cues) {
    const words = cue.text.split(/\s+/).filter(Boolean);
    if (!words.length) continue;

    const span = Math.max(0.001, cue.end - cue.start);
    const per = span / words.length;

    words.forEach((w, i) => {
      tokens.push({
        text: w,
        start: cue.start + i * per,
        end: cue.start + (i + 1) * per,
      });
    });
  }

  return tokens;
}

/* --------------------------------------------------------------- sentences */

export interface Sentence {
  text: string;
  start: number;
  end: number;
  words: number;
}

/** Words per pseudo-sentence when the track has no punctuation at all. */
const CHUNK_WORDS = 14;

/**
 * Group words into sentences.
 *
 * YouTube's automatic captions often carry NO punctuation - no periods at all.
 * Splitting on enders alone would make one sentence of the whole video and
 * every candidate would be identical, so when enders are rare we fall back to
 * fixed word chunks. The threshold is per-word, not absolute, so it holds for
 * a two-minute video and a two-hour one alike.
 */
export function buildSentences(tokens: Token[]): Sentence[] {
  if (!tokens.length) return [];

  const enders = tokens.filter((t) => ENDER.test(t.text)).length;
  const punctuated = enders / tokens.length > 0.012;

  const out: Sentence[] = [];
  let buf: Token[] = [];

  const flush = () => {
    if (!buf.length) return;
    out.push({
      text: buf
        .map((t) => t.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
      start: buf[0].start,
      end: buf[buf.length - 1].end,
      words: buf.length,
    });
    buf = [];
  };

  for (const token of tokens) {
    buf.push(token);

    if (punctuated) {
      // Keep a runaway sentence from swallowing a whole paragraph.
      if (ENDER.test(token.text) || buf.length >= 45) flush();
    } else if (buf.length >= CHUNK_WORDS) {
      flush();
    }
  }
  flush();

  return out;
}

/* --------------------------------------------------------------- selection */

interface Candidate extends Segment {
  density: number;
}

function titleFrom(hook: string): string {
  const cleaned = hook.replace(/^[^A-Za-z0-9]+/, "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= 62) return cleaned.replace(/[.!?]+$/, "");

  const cut = cleaned.slice(0, 62);
  const space = cut.lastIndexOf(" ");
  return `${(space > 24 ? cut.slice(0, space) : cut).replace(/[.,;:]+$/, "")}…`;
}


/** Why this one, assembled from the signals that actually fired. */
function reasonFrom(first: string, last: string, whole: string): string {
  const f = first.toLowerCase();
  const parts: string[] = [];

  if (/\?\s*$/.test(first)) parts.push("opens on a question");
  else if (HAS_NUMBER.test(first)) parts.push("opens on a number");
  else if (has(f, HOOK_WORDS)) parts.push("opens on a claim");

  if (has(whole.toLowerCase().slice(first.length), CONTRAST_WORDS)) {
    parts.push("turns partway through");
  }
  if (has(last.toLowerCase(), PAYOFF_WORDS) || HAS_NUMBER.test(last)) {
    parts.push("closes on a result");
  }
  if (!has(whole.toLowerCase(), BACK_REFERENCE)) {
    parts.push("needs no setup from earlier");
  }

  if (!parts.length) return "The steadiest stretch in this part of the video.";

  const text = parts.join(", ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/**
 * One candidate per sentence: grow from that sentence until the window is
 * closest to the target length, stopping at maxLen. Windows therefore always
 * begin and end on a sentence boundary, which is the one thing a transcript
 * can tell us for certain.
 */
function buildCandidates(
  sentences: Sentence[],
  cues: Cue[],
  minLen: number,
  maxLen: number,
  target: number,
): Candidate[] {
  const out: Candidate[] = [];

  for (let i = 0; i < sentences.length; i++) {
    let best: { j: number; len: number } | null = null;

    for (let j = i; j < sentences.length; j++) {
      const len = sentences[j].end - sentences[i].start;
      if (len > maxLen) break;
      if (len < minLen) continue;

      if (!best || Math.abs(len - target) < Math.abs(best.len - target)) {
        best = { j, len };
      }
    }

    if (!best) continue;

    const picked = sentences.slice(i, best.j + 1);
    const first = picked[0].text;
    const last = picked[picked.length - 1].text;
    const whole = picked.map((s) => s.text).join(" ");

    const marks = {
      hook: markHook(first),
      standalone: markStandalone(first, whole),
      payoff: markPayoff(last, whole, first),
    };

    const words = picked.reduce((sum, s) => sum + s.words, 0);
    const start = picked[0].start;
    const end = picked[picked.length - 1].end;

    out.push({
      start: Math.round(start * 100) / 100,
      end: Math.round(end * 100) / 100,
      title: titleFrom(first),
      hook: first.slice(0, 200),
      reason: reasonFrom(first, last, whole),
      marks,
      score: overallScore(marks),
      // Without a model the honest caption is the speaker's own opening line.
      caption: first.replace(/\s+/g, " ").trim().slice(0, 280),
      hashtags: tagsFrom(whole),
      excerpt: excerptFor(cues, start, end),
      density: words / Math.max(1, end - start),
    });
  }

  return out;
}

/**
 * Pick n non-overlapping candidates spread across the video.
 *
 * Taking the global top n would cluster them: a strong three minutes of
 * transcript produces many overlapping strong windows. So the video is cut
 * into n zones and the best candidate is taken from each, which is what you
 * would want from a clip tool anyway - coverage, not a single hot patch.
 */
export function pickSpread(
  candidates: Candidate[],
  n: number,
  duration: number,
): Segment[] {
  const chosen: Candidate[] = [];
  const overlaps = (c: Candidate) =>
    chosen.some((x) => c.start < x.end && c.end > x.start);

  const zone = duration / n;

  for (let z = 0; z < n; z++) {
    const lo = z * zone;
    const hi = (z + 1) * zone;

    const pool = candidates
      .filter((c) => c.start >= lo && c.start < hi && !overlaps(c))
      .sort((a, b) => b.score - a.score || b.density - a.density);

    if (pool.length) chosen.push(pool[0]);
  }

  // Zones with nothing usable (silence, music, a gap in the captions) get
  // backfilled from whatever is left anywhere in the video.
  if (chosen.length < n) {
    const rest = candidates
      .filter((c) => !chosen.includes(c) && !overlaps(c))
      .sort((a, b) => b.score - a.score || b.density - a.density);

    for (const c of rest) {
      if (chosen.length >= n) break;
      if (overlaps(c)) continue;
      chosen.push(c);
    }
  }

  return chosen
    .sort((a, b) => a.start - b.start)
    .map(({ density, ...seg }) => seg);
}

export function selectByHeuristic(
  cues: Cue[],
  opts: { n: number; duration: number; minLen: number; maxLen: number; target: number },
): Segment[] {
  const sentences = buildSentences(tokenize(cues));
  if (!sentences.length) return [];

  const candidates = buildCandidates(
    sentences,
    cues,
    opts.minLen,
    opts.maxLen,
    opts.target,
  );
  if (!candidates.length) return [];

  return pickSpread(candidates, opts.n, opts.duration);
}
