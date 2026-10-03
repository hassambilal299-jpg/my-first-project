"use client";

import { useEffect, useRef, useState } from "react";
import Timeline from "./Timeline";
import ClipList from "./ClipList";
import { SAMPLE, type AnalyzeResult } from "@/lib/sample";

const COUNTS = [2, 4, 6];
const LENGTHS = [15, 25, 30];

export default function Analyzer() {
  const [url, setUrl] = useState("");
  const [count, setCount] = useState(4);
  const [length, setLength] = useState(30);
  const [result, setResult] = useState<AnalyzeResult>(SAMPLE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsKey, setNeedsKey] = useState(false);
  const [canUpgrade, setCanUpgrade] = useState(false);
  const revision = useRef(0);

  // Ask the deployment which keys it has. Only the transcript key is
  // required; without the model key the site still works off the free
  // signal-based picker, so that one is offered as an upgrade, not a fault.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/diag")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setNeedsKey(!d?.keys?.TRANSCRIPT_API_KEY);
        setCanUpgrade(!d?.keys?.ANTHROPIC_API_KEY);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError("");

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, count, length }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data?.error || "That didn't work. Try again.");
      } else {
        revision.current += 1;
        setResult(data as AnalyzeResult);
      }
    } catch {
      setError("Couldn't reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  const isSample = Boolean(result.sample);

  return (
    <>
      <section className="hero">
        <div className="hero__head">
          <h1>Four moments worth posting, out of fifty-eight minutes.</h1>
        </div>
        <p className="hero__sub">
          Paste a YouTube link. Clipper reads the transcript, finds the
          stretches that stand on their own, and hands you the timecodes with
          the reasoning behind each pick.
        </p>

        <form className="finder" onSubmit={run}>
          <div className="finder__field">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="youtube.com/watch?v=..."
              aria-label="YouTube link"
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          <div
            className="counts"
            role="group"
            aria-label="How many clips to find"
          >
            {COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={count === n}
                onClick={() => setCount(n)}
                title={`${n} clips`}
              >
                {n}
              </button>
            ))}
          </div>

          <div
            className="counts"
            role="group"
            aria-label="How long each clip should be"
          >
            {LENGTHS.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={length === s}
                onClick={() => setLength(s)}
                title={`About ${s} seconds each`}
              >
                {s}s
              </button>
            ))}
          </div>

          <button className="submit" type="submit" disabled={busy || !url.trim()}>
            {busy ? "Reading…" : "Find the moments"}
          </button>
        </form>

        {busy && (
          <p className="notice">
            <span className="working">
              <span className="working__meter" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </span>
              Reading the transcript and picking moments
            </span>
          </p>
        )}

        {error && !busy && <p className="notice notice--error">{error}</p>}

        {needsKey && (
          <div className="setup">
            <h2>One step left to finish setting this up</h2>
            <p>
              Reading a YouTube transcript needs a key, and this site
              doesn&apos;t have one yet. It&apos;s free and takes no card. The
              sample below is real output, so you can see what it produces in
              the meantime.
            </p>
            <ol>
              <li>
                Sign up free at supadata.ai and copy the API key (100 videos a
                month, no card)
              </li>
              <li>
                In Vercel, open this project → Settings → Environment
                Variables, and add it as <code>TRANSCRIPT_API_KEY</code>
              </li>
              <li>Redeploy — Vercel only picks up new keys on a fresh build</li>
            </ol>
          </div>
        )}

        {!needsKey && canUpgrade && (
          // Not a fault, so it loses the amber edge the setup banner uses to
          // demand attention. One element, one property - not worth a class.
          <div className="setup" style={{ borderLeftColor: "var(--line)" }}>
            <h2>Running on the free picker</h2>
            <p>
              Moments are being chosen by scoring the transcript — openings,
              turns, how self-contained each stretch is. It works, but it
              can&apos;t judge whether a point really lands, and captions are
              the speaker&apos;s own opening line rather than written for the
              post. Adding a key from console.anthropic.com as{" "}
              <code>ANTHROPIC_API_KEY</code> switches on the model picker, at
              roughly a cent or two a video.
            </p>
          </div>
        )}

        <div className="reel">
          <div className="reel__bar">
            <p className="reel__title">
              {result.video.title}
              {result.video.author && (
                <span className="reel__by"> — {result.video.author}</span>
              )}
            </p>
            <span
              className="reel__tag"
              title={
                isSample
                  ? "Worked example, not your video"
                  : result.picker === "signals"
                    ? "Picked by scoring the transcript, no model key set"
                    : "Picked by the model"
              }
            >
              {isSample
                ? "Sample"
                : result.picker === "signals"
                  ? "Free picker"
                  : "Model picker"}
            </span>
          </div>

          <Timeline
            density={result.density}
            segments={result.segments}
            durationSeconds={result.video.durationSeconds}
            revision={revision.current}
          />
        </div>
      </section>

      <ClipList
        segments={result.segments}
        videoId={result.video.id}
        isSample={isSample}
      />
    </>
  );
}
