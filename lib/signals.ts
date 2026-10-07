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

/**
 * Why the bases are low and the steps are large.
 *
 * The first version started each mark near 50 and nudged by 6-15. Measured over
 * 52 candidates, payoff came out 48 for more than half of them and every
 * overall score landed between 33 and 71 - so the UI's four-bar meter lit three
 * bars on every clip and "Best first" was close to random. A score only earns
 * its place if it separates clips, so a clip with no signal now lands in the
 * 20s-30s and one with several lands in the 80s, which also matches what the
 * model prompt asks of the model ("a mediocre clip should score in the 40s").
 */

/** Does the first line stop a scroll on its own? */
export function markHook(first: string): number {
  const t = first.toLowerCase();
  let score = 30;

  if (/\?\s*$/.test(first)) score += 18;
  if (HAS_NUMBER.test(first)) score += 16;
  if (has(t, HOOK_WORDS)) score += 18;

  // A short opener reads as a claim; a long one reads as a preamble.
  const words = t.split(/\s+/).length;
  if (words <= 14) score += 10;
  else if (words >= 30) score -= 12;

  if (FILLER_OPENERS.includes(firstWord(t))) score -= 16;
  if (DANGLING_OPENERS.includes(firstWord(t))) score -= 12;

  return clamp(score);
}

/** A capitalised word that is NOT just the start of a sentence.
 *
 *  The first version tested `/\b[A-Z][a-z]{2,}\b/` against `whole.slice(1)`,
 *  meaning to skip the opening capital. But `whole` is several sentences
 *  joined, so every later sentence's first word still matched and the bonus
 *  fired on essentially every punctuated clip. Proper nouns have to be found
 *  away from a sentence start to mean anything. */
function hasProperNoun(whole: string): boolean {
  return /[a-z,]\s+[A-Z][a-z]{2,}/.test(whole);
}

/** Does it make sense with zero context from the rest of the video? */
export function markStandalone(first: string, whole: string): number {
  const f = first.toLowerCase();
  const w = whole.toLowerCase();
  let score = 58;

  if (has(w, BACK_REFERENCE)) score -= 28;
  if (DANGLING_OPENERS.includes(firstWord(f))) score -= 20;
  if (FILLER_OPENERS.includes(firstWord(f))) score -= 10;

  // A figure or a name gives the listener something concrete to hold.
  if (HAS_NUMBER.test(whole)) score += 12;
  if (hasProperNoun(whole)) score += 10;

  return clamp(score);
}

/**
 * Does it land something before it ends?
 *
 * `tail` is the closing stretch rather than only the final sentence: a point
 * often lands one sentence before the clip stops, and scoring the last
 * sentence alone was why this mark sat at its base value for most candidates.
 *
 * `punctuated` says whether the caption track has sentence punctuation at all.
 * Without it there is no such thing as a clean terminal mark, so neither the
 * bonus for ending on one nor the penalty for ending mid-clause is evidence of
 * anything - applying them anyway marked down every clip of every
 * auto-captioned video, which is most videos.
 */
export function markPayoff(
  last: string,
  tail: string,
  whole: string,
  first: string,
  punctuated: boolean,
): number {
  const l = last.toLowerCase();
  const t = tail.toLowerCase();
  const w = whole.toLowerCase();
  let score = 32;

  if (has(t, PAYOFF_WORDS)) score += 18;
  if (HAS_NUMBER.test(tail)) score += 14;

  // Setup then turn: a contrast after the opening line is the shape of a
  // point being made rather than a list being read out.
  if (has(w.slice(first.length), CONTRAST_WORDS)) score += 12;

  // A question at the end leaves it hanging.
  if (/\?\s*$/.test(last)) score -= 14;

  if (punctuated) {
    if (ENDER.test(last.trim())) score += 10;
    else if (TRAILING_WORDS.includes(lastWord(last))) score -= 18;
    if (/[,;:]\s*$/.test(last)) score -= 12;
  }

  return clamp(score);
}


/**
 * Words that are common in speech but say nothing about the topic. Separate
 * from STOPWORDS, which exists to stop grammar words being counted at all;
 * these are content-shaped words that still make a useless hashtag.
 */
