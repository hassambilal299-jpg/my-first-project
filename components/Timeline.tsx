"use client";

import { formatTimecode } from "@/lib/sample";
import type { Segment } from "@/lib/moments";

interface Props {
  density: number[];
  segments: Segment[];
  durationSeconds: number;
  /** Bumped on each new result so the spans re-animate. */
  revision: number;
}

/**
 * The timeline is the product in one picture: a long video, and the few
 * stretches of it worth posting. Ticks inside a picked span go amber.
 */
export default function Timeline({
  density,
  segments,
  durationSeconds,
  revision,
}: Props) {
  const buckets = density.length;

  const classify = (index: number): string => {
    const bucketStart = (index / buckets) * durationSeconds;
    const bucketEnd = ((index + 1) / buckets) * durationSeconds;

    for (const seg of segments) {
      if (bucketStart < seg.end && bucketEnd > seg.start) {
        return "track__tick track__tick--hit";
      }
      const pad = durationSeconds / buckets;
      if (bucketStart < seg.end + pad && bucketEnd > seg.start - pad) {
        return "track__tick track__tick--near";
      }
    }
    return "track__tick";
  };

  return (
    <div className="track">
      <div className="track__graph" aria-hidden="true">
        {density.map((value, i) => (
          <div
            key={i}
            className={classify(i)}
            style={{ height: `${Math.round(value * 100)}%` }}
          />
        ))}
      </div>

      <div className="track__spans">
        {segments.map((seg, i) => {
          const left = (seg.start / durationSeconds) * 100;
          const width = Math.max(
            0.8,
            ((seg.end - seg.start) / durationSeconds) * 100,
          );
          return (
            <div
              key={`${revision}-${i}`}
              className="track__span track__span--enter"
              data-index={i + 1}
              style={{
                left: `${left}%`,
                width: `${width}%`,
                animationDelay: `${i * 90}ms`,
              }}
              title={`Clip ${i + 1}: ${formatTimecode(seg.start)}–${formatTimecode(seg.end)}`}
            />
          );
        })}
      </div>

      <div className="track__scale">
        <span>0:00</span>
        <span>{formatTimecode(durationSeconds / 2)}</span>
        <span>{formatTimecode(durationSeconds)}</span>
      </div>
    </div>
  );
}
