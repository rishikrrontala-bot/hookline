import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyze, corpusMean } from './pipeline';
import { SIGNAL_WEIGHTS, metaScore } from './signals';
import type { Analysis } from './types';

const SRT = readFileSync('samples/the-algorithm-episode.srt', 'utf8');
const PROSE = readFileSync('samples/founder-interview.txt', 'utf8');

let a: Analysis;
let prose: Analysis;

beforeAll(() => {
  a = analyze(SRT, { clipCount: 6, sourceTitle: 'Test recording' });
  prose = analyze(PROSE, { clipCount: 4, sourceTitle: 'Prose recording' });
});

describe('determinism', () => {
  it('returns identical clips for identical input', () => {
    const again = analyze(SRT, { clipCount: 6, sourceTitle: 'Test recording' });
    expect(again.clips.map((c) => [c.start, c.end, c.score, c.hook]))
      .toEqual(a.clips.map((c) => [c.start, c.end, c.score, c.hook]));
  });
});

describe('signal model', () => {
  it('weights sum to 1, so the composite score stays on a 0..1 scale', () => {
    const total = Object.values(SIGNAL_WEIGHTS).reduce((n, w) => n + w, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it('keeps every per-sentence signal inside 0..1', () => {
    for (const s of a.sentences) {
      for (const [name, value] of Object.entries(s.signals)) {
        expect(Number.isFinite(value), `${name} finite`).toBe(true);
        expect(value, `${name} >= 0`).toBeGreaterThanOrEqual(0);
        expect(value, `${name} <= 1`).toBeLessThanOrEqual(1);
      }
      expect(s.attention).toBeGreaterThanOrEqual(0);
      expect(s.attention).toBeLessThanOrEqual(1);
    }
  });

  it('withholds the pace signal when timings were synthesized', () => {
    expect(prose.source.hasRealTimings).toBe(false);
    expect(prose.sentences.every((s) => s.signals.pace === 0)).toBe(true);
    // And still scores everything else, rather than collapsing to zero.
    expect(corpusMean(prose).hook).toBeGreaterThan(0);
  });

  it('scores stage direction below actual content', () => {
    expect(metaScore('Let me be specific about what I mean')).toBeGreaterThan(0.3);
    expect(metaScore('I want to say that plainly')).toBeGreaterThan(0.3);
    expect(metaScore('It cost me eleven thousand hours of work')).toBeLessThan(0.25);
  });
});

describe('topic boundaries', () => {
  it('finds boundaries strictly inside the recording, in order', () => {
    expect(a.boundaries.length).toBeGreaterThan(0);
    for (const b of a.boundaries) {
      expect(b.sentenceIndex).toBeGreaterThan(0);
      expect(b.sentenceIndex).toBeLessThan(a.sentences.length);
      expect(b.depth).toBeGreaterThan(0);
    }
    for (let i = 1; i < a.boundaries.length; i++) {
      expect(a.boundaries[i].sentenceIndex).toBeGreaterThan(a.boundaries[i - 1].sentenceIndex);
    }
  });

  it('covers the whole recording with contiguous segments', () => {
    expect(a.segments[0].startSentence).toBe(0);
    expect(a.segments[a.segments.length - 1].endSentence).toBe(a.sentences.length - 1);
    for (let i = 1; i < a.segments.length; i++) {
      expect(a.segments[i].startSentence).toBe(a.segments[i - 1].endSentence + 1);
    }
  });

  it('exposes a cohesion series whose valid range carries real measurements', () => {
    const [from, to] = a.cohesionRange;
    expect(to).toBeGreaterThan(from);
    for (const v of a.cohesion.slice(from, to)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('clip selection', () => {
  it('returns clips that never overlap in time', () => {
    const sorted = [...a.clips].sort((x, y) => x.start - y.start);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].start).toBeGreaterThanOrEqual(sorted[i - 1].end - 0.001);
    }
  });

  it('honours the requested duration bounds', () => {
    const tight = analyze(SRT, { clipCount: 5, minClipSec: 20, maxClipSec: 35 });
    for (const c of tight.clips) {
      expect(c.durationSec).toBeGreaterThanOrEqual(20);
      expect(c.durationSec).toBeLessThanOrEqual(35);
    }
  });

  it('ranks clips by descending score', () => {
    for (let i = 1; i < a.clips.length; i++) {
      expect(a.clips[i].score).toBeLessThanOrEqual(a.clips[i - 1].score);
      expect(a.clips[i].rank).toBe(i + 1);
    }
  });

  it('stays inside the recording and reports a consistent duration', () => {
    for (const c of a.clips) {
      expect(c.start).toBeGreaterThanOrEqual(0);
      expect(c.end).toBeLessThanOrEqual(a.stats.durationSec + 0.5);
      expect(c.durationSec).toBeCloseTo(c.end - c.start, 3);
    }
  });

  it('gives every clip an attributable reason', () => {
    for (const c of a.clips) {
      expect(c.evidence.length).toBeGreaterThan(0);
      expect(c.score).toBeGreaterThan(0);
    }
  });
});