const NOT_A_TOPIC = new Set([
  "anything", "everything", "something", "nothing", "anyone", "everybody",
  "again", "asked", "asking", "answer", "about", "after", "before",
  "being", "better", "called", "couple", "coming", "doing", "every",
  "first", "going", "happen", "happened", "having", "least", "little",
  "looking", "maybe", "mean", "means", "meant", "moment", "never",
  "other", "others", "person", "place", "point", "probably", "putting",
  "saying", "second", "seems", "simply", "start", "started", "still",
  "stuff", "taking", "talk", "talking", "tell", "telling", "thought",
  "three", "times", "trying", "turned", "understand", "using", "whole",
  "working", "would", "years", "basically", "literally", "obviously",
  "honestly", "exactly", "where", "which", "while", "whether", "because",
  "there", "these", "those", "their",
  // Numbers written out: they pass the length test and read as topics.
  "eleven", "twelve", "thirteen", "fifteen", "twenty", "thirty", "forty",
  "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "thousand",
  "million", "billion", "percent", "dozen",
  // Months and weekdays: concentrated in one clip by definition, and never
  // what the clip is about.
  "january", "february", "march", "april", "june", "july", "august",
  "september", "october", "november", "december", "monday", "tuesday",
  "wednesday", "thursday", "friday", "saturday", "sunday",
]);

/**
 * Topic words for hashtags.
 *
 * Two earlier versions were both wrong in instructive ways. The first took the
 * most repeated content words in the clip and produced #eleven, #losing,
 * #north and #moment - single occurrences of ordinary words printed under a
 * Copy button as if ready to post. The second demanded a word repeat inside
 * the clip, which is far too strict: a 30-second clip is about eighty words and
 * a topic word earns one mention, so nearly every clip came back with no tags
 * at all and the feature quietly disappeared.
 *
 * What actually marks a word as this clip's topic is being concentrated here
 * relative to the rest of the video. "People" and "number" recur across a whole
 * episode and tell you nothing; "pricing", "onboarding" and "enthusiasm" show
 * up in one stretch and nowhere else. So the ranking is the word's density in
 * the clip against its density across the transcript, with repetition inside
 * the clip as a bonus rather than a gate.
 *
 * Returning nothing is still a valid answer. Four junk tags are worse than none.
 */
export function tagsFrom(text: string, corpus?: string, max = 3): string[] {
  const words = (s: string) =>
    s
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .map((w) => w.replace(/'/g, ""))
      .filter(
        (w) =>
          w.length >= 5 &&
          !/^\d/.test(w) &&
          !STOPWORDS.has(w) &&
          !NOT_A_TOPIC.has(w),
      );

  const clipWords = words(text);
  if (!clipWords.length) return [];

  const clipCounts = new Map<string, number>();
  for (const w of clipWords) clipCounts.set(w, (clipCounts.get(w) || 0) + 1);

  const corpusWords = corpus ? words(corpus) : [];
  const corpusCounts = new Map<string, number>();
  for (const w of corpusWords) {
    corpusCounts.set(w, (corpusCounts.get(w) || 0) + 1);
  }

  // Without the rest of the transcript to compare against, repetition inside
  // the clip is the only evidence there is, so it becomes the requirement.
  const haveCorpus = corpusWords.length > clipWords.length;

  const scored: Array<{ word: string; weight: number }> = [];

  for (const [word, count] of clipCounts) {
    if (!haveCorpus) {
      if (count >= 2) scored.push({ word, weight: count });
      continue;
    }

    const here = count / clipWords.length;
    const overall = (corpusCounts.get(word) || count) / corpusWords.length;
    const concentration = here / Math.max(overall, 1e-9);

    // A word spread evenly through the video sits at ~1 and is the speaker's
    // vocabulary, not this clip's subject.
    if (concentration < 1.6) continue;

    // Concentration alone cannot tell a topic from a passing detail: a name
    // or a place mentioned once is perfectly concentrated and still not what
    // the clip is about. So a word said only once has to at least be a long
    // one, which is the cheapest proxy for a substantive term there is.
    if (count < 2 && word.length < 7) continue;

    scored.push({ word, weight: concentration * (1 + Math.log(count)) });
  }

  return scored
    .sort((a, b) => b.weight - a.weight || a.word.localeCompare(b.word))
    .slice(0, max)
    .map((s) => s.word);
}

