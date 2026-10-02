/**
 * Score over time — a small inline SVG line chart.
 *
 * Deliberately not a charting library: it's one series of at most twenty
 * points, and shipping a chart dependency for that would cost more than it
 * returns. Rendered server-side with no interactivity beyond the title.
 */
type Point = { score: number; createdAt: Date; down: boolean };

const WIDTH = 640;
const HEIGHT = 140;
const PAD = { top: 12, right: 12, bottom: 24, left: 32 };

export function ScoreHistory({ points }: { points: Point[] }) {
  if (points.length < 2) return null;

  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;

  const x = (i: number) => PAD.left + (i / (points.length - 1)) * innerW;
  const y = (score: number) => PAD.top + (1 - score / 100) * innerH;

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.score)}`).join(" ");

  const first = points[0];
  const last = points[points.length - 1];
  const change = last.score - first.score;

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Score went from ${first.score} to ${last.score} over the last ${points.length} checks.`}
      >
        {/* Gridlines at 0, 50 and 100 — enough to read the shape. */}
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(v)}
              y2={y(v)}
              stroke="currentColor"
              strokeWidth="1"
              className="text-slate-200"
            />
            <text
              x={PAD.left - 8}
              y={y(v) + 4}
              textAnchor="end"
              className="fill-slate-400 text-[11px] tabular-nums"
            >
              {v}
            </text>
          </g>
        ))}

        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-brand-600"
        />

        {points.map((p, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(p.score)}
            r={p.down ? 5 : 3.5}
            className={p.down ? "fill-critical" : "fill-brand-600"}
          >
            <title>
              {p.down
                ? `Down — ${p.createdAt.toLocaleDateString()}`
                : `${p.score}/100 — ${p.createdAt.toLocaleDateString()}`}
            </title>
          </circle>
        ))}
      </svg>

      <figcaption className="mt-2 text-sm text-ink-muted">
        {change === 0
          ? `Unchanged at ${last.score} over the last ${points.length} checks.`
          : change > 0
            ? `Up ${change} points over the last ${points.length} checks.`
            : `Down ${Math.abs(change)} points over the last ${points.length} checks.`}
      </figcaption>
    </figure>
  );
}
