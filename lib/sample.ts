import type { Picker, Segment } from "./moments";

export interface AnalyzeResult {
  video: {
    id: string;
    title: string;
    author: string;
    durationSeconds: number;
    thumbnail: string;
  };
  segments: Segment[];
  /** Coarse loudness-ish shape of the transcript, for drawing the timeline. */
  density: number[];
  sample?: boolean;
  /** Which picker chose these. Absent on the sample. */
  picker?: Picker;
  /** How many clips were requested, so a shortfall can be explained. */
  asked?: number;
}

/**
 * The demo shown before anyone pastes a link.
 *
 * Deliberately an invented episode, not a real video: putting invented quotes
 * under a real creator's name would misrepresent them. It costs nothing to
 * serve, which is the point — people get to judge output quality without us
 * burning compute on a free tier.
 */
export const SAMPLE: AnalyzeResult = {
  video: {
    id: "",
    title: "How we rebuilt onboarding and cut churn by half",
    author: "The Build Log, ep. 114",
    durationSeconds: 3492,
    thumbnail: "",
  },
  sample: true,
  density: [
    0.22, 0.31, 0.28, 0.44, 0.39, 0.52, 0.78, 0.71, 0.54, 0.38, 0.33, 0.41,
    0.37, 0.29, 0.35, 0.48, 0.62, 0.83, 0.91, 0.74, 0.56, 0.43, 0.36, 0.3,
    0.34, 0.42, 0.39, 0.47, 0.58, 0.69, 0.52, 0.41, 0.35, 0.44, 0.63, 0.81,
    0.88, 0.67, 0.49, 0.37, 0.32, 0.4, 0.46, 0.55, 0.72, 0.86, 0.64, 0.45,
    0.38, 0.33, 0.29, 0.36, 0.5, 0.68, 0.79, 0.57, 0.42, 0.34, 0.27, 0.24,
  ],
  segments: [
    {
      start: 412,
      end: 441,
      title: "The metric that was lying to us",
      hook: "Activation was up eleven percent and we were still losing people.",
      reason: "Opens on a contradiction, and the payoff lands before it ends.",
      marks: { hook: 88, standalone: 84, payoff: 79 },
      score: 85,
      caption:
        "Our activation number went up and churn went up with it. Took us a quarter to work out why.",
      hashtags: ["onboarding", "churn", "saas", "metrics"],
      excerpt:
        "Activation was up eleven percent and we were still losing people. That number had been our north star for two years, and it turned out we were measuring the moment someone finished setup, not the moment they got anything out of it.",
    },
    {
      start: 1067,
      end: 1098,
      title: "Cutting the signup form in half",
      hook: "We deleted six fields and nobody asked for them back.",
      reason: "A concrete number up front, then the result. Self-contained.",
      marks: { hook: 79, standalone: 88, payoff: 72 },
      score: 80,
      caption:
        "Six fields gone from signup. Nobody noticed, completion went up nine points.",
      hashtags: ["signup", "forms", "conversion", "product"],
      excerpt:
        "We deleted six fields and nobody asked for them back. Company size, role, how did you hear about us, all of it. Completion went up about nine points in the first week and it never came back down.",
    },
    {
      start: 1884,
      end: 1912,
      title: "Why the empty state was the whole problem",
      hook: "People were not confused by the product. They were confused by nothing.",
      reason:
        "A reframe that makes sense cold, with no setup from earlier in the episode.",
      marks: { hook: 83, standalone: 76, payoff: 68 },
      score: 77,
      caption:
        "Turns out people weren't confused by our product. They were confused by an empty screen.",
      hashtags: ["emptystate", "ux", "onboarding"],
      excerpt:
        "People were not confused by the product. They were confused by nothing. They would land on a blank dashboard with no data in it and simply have no idea whether the thing was working.",
    },
    {
      start: 2641,
      end: 2673,
      title: "The support ticket that changed the roadmap",
      hook: "One customer wrote four words and we rewrote the quarter.",
      reason: "Story shape: hook, turn, resolution, all inside the clip.",
      marks: { hook: 74, standalone: 71, payoff: 81 },
      score: 75,
      caption:
        "Four words in a support ticket cost us a quarter of roadmap. Worth every day.",
      hashtags: ["support", "roadmap", "customerfeedback"],
      excerpt:
        "One customer wrote four words and we rewrote the quarter. The ticket just said: I cannot tell if this is on. That was it. And once you see that you cannot unsee it anywhere in the product.",
    },
  ],
};

export function formatTimecode(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return h
    ? `${h}:${mm}:${String(sec).padStart(2, "0")}`
    : `${mm}:${String(sec).padStart(2, "0")}`;
}

export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}
