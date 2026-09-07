import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyze } from './pipeline';

const SRT = readFileSync('samples/the-algorithm-episode.srt', 'utf8');

/** Repeat the sample with timecodes shifted forward, as a longer recording would run. */
function longer(mult: number): string {
  const blocks = SRT.trim().split(/\n\s*\n/);
  const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, '0');
  const shift = (tc: string, off: number) => {
    const [h, m, s] = tc.split(/[:,]/).map(Number);
    const t = h * 3600 + m * 60 + s + off;
    return `${pad(t / 3600)}:${pad((t % 3600) / 60)}:${pad(t % 60)},${tc.split(',')[1]}`;
  };
  const out: string[] = [];
  let idx = 1;
  for (let r = 0; r < mult; r++) {
    for (const b of blocks) {
      const lines = b.split('\n');
      const [from, to] = lines[1].split(' --> ');
      out.push(`${idx++}\n${shift(from, r * 610)} --> ${shift(to, r * 610)}\n${lines.slice(2).join('\n')}`);
    }
  }
  return out.join('\n\n');
}

describe('degenerate input never throws', () => {
  const cases: [string, string][] = [
    ['empty string', ''],
    ['whitespace only', '   \n\n\t '],
    ['a single word', 'hello'],
    ['one sentence', 'This is a single sentence and nothing else.'],
    ['no punctuation at all', 'so i was thinking about the thing and then another thing happened '.repeat(12)],
    ['non-latin script', 'Privet! Kore wa tesuto desu. A real English sentence about retention here. '.repeat(8)],
    ['html markup', '<p>Everybody tells you the algorithm decides.</p><script>alert(1)</script>'.repeat(10)],
    ['broken srt timecodes', '1\n00:00:BAD --> 00:00:WORSE\nSome spoken words.\n\n2\nnope\nMore words follow.'],
    ['one enormous line', 'word '.repeat(3000)],
    ['control characters', 'Some text with a \u0000 control byte in the middle of it.'],
  ];

  for (const [name, input] of cases) {
    it(name, () => {
      const a = analyze(input, { clipCount: 4 });
      expect(Array.isArray(a.clips)).toBe(true);
      expect(a.stats.clipCount).toBe(a.clips.length);
      // Whatever comes back must be internally consistent, even when empty.
      for (const c of a.clips) {
        expect(c.end).toBeGreaterThan(c.start);
        expect(c.hook.length).toBeGreaterThan(0);
      }
    });
  }
});

describe('option handling', () => {
  it('never returns more clips than requested', () => {
    for (const n of [1, 3, 12]) {
      expect(analyze(SRT, { clipCount: n }).clips.length).toBeLessThanOrEqual(n);
    }
  });

  it('returns nothing rather than something wrong when bounds are impossible', () => {
    const a = analyze(SRT, { clipCount: 4, minClipSec: 600, maxClipSec: 601 });
    expect(a.clips).toEqual([]);
  });

  it('accepts a schedule start date and places the week from it', () => {
    const a = analyze(SRT, { clipCount: 4, scheduleStart: new Date('2026-03-02T12:00:00') });
    for (const slot of a.schedule) {
      expect(new Date(`${slot.date}T00:00:00`).getTime())
        .toBeGreaterThanOrEqual(new Date('2026-03-02T00:00:00').getTime());
    }
  });
});

describe('scale', () => {
  it('stays roughly linear on a long recording', () => {
    const t0 = performance.now();
    const short = analyze(longer(1), { clipCount: 8 });
    const shortMs = performance.now() - t0;

    const t1 = performance.now();
    const long = analyze(longer(12), { clipCount: 8 });
    const longMs = performance.now() - t1;

    expect(long.stats.sentenceCount).toBeGreaterThan(short.stats.sentenceCount * 8);
    // Twelve times the transcript must not cost anywhere near twelve squared.
    expect(longMs).toBeLessThan(Math.max(60, shortMs) * 20);
    expect(long.clips.length).toBe(8);
  });

  it('does not degrade to a quadratic search when timestamps run backwards', () => {
    // A concatenated or badly edited subtitle file repeats its timecodes, so the
    // duration break in the candidate search never fires. Before the sentence
    // ceiling was added this locked the tab for over twelve seconds.
    //
    // The assertion is a ratio against a well-formed transcript of the same
    // size, measured on the same machine. An absolute millisecond budget looks
    // stricter but only measures how busy the CI runner is: this test failed at
    // 8.2s on a shared runner having passed at 3.5s locally, which said nothing
    // about the algorithm.
    const wellFormed = longer(12);
    const scrambled = Array.from({ length: 12 }, () => SRT).join('\n\n');

    const t0 = performance.now();
    const baseline = analyze(wellFormed, { clipCount: 6 });
    const baselineMs = Math.max(1, performance.now() - t0);

    const t1 = performance.now();
    const a = analyze(scrambled, { clipCount: 6 });
    const scrambledMs = performance.now() - t1;

    expect(a.clips.length).toBeGreaterThan(0);
    expect(baseline.stats.sentenceCount).toBe(a.stats.sentenceCount);
    // Unbounded, this ratio was over 45x and grew with the transcript.
    expect(scrambledMs / baselineMs).toBeLessThan(30);
  });
});
