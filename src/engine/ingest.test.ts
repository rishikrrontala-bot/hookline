import { describe, it, expect } from 'vitest';
import { ingest, parseTimecode, formatTimecode, humanDuration } from './ingest';

const SRT = `1
00:00:02,400 --> 00:00:05,593
Everybody tells you the algorithm decides who wins.

2
00:00:06,007 --> 00:00:11,449
I spent four years believing that, and it cost me eleven thousand hours.
`;

const VTT = `WEBVTT

00:00:01.000 --> 00:00:04.000
The first line of the recording.

00:00:04.500 --> 00:00:08.000
And the second line, which follows it.
`;

const YOUTUBE = `0:00 Everybody tells you the algorithm decides who wins.
0:12 I spent four years believing that.
1:04 It cost me eleven thousand hours of work.`;

describe('parseTimecode', () => {
  it('reads SRT comma milliseconds and VTT dot milliseconds alike', () => {
    expect(parseTimecode('00:00:02,400')).toBeCloseTo(2.4, 3);
    expect(parseTimecode('00:00:02.400')).toBeCloseTo(2.4, 3);
  });

  it('reads bare minute:second and hour:minute:second', () => {
    expect(parseTimecode('1:30')).toBe(90);
    expect(parseTimecode('01:02:03')).toBe(3723);
  });

  it('returns null rather than NaN for junk', () => {
    for (const junk of ['', 'abc', '::', 'BAD --> WORSE']) {
      expect(parseTimecode(junk)).toBeNull();
    }
  });
});

describe('formatTimecode', () => {
  it('round-trips through parseTimecode', () => {
    for (const sec of [0, 7.25, 61, 3599.5, 7322.125]) {
      expect(parseTimecode(formatTimecode(sec, { ms: true }))).toBeCloseTo(sec, 2);
    }
  });

  it('uses the comma separator SRT requires', () => {
    expect(formatTimecode(2.4, { ms: true, comma: true })).toBe('00:00:02,400');
    expect(formatTimecode(2.4, { ms: true })).toBe('00:00:02.400');
  });
});

describe('ingest', () => {
  it('detects each supported format', () => {
    expect(ingest(SRT).format).toBe('srt');
    expect(ingest(VTT).format).toBe('vtt');
    expect(ingest(YOUTUBE).format).toBe('timecoded');
    expect(ingest('Just some prose with no timings at all in it.').format).toBe('plain');
  });

  it('keeps real timings and flags synthesized ones', () => {
    expect(ingest(SRT).hasRealTimings).toBe(true);
    expect(ingest(VTT).hasRealTimings).toBe(true);
    expect(ingest('Prose without timings.').hasRealTimings).toBe(false);
  });

  it('produces cues ordered in time with positive duration', () => {
    const { cues } = ingest(SRT);
    expect(cues.length).toBeGreaterThan(0);
    for (const c of cues) expect(c.end).toBeGreaterThan(c.start);
    for (let i = 1; i < cues.length; i++) expect(cues[i].start).toBeGreaterThanOrEqual(cues[i - 1].start);
  });

  it('strips subtitle markup rather than treating it as speech', () => {
    const tagged = SRT.replace('Everybody', '<i>Everybody</i> [MUSIC]');
    const text = ingest(tagged).cues.map((c) => c.text).join(' ');
    expect(text).not.toContain('<i>');
    expect(text).not.toContain('[MUSIC]');
    expect(text).toContain('Everybody');
  });

  it('falls back to prose when the timecodes are malformed', () => {
    const broken = '1\n00:00:BAD --> 00:00:WORSE\nSome spoken words here.\n\n2\nnope\nAnd some more words after that.';
    const result = ingest(broken);
    expect(result.hasRealTimings).toBe(false);
    expect(result.wordCount).toBeGreaterThan(5);
    // The timecode debris must not survive into the analysed text.
    expect(result.cues.map((c) => c.text).join(' ')).not.toMatch(/-->/);
  });

  it('survives empty and whitespace-only input without throwing', () => {
    for (const input of ['', '   ', '\n\n\t']) {
      const r = ingest(input);
      expect(r.wordCount).toBe(0);
      expect(r.durationSec).toBeGreaterThanOrEqual(0);
    }
  });

  it('counts only spoken words, not indices or timecodes', () => {
    // 8 words in the first cue, 13 in the second; indices and timecodes
    // must not inflate the count.
    expect(ingest(SRT).wordCount).toBe(21);
  });
});

describe('humanDuration', () => {
  it('scales its unit to the length', () => {
    expect(humanDuration(42)).toBe('42s');
    expect(humanDuration(125)).toMatch(/^2m/);
    expect(humanDuration(3700)).toMatch(/^1h/);
  });
});
