import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Analysis } from '../../engine/types';
import { formatTimecode, humanDuration } from '../../engine/ingest';
import { PLATFORM_LABELS } from '../../engine/generate/titles';
import { scheduleToCSV } from '../../engine/schedule';
import { renderThumbnailSVG } from '../../engine/generate/thumbnail';
import { useAnalysis, STAGE_PLAN } from '../hooks/useAnalysis';
import { AttentionTerrain } from '../three/AttentionTerrain';
import { AttentionStrip } from './AttentionStrip';
import { Logo } from './Logo';
import { ClipDetail } from './ClipDetail';
import sampleSRT from '../../../samples/the-algorithm-episode.srt?raw';
import samplePlain from '../../../samples/founder-interview.txt?raw';

type Panel = 'clips' | 'chapters' | 'schedule' | 'export';

export function Workspace({ onExit }: { onExit: () => void }) {
  const [raw, setRaw] = useState('');
  const [title, setTitle] = useState('');
  const [clipCount, setClipCount] = useState(6);
  const [maxSec, setMaxSec] = useState(60);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>('clips');
  const [dragging, setDragging] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const { state, analysis, progress, stageIndex, error, enhancing, enhanceError, run, reset, enhance } = useAnalysis();
  const resultsRef = useRef<HTMLDivElement>(null);

  const loadSample = useCallback((which: 'srt' | 'plain') => {
    if (which === 'srt') {
      setRaw(sampleSRT);
      setTitle('Why your channel stalled at 900 subscribers');
    } else {
      setRaw(samplePlain);
      setTitle('Founder interview — shipping under constraint');
    }
    reset();
  }, [reset]);

  const start = useCallback(() => {
    if (!raw.trim()) return;
    setSelectedId(null);
    setPanel('clips');
    run(raw, { clipCount, maxClipSec: maxSec, sourceTitle: title || undefined });
  }, [raw, clipCount, maxSec, title, run]);

  useEffect(() => {
    if (state === 'done' && analysis?.clips.length) {
      setSelectedId((prev) => prev ?? analysis.clips[0].id);
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [state, analysis]);

  /** Shared by the drop zone and the file picker. */
  const loadFile = useCallback(async (file: File | undefined | null) => {
    if (!file) return;
    // A dropped .mp4 would otherwise be read as gibberish and analysed as prose.
    if (file.size > 12_000_000) { setFileError('That file is over 12 MB — transcripts are text, so this is probably not one.'); return; }
    const text = await file.text();
    if (/[\u0000-\u0008\u000E-\u001F]/.test(text.slice(0, 2000))) {
      setFileError(`${file.name} does not look like text. Bring an .srt, .vtt or .txt transcript.`);
      return;
    }
    setFileError(null);
    setRaw(text);
    setTitle(file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
    reset();
  }, [reset]);

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    await loadFile(e.dataTransfer.files?.[0]);
  }, [loadFile]);

  const selected = analysis?.clips.find((c) => c.id === selectedId) ?? analysis?.clips[0] ?? null;

  const terrainData = useMemo(() => {
    if (!analysis) return { curve: [], clips: [], boundaries: [] };
    const dur = analysis.stats.durationSec || 1;
    return {
      curve: analysis.curve.map((p) => p.v),
      clips: analysis.clips.map((c) => ({ start: c.start / dur, end: c.end / dur, score: c.score / 100 })),
      boundaries: analysis.boundaries.map((b) => b.timeSec / dur),
    };
  }, [analysis]);

  // Counted the way the engine counts, so the input and the result never
  // disagree: subtitle indices and timecodes are not words.
  const wordCount = useMemo(() => {
    const spoken = raw
      .replace(/^\s*\d+\s*$/gm, '')
      .replace(/^.*-->.*$/gm, '')
      .replace(/^\s*WEBVTT.*$/gm, '')
      .replace(/^\s*\(?\[?\d{1,2}:\d{2}(:\d{2})?\]?\)?[\s\-–—:]*/gm, '');
    const words = spoken.toLowerCase().match(/[a-z0-9][a-z0-9'’-]*/g);
    return words ? words.length : 0;
  }, [raw]);

  return (
    <div className="ws">
      <header className="ws__bar">
        <button type="button" className="ws__back" onClick={onExit}>
          <span className="ws__back-arrow" aria-hidden="true">←</span>
          <Logo size={24} />
          <span className="visually-hidden">Back to the overview</span>
        </button>
        {analysis && state === 'done' && (
          <p className="ws__summary num">
            {humanDuration(analysis.stats.durationSec)} · {analysis.stats.wordCount.toLocaleString()} words ·{' '}
            {analysis.stats.clipCount} clips · {analysis.stats.segmentCount} segments
          </p>
        )}
      </header>

      <section className="ws__input shell" aria-label="Transcript input">
        <div className="ws__input-grid">
          <div
            className={`drop${dragging ? ' is-dragging' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <label className="visually-hidden" htmlFor="transcript">Transcript</label>
            <textarea
              id="transcript"
              className="drop__area"
              placeholder={'Paste a transcript, choose a file, or drop an .srt / .vtt / .txt here.\n\nSRT, WebVTT, pasted YouTube transcripts with timecodes, and plain prose all work. Nothing is uploaded — the engine runs in this tab.'}
              value={raw}
              onChange={(e) => { setRaw(e.target.value); if (state !== 'idle') reset(); }}
              spellCheck={false}
            />
            <div className="drop__foot">
              <span className="num">{wordCount ? `${wordCount.toLocaleString()} words` : 'empty'}</span>
              <div className="drop__samples">
                {/* A drop zone is unusable on a phone — there is nothing to drag
                    from — so the picker is the only way in on mobile. */}
                <input
                  ref={fileInput}
                  type="file"
                  accept=".srt,.vtt,.txt,.sbv,text/plain"
                  className="visually-hidden"
                  onChange={(e) => { void loadFile(e.target.files?.[0]); e.target.value = ''; }}
                />
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => fileInput.current?.click()}>
                  Choose file
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => loadSample('srt')}>
                  SRT sample
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => loadSample('plain')}>
                  Text sample
                </button>
              </div>
            </div>
          </div>

          <aside className="controls">
            <div className="controls__field">
              <label className="label" htmlFor="ws-title">Recording title</label>
              <input
                id="ws-title"
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Used in descriptions"
              />
            </div>

            <div className="controls__field">
              <label className="label" htmlFor="ws-clips">
                Clips <span className="num controls__val">{clipCount}</span>
              </label>
              <input
                id="ws-clips" type="range" min={3} max={12} step={1}
                value={clipCount} onChange={(e) => setClipCount(Number(e.target.value))}
              />
            </div>

            <div className="controls__field">
              <label className="label" htmlFor="ws-max">
                Max length <span className="num controls__val">{maxSec}s</span>
              </label>
              <input
                id="ws-max" type="range" min={20} max={180} step={5}
                value={maxSec} onChange={(e) => setMaxSec(Number(e.target.value))}
              />
            </div>

            <button
              type="button"
              className="btn btn--primary btn--block"
              onClick={start}
              disabled={!raw.trim() || state === 'running'}
            >
              {state === 'running' ? 'Analysing…' : 'Analyse recording'}
            </button>

            <details className="controls__opt">
              <summary>Optional: rewrite copy with Claude</summary>
              <p className="controls__note">
                The result below is already complete. A key only rewrites hooks and titles —
                clips, timings, captions and chapters are measurements and are never sent for rewriting.
                The key stays in this tab.
              </p>
              <div className="controls__key">
                <input
                  className="input"
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-ant-…"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Anthropic API key"
                />
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowKey((s) => !s)}>
                  {showKey ? 'Hide' : 'Show'}
                </button>
              </div>
              <button
                type="button"
                className="btn btn--ghost btn--block"
                disabled={!apiKey || !analysis || enhancing}
                onClick={() => enhance(apiKey)}
              >
                {enhancing ? 'Rewriting…' : 'Rewrite hooks and titles'}
              </button>
              {enhanceError && <p className="controls__error">{enhanceError} — deterministic output kept.</p>}
            </details>
          </aside>
        </div>

        {(fileError || error) && <p className="ws__error" role="alert">{fileError ?? error}</p>}
      </section>

      {state === 'running' && <StageRunner index={stageIndex} progress={progress} />}

      {state === 'done' && analysis && selected && (
        <div className="ws__results" ref={resultsRef}>
          <section className="ws__terrain" aria-hidden="true">
            <AttentionTerrain
              curve={terrainData.curve}
              clips={terrainData.clips}
              boundaries={terrainData.boundaries}
              reveal={1}
              view="panel"
              className="ws__canvas"
            />
          </section>

          <section className="shell ws__curve" aria-label="Attention curve">
            <div className="ws__curve-head">
              <h2>Attention across the recording</h2>
              <p className="ws__legend">
                <span className="key key--heat" /> selected clip
                <span className="key key--cyan" /> topic boundary
              </p>
            </div>
            <AttentionStrip analysis={analysis} selectedId={selected.id} onSelect={setSelectedId} />
          </section>

          <nav className="shell panels" aria-label="Output">
            {(['clips', 'chapters', 'schedule', 'export'] as Panel[]).map((p) => (
              <button
                key={p}
                type="button"
                className={`panels__tab${panel === p ? ' is-active' : ''}`}
                onClick={() => setPanel(p)}
                aria-pressed={panel === p}
              >
                {p === 'clips' ? `Clips (${analysis.clips.length})`
                  : p === 'chapters' ? `Chapters (${analysis.seo.chapters.length})`
                  : p === 'schedule' ? `Schedule (${analysis.schedule.length})`
                  : 'Export'}
              </button>
            ))}
          </nav>

          <section className="shell ws__panel">
            {panel === 'clips' && (
              <div className="ws__clips">
                <ol className="cliplist">
                  {analysis.clips.map((clip) => (
                    <li key={clip.id}>
                      <button
                        type="button"
                        className={`cliplist__item${clip.id === selected.id ? ' is-active' : ''}`}
                        onClick={() => setSelectedId(clip.id)}
                        aria-current={clip.id === selected.id}
                      >
                        <span className="cliplist__rank num">{String(clip.rank).padStart(2, '0')}</span>
                        <span className="cliplist__body">
                          <span className="cliplist__hook">{clip.hook}</span>
                          <span className="cliplist__meta num">
                            {formatTimecode(clip.start)} · {clip.durationSec.toFixed(0)}s
                          </span>
                        </span>
                        <span
                          className="cliplist__score num"
                          style={{ '--heat': `${clip.score / 100}` } as React.CSSProperties}
                        >
                          {clip.score.toFixed(0)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
                <ClipDetail clip={selected} analysis={analysis} />
              </div>
            )}

            {panel === 'chapters' && <Chapters analysis={analysis} />}
            {panel === 'schedule' && <Schedule analysis={analysis} />}
            {panel === 'export' && <Export analysis={analysis} title={title} />}
          </section>
        </div>
      )}
    </div>
  );
}

function StageRunner({ index, progress }: { index: number; progress: number }) {
  return (
    <section className="shell runner" aria-live="polite" aria-label="Analysis progress">
      <div className="runner__meter">
        <span style={{ transform: `scaleX(${progress})` }} />
      </div>
      <ol className="runner__stages">
        {STAGE_PLAN.map((stage, i) => (
          <li
            key={stage.key}
            className={`runner__stage${i < index ? ' is-done' : ''}${i === index ? ' is-active' : ''}`}
          >
            <span className="runner__label">{stage.label}</span>
            <span className="runner__detail">{stage.detail}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Chapters({ analysis }: { analysis: Analysis }) {
  const text = analysis.seo.chapters.map((c) => `${c.timecode} ${c.label}`).join('\n');
  return (
    <div className="two-col">
      <div className="stack">
        <h3>Chapters for the source video</h3>
        <p className="prose">
          Cut at the same lexical-cohesion boundaries the clip selector uses, so each marker sits where
          the subject actually changes rather than on a round number.
        </p>
        <ol className="chapters">
          {analysis.seo.chapters.map((c) => (
            <li key={c.start} className="chapters__row">
              <span className="chapters__time num">{c.timecode}</span>
              <span className="chapters__label">{c.label}</span>
            </li>
          ))}
        </ol>
        <Download name="chapters.txt" body={text} type="text/plain">Download chapters.txt</Download>
      </div>
      <div className="stack">
        <h3>Channel metadata</h3>
        {analysis.seo.titles.map((t, i) => (
          <div className="field" key={i}>
            <div className="field__head">
              <span className="label">Title option {i + 1}</span>
              <span className="field__count num">{t.length}/70</span>
            </div>
            <p className="field__value">{t}</p>
          </div>
        ))}
        <div className="field field--multi">
          <span className="label">Description</span>
          <pre className="field__pre">{analysis.seo.description}</pre>
        </div>
        <div className="field">
          <span className="label">Tags</span>
          <ul className="tags">
            {analysis.seo.tags.map((t) => <li key={t} className="tags__tag">{t}</li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Schedule({ analysis }: { analysis: Analysis }) {
  const byId = new Map(analysis.clips.map((c) => [c.id, c]));
  return (
    <div className="stack">
      <div className="ws__curve-head">
        <h3>A week of posts</h3>
        <Download name="schedule.csv" body={scheduleToCSV(analysis.schedule, analysis.clips)} type="text/csv">
          Download schedule.csv
        </Download>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Platform</th>
            <th scope="col">Clip</th>
            <th scope="col">Why this slot</th>
          </tr>
        </thead>
        <tbody>
          {analysis.schedule.map((s, i) => {
            const clip = byId.get(s.clipId);
            return (
              <tr key={i}>
                <td className="num table__when">
                  <span className="table__day">{s.dayLabel.slice(0, 3)}</span>
                  <span className="table__time">{s.time}</span>
                </td>
                <td>{PLATFORM_LABELS[s.platform]}</td>
                <td className="table__clip">{clip?.hook}</td>
                <td className="table__why">{s.rationale}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Export({ analysis, title }: { analysis: Analysis; title: string }) {
  const chapters = analysis.seo.chapters.map((c) => `${c.timecode} ${c.label}`).join('\n');
  const manual = analysis.stats.estimatedManualMinutes;

  const bundle = useMemo(() => {
    const parts: string[] = [
      `# ${title || 'Recording'} — HOOKLINE output`, '',
      `${humanDuration(analysis.stats.durationSec)} · ${analysis.stats.wordCount.toLocaleString()} words · ${analysis.stats.clipCount} clips`, '',
      '## Chapters', '', chapters, '',
      '## Clips', '',
    ];
    for (const c of analysis.clips) {
      parts.push(
        `### ${c.id} — ${formatTimecode(c.start)}–${formatTimecode(c.end)} (score ${c.score.toFixed(1)})`, '',
        `**Hook** ${c.hook}`, '',
        ...c.titles.map((t) => `- ${PLATFORM_LABELS[t.platform]}: ${t.text.replace(/\n/g, ' ')}`),
        '', `**Description**`, '', c.description, '',
        `**Hashtags** ${c.hashtags.join(' ')}`, '',
        `**Thumbnail** ${c.thumbnail.overlay} — grab at ${formatTimecode(c.thumbnail.frameAtSec)}`, '',
        '```srt', c.srt.trim(), '```', '',
      );
    }
    return parts.join('\n');
  }, [analysis, title, chapters]);

  return (
    <div className="two-col">
      <div className="stack">
        <h3>Take it out</h3>
        <p className="prose">
          Everything below was produced by the run above. The CLI in this repository writes the same
          package to a directory, including an ffmpeg script that renders each clip vertically with
          the captions burned in.
        </p>
        <div className="exports">
          <Download name="hookline-output.md" body={bundle} type="text/markdown">Full package (Markdown)</Download>
          <Download name="schedule.csv" body={scheduleToCSV(analysis.schedule, analysis.clips)} type="text/csv">schedule.csv</Download>
          <Download name="chapters.txt" body={chapters} type="text/plain">chapters.txt</Download>
          <Download name="analysis.json" body={JSON.stringify({ stats: analysis.stats, clips: analysis.clips, seo: analysis.seo, schedule: analysis.schedule }, null, 2)} type="application/json">analysis.json</Download>
          {analysis.clips.map((c) => (
            <Download key={c.id} name={`${c.id}.srt`} body={c.srt} type="text/plain">{c.id}.srt</Download>
          ))}
          {analysis.clips.map((c) => (
            <Download key={`${c.id}-t`} name={`${c.id}-thumbnail.svg`} body={renderThumbnailSVG(c, c.rank)} type="image/svg+xml">
              {c.id} thumbnail
            </Download>
          ))}
        </div>
      </div>
      <div className="stack">
        <h3>What this run replaces</h3>
        <ul className="ledger">
          <li><span className="num">{analysis.stats.clipCount}</span> clips found and trimmed to topic boundaries</li>
          <li><span className="num">{analysis.clips.reduce((n, c) => n + c.titles.length, 0)}</span> platform titles inside their character limits</li>
          <li><span className="num">{analysis.clips.reduce((n, c) => n + c.captions.length, 0)}</span> caption cues timed to the word</li>
          <li><span className="num">{analysis.seo.chapters.length}</span> chapter markers</li>
          <li><span className="num">{analysis.schedule.length}</span> scheduled posts with placement reasons</li>
        </ul>
        <p className="ledger__note">
          At twelve minutes of manual work per clip — finding it, trimming, writing the hook, titles
          per platform, description, tags, captions, thumbnail and calendar slot — that is roughly{' '}
          <strong className="num">{Math.floor(manual / 60)}h {manual % 60}m</strong>. It is an estimate of
          effort replaced, not a claim about reach.
        </p>
      </div>
    </div>
  );
}

function Download({
  name, body, type, children,
}: { name: string; body: string; type: string; children: React.ReactNode }) {
  const go = () => {
    const blob = new Blob([body], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };
  return <button type="button" className="btn btn--ghost btn--sm" onClick={go}>{children}</button>;
}
