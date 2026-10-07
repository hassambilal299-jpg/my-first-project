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
  /** Seconds of silence immediately before this word. */
  gapBefore: number;
}

/**
 * Cue text to timed words. A cue's words are spread evenly across its own
 * duration - not exact, but the error is a fraction of a second and segment
 * edges land on sentence gaps anyway.
 *
 * The gap between one cue's end and the next cue's start is kept, because on a
 * track with no punctuation it is the only sentence boundary left.
 */
export function tokenize(cues: Cue[]): Token[] {
  const tokens: Token[] = [];
  let prevEnd: number | null = null;

  for (const cue of cues) {
    const words = cue.text.split(/\s+/).filter(Boolean);
    if (!words.length) continue;

    const span = Math.max(0.001, cue.end - cue.start);
    const per = span / words.length;
    const gap = prevEnd === null ? 0 : Math.max(0, cue.start - prevEnd);

    words.forEach((w, i) => {
      tokens.push({
        text: w,
        start: cue.start + i * per,
        end: cue.start + (i + 1) * per,
        gapBefore: i === 0 ? gap : 0,
      });
    });

    prevEnd = cue.end;
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

export interface Track {
  sentences: Sentence[];
  /** Whether the caption track carries sentence punctuation at all. */
  punctuated: boolean;
}

/** Hard cap on a pseudo-sentence when no pause arrives to end one. */
const CHUNK_WORDS = 18;

/** A pause this long reads as the end of a thought rather than a breath. */
const PAUSE = 0.5;

/** Below this, honouring a pause would leave a fragment too short to open on. */
const MIN_CHUNK_WORDS = 5;

/**
 * Group words into sentences.
 *
 * YouTube's automatic captions usually carry NO punctuation - no periods at
 * all - and splitting on enders alone would make one sentence of the whole
 * video. The first version fell back to fixed 14-word chunks, which is why
 * every clip on an auto-captioned video began mid-clause: measured on a
 * realistic track, pseudo-sentences came out as "been our north star for two
 * years it turned out we were measuring the". Chunk boundaries fall wherever
 * the counter lands.
 *
 * Speech has one boundary left that survives the loss of punctuation: the
 * speaker stopping. So an unpunctuated track is cut at pauses, and the word
 * count is only the fallback for a stretch with no pause in it.
 */
export function buildSentences(tokens: Token[]): Track {
  if (!tokens.length) return { sentences: [], punctuated: false };

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

  /**
   * A pause has arrived but the buffer holds only a scrap - the tail of a
   * sentence the word cap cut in half. That scrap belongs to the sentence it
   * came from, not to the one about to start, so give it back rather than
   * letting it push the next clip's opening line off the front.
   */
  const giveBack = () => {
    const prev = out[out.length - 1];
    if (!prev || !buf.length) return flush();
    prev.text = `${prev.text} ${buf.map((t) => t.text).join(" ")}`
      .replace(/\s+/g, " ")
      .trim();
    prev.end = buf[buf.length - 1].end;
    prev.words += buf.length;
    buf = [];
  };

  for (const token of tokens) {
    // A pause belongs before this word, so close the previous sentence first.
    if (!punctuated && token.gapBefore >= PAUSE) {
      if (buf.length >= MIN_CHUNK_WORDS) flush();
      else if (buf.length) giveBack();
    }

    buf.push(token);

    if (punctuated) {
      // Keep a runaway sentence from swallowing a whole paragraph.
      if (ENDER.test(token.text) || buf.length >= 45) flush();
    } else if (buf.length >= CHUNK_WORDS) {
      flush();
    }
  }
  flush();

  return { sentences: out, punctuated };
}


/* --------------------------------------------------------------- selection */

interface Candidate extends Segment {
  density: number;
}

/** Leading words that are throat-clearing rather than part of the claim. */
const LEADING_FILLER =
  /^(?:so|and|but|also|well|okay|ok|um|uh|yeah|right|anyway|then|plus|because|like|i mean|you know)\s+/i;

/** Where a sentence's main clause gives way to its tail. */
const CLAUSE_BREAK = /,|\s+(?:and|but|so|because|which|that|while|although|though|however)\s+/i;

/**
 * A short label for the clip, not the opening line verbatim.
 *
 * The first version returned the first sentence trimmed to 62 characters, with
 * the result that the card printed the same sentence three times - as the
 * title, as the hook quote under it, and again in the caption block. A title
 * is a different job: cut the claim out of the sentence, drop the tail, and
 * capitalise it, which also matters because auto-caption text arrives entirely
 * in lower case.
 */
function titleFrom(hook: string): string {
  let text = hook
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(LEADING_FILLER, "");

  // Keep the main clause when dropping the tail still leaves something whole.
  const breakAt = text.search(CLAUSE_BREAK);
  if (breakAt >= 24) text = text.slice(0, breakAt);

  text = text.replace(/[.,;:!?]+$/, "").trim();

  if (text.length > 58) {
    const cut = text.slice(0, 58);
    const space = cut.lastIndexOf(" ");
    text = `${space > 24 ? cut.slice(0, space) : cut}…`;
  }

  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The line to post with the clip.
 *
 * Without a model there is no writing it in the creator's voice, so it stays
 * the speaker's own words - but the opening line alone is exactly what the hook
 * field already shows. Pairing the opening with the line the clip closes on
 * reads like a real post and says something the hook does not.
 */
function captionFrom(first: string, last: string): string {
  const open = first.replace(/\s+/g, " ").trim();
  const close = last.replace(/\s+/g, " ").trim();

  if (!close || close === open || open.includes(close)) {
    return open.slice(0, 280);
  }
  return `${open}\n\n${close}`.slice(0, 280);
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
  punctuated: boolean,
  corpusText: string,
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

    // The closing stretch, not just the final sentence: a point often lands a
    // sentence before the clip stops.
    const tail = picked
      .slice(Math.max(0, picked.length - Math.max(1, Math.ceil(picked.length / 3))))
      .map((s) => s.text)
      .join(" ");

    const marks = {
      hook: markHook(first),
      standalone: markStandalone(first, whole),
      payoff: markPayoff(last, tail, whole, first, punctuated),
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
      caption: captionFrom(first, last),
      hashtags: tagsFrom(whole, corpusText),
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
  const { sentences, punctuated } = buildSentences(tokenize(cues));
  if (!sentences.length) return [];

  // The whole transcript, so hashtags can tell a clip's topic apart from the
  // speaker's habitual vocabulary.
  const corpusText = sentences.map((s) => s.text).join(" ");

  const candidates = buildCandidates(
    sentences,
    cues,
    punctuated,
    corpusText,
    opts.minLen,
    opts.maxLen,
    opts.target,
  );
  if (!candidates.length) return [];

  return pickSpread(candidates, opts.n, opts.duration);
}
