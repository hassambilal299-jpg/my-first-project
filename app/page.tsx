import Analyzer from "@/components/Analyzer";

export default function Home() {
  return (
    <>
      <header className="masthead">
        <div className="shell masthead__inner">
          <div className="wordmark">
            <span className="wordmark__meter" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </span>
            Clipper
          </div>
          <span className="masthead__note">Transcript in, timecodes out</span>
        </div>
      </header>

      <main className="shell">
        <Analyzer />

        <section className="method">
          <h2>How it picks</h2>
          <p className="method__intro">
            No video is downloaded to find the moments. Clipper works from the
            captions YouTube already has, which is why it answers in seconds
            rather than minutes.
          </p>

          <div className="stages">
            <div className="stage">
              <span className="stage__step">First</span>
              <h3>Read the captions</h3>
              <p>
                YouTube's own caption track is already timed to the second, so
                there's nothing to transcribe and nothing to download.
              </p>
            </div>

            <div className="stage">
              <span className="stage__step">Then</span>
              <h3>Score every candidate</h3>
              <p>
                Each moment is marked on three things: whether the first line
                stops a scroll, whether it makes sense cold, and whether it
                lands something before it ends.
              </p>
            </div>

            <div className="stage">
              <span className="stage__step">Last</span>
              <h3>Check the timings</h3>
              <p>
                Every segment is clamped to length, kept from overlapping its
                neighbours, and held inside the video's real duration.
              </p>
            </div>
          </div>

          <div className="caveat">
            <h3>What this doesn't do yet</h3>
            <p>
              It finds, scores and previews the moments, and writes the caption
              to post with each one. It doesn't render vertical MP4s with
              burned-in captions — that needs ffmpeg and a few minutes per
              video, which doesn't fit in a serverless function. That part runs
              on a separate worker.
            </p>
          </div>
        </section>
      </main>

      <footer className="shell colophon">
        <span>Clipper</span>
        <span>Works on videos that have captions</span>
      </footer>
    </>
  );
}
