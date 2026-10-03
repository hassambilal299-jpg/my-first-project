"use client";

import { useState } from "react";
import { formatDuration, formatTimecode } from "@/lib/sample";
import type { Segment } from "@/lib/moments";

interface Props {
  segments: Segment[];
  videoId: string;
  isSample: boolean;
}

type Order = "time" | "score";

/** Four bars, like the wordmark's meter. Reads as signal strength, which is
 *  what the score is — not a grade. */
function ScoreMeter({ score }: { score: number }) {
  const lit = Math.max(1, Math.min(4, Math.ceil((score / 100) * 4)));
  return (
    <span className="meter" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className={i < lit ? "meter__bar meter__bar--on" : "meter__bar"} />
      ))}
    </span>
  );
}

function clipAsText(seg: Segment): string {
  const tags = seg.hashtags.map((t) => `#${t}`).join(" ");
  return [
    seg.title,
    `${formatTimecode(seg.start)} – ${formatTimecode(seg.end)}  (${formatDuration(
      seg.end - seg.start,
    )}, score ${seg.score})`,
    "",
    seg.caption,
    tags,
  ]
    .filter(Boolean)
    .join("\n");
}

export default function ClipList({ segments, videoId, isSample }: Props) {
  const [open, setOpen] = useState<number | null>(null);
  const [order, setOrder] = useState<Order>("time");
  const [copied, setCopied] = useState<string>("");

  const ordered =
    order === "score"
      ? [...segments].sort((a, b) => b.score - a.score)
      : [...segments].sort((a, b) => a.start - b.start);

  async function copy(text: string, tag: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      setTimeout(() => setCopied(""), 1600);
    } catch {
      setCopied("");
    }
  }

  const best = segments.reduce(
    (m, s) => (s.score > m ? s.score : m),
    0,
  );

  return (
    <section className="clips">
      <div className="clips__lede">
        <div>
          <h2>
            {segments.length} {segments.length === 1 ? "moment" : "moments"}
          </h2>
          <p>
            {isSample
              ? "A worked example. Paste your own link above to run it for real."
              : `Best scores ${best}. Scores rank these against each other, not against the internet.`}
          </p>
        </div>

        <div className="clips__tools">
          <div className="counts" role="group" aria-label="Sort clips">
            <button
              type="button"
              aria-pressed={order === "time"}
              onClick={() => setOrder("time")}
            >
              In order
            </button>
            <button
              type="button"
              aria-pressed={order === "score"}
              onClick={() => setOrder("score")}
            >
              Best first
            </button>
          </div>

          <button
            className="ghost"
            onClick={() =>
              copy(ordered.map(clipAsText).join("\n\n———\n\n"), "all")
            }
          >
            {copied === "all" ? "Copied" : "Copy all"}
          </button>
        </div>
      </div>

      {ordered.map((seg, i) => {
        const start = Math.floor(seg.start);
        const end = Math.ceil(seg.end);
        const key = `${seg.start}-${seg.end}`;
        const playing = open === i;

        return (
          <article className="clip" key={key}>
            <div className="clip__time">
              <span className="clip__score">
                <ScoreMeter score={seg.score} />
                {seg.score}
              </span>
              {formatTimecode(seg.start)}
              <span className="clip__len">
                {formatDuration(seg.end - seg.start)}
              </span>
            </div>

            <div className="clip__body">
              <h3 className="clip__title">{seg.title}</h3>
              {seg.hook && <p className="clip__hook">{seg.hook}</p>}
              {seg.reason && <p className="clip__why">{seg.reason}</p>}

              <dl className="marks">
                {(
                  [
                    ["Hook", seg.marks.hook],
                    ["Stands alone", seg.marks.standalone],
                    ["Payoff", seg.marks.payoff],
                  ] as const
                ).map(([label, value]) => (
                  <div className="marks__row" key={label}>
                    <dt>{label}</dt>
                    <dd>
                      <span className="marks__track">
                        <span
                          className="marks__fill"
                          style={{ width: `${value}%` }}
                        />
                      </span>
                      <span className="marks__num">{value}</span>
                    </dd>
                  </div>
                ))}
              </dl>

              {seg.caption && (
                <div className="post">
                  <p className="post__text">{seg.caption}</p>
                  {seg.hashtags.length > 0 && (
                    <p className="post__tags">
                      {seg.hashtags.map((t) => `#${t}`).join("  ")}
                    </p>
                  )}
                  <button
                    className="ghost ghost--small"
                    onClick={() =>
                      copy(
                        [seg.caption, seg.hashtags.map((t) => `#${t}`).join(" ")]
                          .filter(Boolean)
                          .join("\n\n"),
                        key,
                      )
                    }
                  >
                    {copied === key ? "Copied" : "Copy caption"}
                  </button>
                </div>
              )}

              {seg.excerpt && (
                <details className="said">
                  <summary>What's said</summary>
                  <p>{seg.excerpt}</p>
                </details>
              )}
            </div>

            <div className="clip__act">
              {videoId && (
                <button
                  className="ghost"
                  onClick={() => setOpen(playing ? null : i)}
                  aria-expanded={playing}
                >
                  {playing ? "Hide" : "Play"}
                </button>
              )}
              {videoId && (
                <a
                  className="ghost"
                  href={`https://www.youtube.com/watch?v=${videoId}&t=${start}s`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open
                </a>
              )}
            </div>

            {playing && videoId && (
              <div className="player">
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${videoId}?start=${start}&end=${end}&autoplay=1&rel=0`}
                  title={seg.title}
                  allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                />
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
