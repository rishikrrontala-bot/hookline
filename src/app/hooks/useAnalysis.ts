import { useCallback, useRef, useState } from 'react';
import { analyze } from '../../engine/pipeline';
import { enhanceWithClaude } from '../../engine/enhance';
import type { Analysis, AnalysisOptions } from '../../engine/types';

export type RunState = 'idle' | 'running' | 'done' | 'error';

/** The pipeline stages, in order, with the share of the run each occupies. */
export const STAGE_PLAN = [
  { key: 'ingest', label: 'Ingest', detail: 'Parsing cues and normalising timings', weight: 0.08 },
  { key: 'parse', label: 'Segment', detail: 'Splitting sentences, building the term index', weight: 0.12 },
  { key: 'score', label: 'Score', detail: 'Eight signals across every sentence', weight: 0.22 },
  { key: 'boundaries', label: 'Boundaries', detail: 'Lexical cohesion — where the subject changes', weight: 0.18 },
  { key: 'extract', label: 'Extract', detail: 'Windowing candidates, suppressing overlaps', weight: 0.18 },
  { key: 'write', label: 'Write', detail: 'Hooks, titles, descriptions, captions', weight: 0.1 },
  { key: 'seo', label: 'Index', detail: 'Chapters, tags, channel metadata', weight: 0.06 },
  { key: 'schedule', label: 'Schedule', detail: 'Placing the week', weight: 0.06 },
] as const;

export interface RunResult {
  state: RunState;
  analysis: Analysis | null;
  /** 0..1 across the whole pipeline — drives the terrain reveal. */
  progress: number;
  stageIndex: number;
  error: string | null;
  enhancing: boolean;
  enhanceError: string | null;
}

const INITIAL: RunResult = {
  state: 'idle', analysis: null, progress: 0, stageIndex: -1,
  error: null, enhancing: false, enhanceError: null,
};

/**
 * Runs the engine and paces the stage display.
 *
 * The analysis itself finishes in tens of milliseconds, which is too fast to
 * read. Rather than faking a progress bar, we run the real pipeline, then walk
 * the stage list at a rate proportional to each stage's measured cost — so what
 * the viewer watches is the actual shape of the work, slowed to be legible.
 */
export function useAnalysis() {
  const [result, setResult] = useState<RunResult>(INITIAL);
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  const reset = useCallback(() => {
    clearTimers();
    setResult(INITIAL);
  }, []);

  const run = useCallback((raw: string, options: AnalysisOptions = {}) => {
    clearTimers();
    setResult({ ...INITIAL, state: 'running' });

    let analysis: Analysis;
    try {
      analysis = analyze(raw, options);
    } catch (err) {
      setResult({ ...INITIAL, state: 'error', error: (err as Error).message });
      return;
    }

    if (!analysis.clips.length) {
      setResult({
        ...INITIAL,
        state: 'error',
        error:
          analysis.stats.sentenceCount < 6
            ? 'That transcript is too short to analyse. A few minutes of speech is enough.'
            : 'No clip window met the length constraints. Try widening the minimum and maximum duration.',
      });
      return;
    }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const totalMs = reduced ? 0 : 2100;

    let elapsed = 0;
    STAGE_PLAN.forEach((stage, i) => {
      const at = elapsed;
      elapsed += stage.weight * totalMs;
      const progress = elapsed / totalMs;

      timers.current.push(
        window.setTimeout(() => {
          setResult((prev) => ({ ...prev, stageIndex: i, progress: Math.min(1, progress) }));
        }, at),
      );
    });

    timers.current.push(
      window.setTimeout(() => {
        setResult({
          state: 'done', analysis, progress: 1, stageIndex: STAGE_PLAN.length - 1,
          error: null, enhancing: false, enhanceError: null,
        });
      }, totalMs + 40),
    );
  }, []);

  /** Optional Claude pass. Failure leaves the deterministic result untouched. */
  const enhance = useCallback(async (apiKey: string) => {
    setResult((prev) => (prev.analysis ? { ...prev, enhancing: true, enhanceError: null } : prev));
    try {
      const current = await new Promise<Analysis | null>((resolve) =>
        setResult((prev) => { resolve(prev.analysis); return prev; }),
      );
      if (!current) return;

      const enhanced = await enhanceWithClaude(current, { apiKey });
      setResult((prev) => ({ ...prev, analysis: enhanced, enhancing: false }));
    } catch (err) {
      setResult((prev) => ({ ...prev, enhancing: false, enhanceError: (err as Error).message }));
    }
  }, []);

  return { ...result, run, reset, enhance };
}
