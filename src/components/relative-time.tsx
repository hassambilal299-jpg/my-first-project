"use client";

import { useEffect, useState } from "react";

/**
 * "4m ago", "2d ago".
 *
 * Rendered as an absolute timestamp on the server and swapped for the
 * relative form once mounted. Doing it any other way makes the server HTML
 * and the first client render disagree, which React reports as a hydration
 * error.
 */
export function RelativeTime({
  date,
  className = "",
}: {
  date: Date | string;
  className?: string;
}) {
  const value = typeof date === "string" ? new Date(date) : date;
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const render = () => setLabel(relative(value));
    render();
    // Re-render once a minute so "just now" doesn't sit there for an hour.
    const timer = setInterval(render, 60_000);
    return () => clearInterval(timer);
  }, [value]);

  return (
    <time dateTime={value.toISOString()} className={className}>
      {label ?? value.toLocaleDateString()}
    </time>
  );
}

function relative(date: Date): string {
  const secs = Math.round((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}
