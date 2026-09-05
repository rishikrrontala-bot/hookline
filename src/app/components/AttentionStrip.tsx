import { useMemo, useId } from 'react';
import type { Analysis, Clip } from '../../engine/types';
import { formatTimecode } from '../../engine/ingest';

interface Props {
  analysis: Analysis;
  selectedId: string | null;
  onSelect: (id: string) => void;
  height?: number;
}

/**
 * The attention curve as a precise instrument readout.
 *
 * The 3D terrain is the same data made physical; this is the same data made
 * exact. Everything the terrain shows is legible here too, which is what lets
 * the terrain be decorative-redundant and disappear under reduced motion.
 */
export function AttentionStrip({ analysis, selectedId, onSelect, height = 132 }: Props) {
  const uid = useId().replace(/:/g, '');
  const W = 1000;
  const H = height;
  const pad = 10;

  const { area, line } = useMemo(() => {
    const pts = analysis.curve;
    if (!pts.length) return { area: '', line: '' };

    const x = (i: number) => (i / (pts.length - 1)) * W;
    const y = (v: number) => H - pad - v * (H - pad * 2);

    // Catmull-Rom through the samples, emitted as cubic béziers — the curve is
    // a continuous measurement and should not read as a polyline.
    let d = `M ${x(0).toFixed(2)} ${y(pts[0].v).toFixed(2)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      const c1x = x(i) + (x(i + 1) - x(Math.max(0, i - 1))) / 6;
      const c1y = y(p1.v) + (y(p2.v) - y(p0.v)) / 6;
      const c2x = x(i + 1) - (x(Math.min(pts.length - 1, i + 2)) - x(i)) / 6;
      const c2y = y(p2.v) - (y(p3.v) - y(p1.v)) / 6;
      d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${x(i + 1).toFixed(2)} ${y(p2.v).toFixed(2)}`;
    }

    return { line: d, area: `${d} L ${W} ${H} L 0 ${H} Z` };
  }, [analysis.curve, H]);

  const duration = analysis.stats.durationSec || 1;
  const toX = (sec: number) => (sec / duration) * W;

  const ticks = useMemo(() => {
    const target = 6;
    const raw = duration / target;
    const step = [30, 60, 120, 300, 600, 900, 1800, 3600].find((s) => s >= raw) ?? 3600;
    const out: number[] = [];
    for (let t = 0; t <= duration; t += step) out.push(t);
    return out;
  }, [duration]);

  return (
    <div className="strip">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="strip__svg"
        role="img"
        aria-label={`Attention curve across ${formatTimecode(duration)}, with ${analysis.clips.length} selected clips marked.`}
      >
        <defs>
          <linearGradient id={`${uid}fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--heat-500)" stopOpacity="0.42" />
            <stop offset="55%" stopColor="var(--heat-600)" stopOpacity="0.12" />
            <stop offset="100%" stopColor="var(--heat-600)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${uid}stroke`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="var(--t2)" />
            <stop offset="45%" stopColor="var(--t4)" />
            <stop offset="100%" stopColor="var(--t6)" />
          </linearGradient>
        </defs>

        {ticks.map((t) => (
          <line key={t} x1={toX(t)} y1={0} x2={toX(t)} y2={H} className="strip__tick" />
        ))}

        {analysis.boundaries.map((b, i) => (
          <line key={i} x1={toX(b.timeSec)} y1={pad * 0.5} x2={toX(b.timeSec)} y2={H} className="strip__boundary" />
        ))}

        <path d={area} fill={`url(#${uid}fill)`} />
        <path d={line} fill="none" stroke={`url(#${uid}stroke)`} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />

        {analysis.clips.map((clip) => {
          const x = toX(clip.start);
          const w = Math.max(2, toX(clip.end) - x);
          const active = clip.id === selectedId;
          return (
            <g key={clip.id} className={`strip__clip${active ? ' is-active' : ''}`}>
              <rect x={x} y={0} width={w} height={H} rx="1" />
              <line x1={x} y1={0} x2={x} y2={H} />
            </g>
          );
        })}
      </svg>

      <div className="strip__hits">
        {analysis.clips.map((clip) => (
          <ClipHandle
            key={clip.id}
            clip={clip}
            left={(clip.start / duration) * 100}
            width={Math.max(0.8, ((clip.end - clip.start) / duration) * 100)}
            active={clip.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>

      <div className="strip__axis" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t} className="strip__axis-label num" style={{ left: `${(t / duration) * 100}%` }}>
            {formatTimecode(t)}
          </span>
        ))}
      </div>
    </div>
  );
}

function ClipHandle({
  clip, left, width, active, onSelect,
}: { clip: Clip; left: number; width: number; active: boolean; onSelect: (id: string) => void }) {
  return (
    <button
      type="button"
      className={`strip__handle${active ? ' is-active' : ''}`}
      style={{ left: `${left}%`, width: `${width}%` }}
      onClick={() => onSelect(clip.id)}
      aria-pressed={active}
    >
      <span className="visually-hidden">
        Clip {clip.rank}, {formatTimecode(clip.start)} to {formatTimecode(clip.end)}, score {clip.score.toFixed(0)}
      </span>
      <span className="strip__handle-rank num" aria-hidden="true">{clip.rank}</span>
    </button>
  );
}
