import { useEffect, useMemo, useRef, useState } from 'react';
import { analyze, corpusMean } from '../../engine/pipeline';
import { formatTimecode, humanDuration } from '../../engine/ingest';
import { SIGNAL_LABELS, SIGNAL_DESCRIPTIONS, SIGNAL_WEIGHTS } from '../../engine/signals';
import { PLATFORM_LABELS } from '../../engine/generate/titles';
import { PATTERN_LABELS } from '../../engine/generate/hooks';
import { renderThumbnailSVG } from '../../engine/generate/thumbnail';
import type { SignalName } from '../../engine/types';
import { AttentionTerrain } from '../three/AttentionTerrain';
import { Logo } from './Logo';
import sampleSRT from '../../../samples/the-algorithm-episode.srt?raw';

const SIGNAL_ORDER: SignalName[] = ['hook', 'curiosity', 'emotion', 'concrete', 'salience', 'payoff', 'pace', 'quotable'];

/** Reveals a section once, on first intersection. Never re-runs on scroll back. */
function useRevealOnce<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || shown) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(true); return; }

    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setShown(true); io.disconnect(); } },
      { rootMargin: '-12% 0px -12% 0px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [shown]);

  return { ref, shown };
}

export function Landing({ onEnter }: { onEnter: () => void }) {
  // The demo analysis is the real thing, run in this tab. Every figure on this
  // page is read out of it — nothing here is written copy pretending to be data.
  const { demo, elapsedMs } = useMemo(() => {
    const t0 = performance.now();
    const result = analyze(sampleSRT, { clipCount: 6, sourceTitle: 'Why your channel stalled at 900 subscribers' });
    return { demo: result, elapsedMs: performance.now() - t0 };
  }, []);

  const [reveal, setReveal] = useState(0);
  const baseline = useMemo(() => corpusMean(demo), [demo]);
  const hero = demo.clips[0];

  const terrain = useMemo(() => {
    const dur = demo.stats.durationSec || 1;
    return {
      curve: demo.curve.map((p) => p.v),
      clips: demo.clips.map((c) => ({ start: c.start / dur, end: c.end / dur, score: c.score / 100 })),
      boundaries: demo.boundaries.map((b) => b.timeSec / dur),
    };
  }, [demo]);

  // The one authored moment: the terrain builds itself once, on arrival.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setReveal(1); return; }
    const id = window.setTimeout(() => setReveal(1), 320);
    return () => window.clearTimeout(id);
  }, []);

  const signals = useRevealOnce<HTMLElement>();
  const boundaries = useRevealOnce<HTMLElement>();

  return (
    <>
      {/* Scrolls away with the hero rather than following the reader: the page
          is short, and both calls to action are already inside it. */}
      <header className="masthead">
        <div className="shell masthead__inner">
          <Logo size={26} />
          <a
            className="masthead__link"
            href="https://github.com/rishikrrontala-bot/hookline"
            target="_blank"
            rel="noreferrer noopener"
          >
            Source
          </a>
        </div>
      </header>

      <main id="main">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="hero">
        <AttentionTerrain
          curve={terrain.curve}
          clips={terrain.clips}
          boundaries={terrain.boundaries}
          reveal={reveal}
          view="hero"
          className="hero__canvas"
        />
        <div className="hero__veil" aria-hidden="true" />

        <div className="shell hero__content">
          <h1 className="hero__title">
            Your recording has an<br />attention curve.
          </h1>
          <p className="hero__lede">
            HOOKLINE measures it, cuts at the points where the subject actually changes, and hands
            back a publishable week — clips, hooks, captions, platform titles, chapters and a posting
            schedule. It runs in this tab. No account, no upload, no API key.
          </p>

          <div className="hero__actions">
            <button type="button" className="btn btn--primary btn--lg" onClick={onEnter}>
              Analyse a transcript
            </button>
            <a className="btn btn--ghost btn--lg" href="#measurement">See what it measures</a>
          </div>

          <dl className="proof">
            <Proof label="Analysed just now" value={`${elapsedMs.toFixed(0)}ms`} note="in this browser tab" />
            <Proof label="Recording" value={humanDuration(demo.stats.durationSec)} note={`${demo.stats.wordCount.toLocaleString()} words`} />
            <Proof label="Windows evaluated" value={demo.stages.find((s) => s.key === 'extract')?.detail.split(' ')[0] ?? '—'} note={`→ ${demo.stats.clipCount} clips`} />
            <Proof label="Output" value={`${demo.clips.reduce((n, c) => n + c.titles.length, 0)}`} note="titles, all inside their limits" />
          </dl>
        </div>

        <div className="hero__hint" aria-hidden="true">
          <span className="label">The ridge is the measurement</span>
        </div>
      </section>

      {/* ── The measurement ──────────────────────────────────────────────── */}
      <section
        id="measurement"
        className={`section signals-section${signals.shown ? ' is-shown' : ''}`}
        ref={signals.ref}
      >
        <div className="shell">
          <div className="section__head">
            <h2>Eight signals, scored per sentence</h2>
            <p className="section__lede prose">
              Most clip tools ask a language model to pick the good parts, and it returns the parts
              that summarise well — which is the opposite of what holds attention. HOOKLINE scores
              every sentence across eight independent linguistic signals, smooths them into a
              continuous curve, and cuts against that. The weights below are the model. They are
              printed here because a score you cannot interrogate is a score you cannot trust.
            </p>
          </div>

          <ol className="readout">
            {SIGNAL_ORDER.map((key, i) => (
              <li className="readout__row" key={key} style={{ '--i': i } as React.CSSProperties}>
                <h3 className="readout__name">{SIGNAL_LABELS[key]}</h3>
                <span className="readout__weight num" title="Share of the composite score">
                  {(SIGNAL_WEIGHTS[key] * 100).toFixed(0)}%
                </span>
                <span className="readout__meter" aria-hidden="true">
                  <span
                    className="readout__model"
                    style={{ transform: `scaleX(${signals.shown ? SIGNAL_WEIGHTS[key] / 0.2 : 0})` }}
                  />
                  <span className="readout__actual" style={{ left: `${baseline[key] * 100}%` }} />
                </span>
                <span className="readout__actual-val num">{(baseline[key] * 100).toFixed(0)}</span>
                <p className="readout__desc">{SIGNAL_DESCRIPTIONS[key]}</p>
              </li>
            ))}
          </ol>

          <p className="readout__key">
            <span className="key key--heat" /> weight in the composite score
            <span className="key key--cyan" /> this recording&rsquo;s own average, 0&ndash;100
          </p>

          <p className="section__foot">
            Values shown are this recording's own averages. The pace signal is withheld entirely
            when a transcript arrives without real timings, rather than scored on synthetic ones.
          </p>
        </div>
      </section>

      {/* ── Boundaries ───────────────────────────────────────────────────── */}
      <section
        className={`section boundaries-section${boundaries.shown ? ' is-shown' : ''}`}
        ref={boundaries.ref}
      >
        <div className="shell boundaries__grid">
          <div>
            <h2>A clip that ends mid-thought is a defect</h2>
            <p className="prose">
              Duration is the wrong unit to cut on. HOOKLINE slides two windows across the transcript
              and measures how much vocabulary they share — where that overlap collapses, the subject
              has changed. Those valleys are the only places a clip is allowed to start or end.
            </p>
            <p className="prose">
              The same boundaries produce the chapter markers for the source video, so the two
              outputs never disagree about where a topic began.
            </p>

            <ol className="chapters chapters--inline">
              {demo.seo.chapters.map((c) => (
                <li key={c.start} className="chapters__row">
                  <span className="chapters__time num">{c.timecode}</span>
                  <span className="chapters__label">{c.label}</span>
                </li>
              ))}
            </ol>
          </div>

          <figure className="boundaries__figure">
            <svg viewBox="0 0 400 220" className="cohesion" role="img" aria-label="Lexical cohesion between adjacent windows across the recording. The marked valleys are the detected topic boundaries.">
              <defs>
                <linearGradient id="cohesionFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--cyan-500)" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="var(--cyan-500)" stopOpacity="0" />
                </linearGradient>
              </defs>
              {(() => {
                // The measurement itself: block similarity at each sentence gap.
                // Valleys are where the vocabulary on either side stops
                // overlapping — which is where the boundaries below sit.
                const [from, to] = demo.cohesionRange;
                const usable = demo.cohesion.slice(from, to).map((v, i) => ({ v, i: i + from }));
                if (usable.length < 4) return null;

                const lo = Math.min(...usable.map((p) => p.v));
                const hi = Math.max(...usable.map((p) => p.v));
                const span = Math.max(1e-6, hi - lo);

                const pts = usable.map((p, k) => ({
                  x: (k / (usable.length - 1)) * 400,
                  y: 196 - ((p.v - lo) / span) * 168,
                }));
                const d = pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
                return (
                  <>
                    <path d={`${d} L 400 220 L 0 220 Z`} fill="url(#cohesionFill)" />
                    <path d={d} fill="none" stroke="var(--cyan-400)" strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
                  </>
                );
              })()}
              {demo.boundaries.map((b, i) => {
                const [from, to] = demo.cohesionRange;
                const x = ((b.sentenceIndex - from) / Math.max(1, to - from - 1)) * 400;
                return (
                  <g key={i} className="cohesion__cut" style={{ '--i': i } as React.CSSProperties}>
                    <line x1={x} y1="8" x2={x} y2="220" />
                    <circle cx={x} cy="8" r="2.5" />
                  </g>
                );
              })}
            </svg>
            <figcaption className="figure__caption">
              <span className="label">Block similarity, window {'\u00b1'}{Math.max(3, Math.min(8, Math.round(demo.stats.sentenceCount / 28)))} sentences</span>
              <span className="figure__note">
                {demo.boundaries.length} valleys deep enough to cut on, across {demo.stats.sentenceCount} sentences
              </span>
            </figcaption>
          </figure>
        </div>
      </section>

      {/* ── Output ───────────────────────────────────────────────────────── */}
      {hero && (
        <section className="section output-section">
          <div className="shell">
            <div className="section__head">
              <h2>Then it finishes the job</h2>
              <p className="section__lede prose">
                A clip without captions, titles, tags and a slot on the calendar is homework. This is
                the top-ranked clip from the recording above, exactly as the engine produced it —
                every field below is generated, none of it is written for this page.
              </p>
            </div>

            <div className="showcase">
              <div className="showcase__thumb" dangerouslySetInnerHTML={{ __html: renderThumbnailSVG(hero, hero.rank) }} />

              <div className="showcase__body">
                <p className="showcase__stamp num">
                  {formatTimecode(hero.start)}–{formatTimecode(hero.end)} · {hero.durationSec.toFixed(0)}s ·{' '}
                  {PATTERN_LABELS[hero.hookPattern]} · score {hero.score.toFixed(0)}
                </p>
                <p className="showcase__hook">{hero.hook}</p>

                <dl className="showcase__fields">
                  {hero.titles.map((t) => (
                    <div className="showcase__field" key={t.platform}>
                      <dt>{PLATFORM_LABELS[t.platform]}</dt>
                      <dd>
                        <span className="showcase__lines">
                          {t.text.split('\n').filter(Boolean).map((line, i) => (
                            <span key={i}>{line}</span>
                          ))}
                        </span>
                        <span className="showcase__count num">{t.chars}/{t.limit}</span>
                      </dd>
                    </div>
                  ))}
                  <div className="showcase__field">
                    <dt>Hashtags</dt>
                    <dd>{hero.hashtags.join(' ')}</dd>
                  </div>
                  <div className="showcase__field">
                    <dt>Captions</dt>
                    <dd>{hero.captions.length} cues, timed to the word · SRT and VTT</dd>
                  </div>
                  <div className="showcase__field">
                    <dt>Thumbnail</dt>
                    <dd>Overlay “{hero.thumbnail.overlay}”, grab at {formatTimecode(hero.thumbnail.frameAtSec)}</dd>
                  </div>
                </dl>
              </div>
            </div>

            <ul className="deliverables">
              {[
                ['Clips', 'Cut at topic boundaries, ranked, non-overlapping'],
                ['Hooks', "Rewritten from the speaker's own words — nothing invented"],
                ['Titles', 'Per platform, inside each character limit'],
                ['Captions', 'SRT and VTT, wrapped for a vertical safe area'],
                ['Chapters', 'For the source video, from the same boundaries'],
                ['Thumbnails', '9:16 layout proofs with overlay text and grab timecode'],
                ['Schedule', 'A week of slots, each with the reason it landed there'],
                ['ffmpeg script', 'Renders every clip vertically with captions burned in'],
              ].map(([term, desc]) => (
                <li key={term}>
                  <h3>{term}</h3>
                  <p>{desc}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* ── Close ────────────────────────────────────────────────────────── */}
      <section className="section close-section">
        <div className="shell close">
          <h2>Bring a transcript.</h2>
          <p className="prose">
            SRT, WebVTT, a pasted YouTube transcript, or plain prose. Nothing leaves the tab, and the
            result is complete before any model is involved.
          </p>
          <button type="button" className="btn btn--primary btn--lg" onClick={onEnter}>
            Open the workspace
          </button>
          <p className="close__note">
            Also available as a CLI: <code>npm run cli -- transcript.srt --out ./week</code> writes the
            whole package to disk, using the identical engine.
          </p>
        </div>
      </section>

      <footer className="footer">
        <div className="shell footer__inner">
          <Logo size={22} />
          <p className="footer__note">
            Built for the AI Content Engine Hackathon. Sample transcripts are written for this
            project; no user, customer or performance data stands behind anything on this page.
          </p>
          <a
            className="masthead__link"
            href="https://github.com/rishikrrontala-bot/hookline"
            target="_blank"
            rel="noreferrer noopener"
          >
            Source
          </a>
        </div>
      </footer>
    </main>
    </>
  );
}

function Proof({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="proof__item">
      <dt className="label">{label}</dt>
      <dd className="proof__value num">{value}</dd>
      <dd className="proof__note">{note}</dd>
    </div>
  );
}
