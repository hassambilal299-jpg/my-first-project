/**
 * The measurable signals a transcript gives up.
 *
 * Word lists and the three marks live here, apart from the windowing and
 * selection in ./heuristic, because this is the part worth arguing about: the
 * lists are judgement calls and every one of them is a guess about how people
 * speak. Keeping them in one file makes them easy to read, test and revise
 * without touching the mechanics.
 */

export const ENDER = /[.!?]["')\]]?$/;
export const HOOK_WORDS = [
  "actually", "turns out", "the problem", "the truth", "nobody",
  "everybody", "everyone", "mistake", "wrong", "secret", "never",
  "always", "worst", "best", "biggest", "realised", "realized",
  "discovered", "surprised", "shocking", "failed", "lost", "cost",
  "the reason", "here's why", "heres why", "the trick", "the catch",
];

export const CONTRAST_WORDS = [
  "but", "however", "except", "instead", "although", "though",
  "turns out", "actually", "in fact", "the problem",
];

export const PAYOFF_WORDS = [
  "so", "which means", "the result", "that's why", "thats why",
  "in the end", "ended up", "it worked", "and now", "the lesson",
  "what changed", "fixed", "solved", "doubled", "halved", "grew",
];

/** Openers that mark a continuation of something already being said. */
const FILLER_OPENERS = [
  "so", "and", "but", "also", "um", "uh", "yeah", "right", "okay",
  "ok", "well", "anyway", "then", "plus", "because", "which", "that",
];

/** Phrases that point at something outside the clip. */
export const BACK_REFERENCE = [
  "as i said", "as i mentioned", "like i said", "like i mentioned",
  "earlier", "before that", "back to", "as we saw", "that one",
  "this one", "the one i", "going back", "remember when",
  "last time", "previously", "the thing i",
];

/** Bare pronouns opening a clip have nothing to refer to. */
const DANGLING_OPENERS = [
  "it", "this", "that", "they", "them", "these", "those",
  "he", "she", "his", "her", "its", "their",
];

export const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "so", "of", "to",
  "in", "on", "at", "for", "with", "from", "by", "as", "is", "are",
  "was", "were", "be", "been", "being", "do", "does", "did", "have",
  "has", "had", "i", "you", "he", "she", "it", "we", "they", "me",
  "him", "her", "us", "them", "my", "your", "his", "its", "our",
  "their", "this", "that", "these", "those", "what", "which", "who",
  "when", "where", "why", "how", "all", "any", "both", "each", "few",
  "more", "most", "some", "such", "no", "nor", "not", "only", "own",
  "same", "than", "too", "very", "can", "will", "just", "should",
  "now", "would", "could", "about", "there", "here", "like", "get",
  "got", "going", "really", "actually", "thing", "things", "know",
  "think", "said", "say", "says", "want", "make", "made", "one",
  "two", "lot", "kind", "sort", "sure", "right", "okay", "yeah",
  "gonna", "wanna", "its", "youre", "thats", "dont", "didnt", "im",
  "ive", "were", "weve", "theyre",
]);

/**
 * Whole-word phrase match.
 *
 * Plain `includes` is wrong here and quietly so: "so" is in PAYOFF_WORDS, and
 * `includes("so")` fires on "also", "reason" and "person", which scored a
 * trailing-off line exactly as high as one that landed. Everything in these
 * lists is a word or phrase, so every lookup goes through word boundaries.
 */
const wordRe = new Map<string, RegExp>();

export function has(text: string, list: string[]): boolean {
  return list.some((phrase) => {
    let re = wordRe.get(phrase);
    if (!re) {
      re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      wordRe.set(phrase, re);
    }
    return re.test(text);
  });
}

/**
 * Words a finished sentence does not end on. A clip that ends on one of these
 * ends mid-clause, which sounds like the audio was cut off.
 */
const TRAILING_WORDS = [
  "and", "but", "so", "because", "which", "that", "the", "a", "an",
  "to", "of", "with", "for", "from", "in", "on", "at", "by", "or",
  "also", "about", "like", "into", "than", "then", "as", "if", "is",
  "was", "were", "are", "had", "has", "have", "we", "they", "it",
  "you", "i", "he", "she", "my", "our", "their", "this", "these",
];

function lastWord(text: string): string {
  const words = text.trim().toLowerCase().replace(/[.!?,;:"')\]]+$/, "").split(/\s+/);
  return (words[words.length - 1] || "").replace(/\W/g, "");
}

function firstWord(text: string): string {
  return (text.trim().split(/\s+/)[0] || "").toLowerCase().replace(/\W/g, "");
}

export const HAS_NUMBER = /\b\d+([.,]\d+)?%?\b|\b(percent|per cent|thousand|million|billion|x)\b/i;

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Does the first line stop a scroll on its own? */
export function markHook(first: string): number {
  const t = first.toLowerCase();
  let score = 46;

  if (/\?\s*$/.test(first)) score += 14;
  if (HAS_NUMBER.test(first)) score += 13;
  if (has(t, HOOK_WORDS)) score += 15;

  // A short opener reads as a claim; a long one reads as a preamble.
  const words = t.split(/\s+/).length;
  if (words <= 14) score += 8;
  else if (words >= 30) score -= 10;

  if (FILLER_OPENERS.includes(firstWord(t))) score -= 13;
  if (DANGLING_OPENERS.includes(firstWord(t))) score -= 9;

  return clamp(score);
}

/** Does it make sense with zero context from the rest of the video? */
export function markStandalone(first: string, whole: string): number {
  const f = first.toLowerCase();
  const w = whole.toLowerCase();
  let score = 62;

  if (has(w, BACK_REFERENCE)) score -= 22;
  if (DANGLING_OPENERS.includes(firstWord(f))) score -= 16;
  if (FILLER_OPENERS.includes(firstWord(f))) score -= 8;

  // A proper noun or a figure gives the listener something concrete to hold.
  if (HAS_NUMBER.test(whole)) score += 7;
  if (/\b[A-Z][a-z]{2,}\b/.test(whole.slice(1))) score += 6;

  return clamp(score);
}

/** Does it land something before it ends? */
export function markPayoff(last: string, whole: string, first: string): number {
  const l = last.toLowerCase();
  const w = whole.toLowerCase();
  let score = 48;

  if (has(l, PAYOFF_WORDS)) score += 14;
  if (HAS_NUMBER.test(last)) score += 10;

  // Setup then turn: a contrast after the opening line is the shape of a
  // point being made rather than a list being read out.
  if (has(w.slice(first.length), CONTRAST_WORDS)) score += 12;

  // A question at the end leaves it hanging.
  if (/\?\s*$/.test(last)) score -= 12;

  // So does ending mid-clause. Unpunctuated auto-captions are chunked by word
  // count, so this is the common case, not the rare one: the chunk boundary
  // falls wherever it falls and most of them land mid-sentence.
  if (/[,;:]\s*$/.test(last)) score -= 10;

  // Only when the line has no terminal punctuation. "That fixed it." ends on
  // a pronoun and is a complete sentence; penalising it would mark a clean
  // close as a cut-off one, and most real closes end on a short word.
  if (!ENDER.test(last.trim()) && TRAILING_WORDS.includes(lastWord(last))) {
    score -= 16;
  }

  return clamp(score);
}

/** Topic words for hashtags: the most repeated content words in a clip. */
export function tagsFrom(text: string, max = 4): string[] {
  const counts = new Map<string, number>();

  for (const raw of text.toLowerCase().split(/[^a-z0-9']+/)) {
    const word = raw.replace(/'/g, "");
    if (word.length < 4 || STOPWORDS.has(word)) continue;
    if (/^\d+$/.test(word)) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([w]) => w);
}
