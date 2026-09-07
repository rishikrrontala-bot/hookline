import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyze } from './pipeline';
import { PLATFORM_LIMITS } from './generate/titles';
import { renderThumbnailSVG } from './generate/thumbnail';
import { parseTimecode } from './ingest';
import { scheduleToCSV } from './schedule';
import type { Analysis } from './types';

const SRT = readFileSync('samples/the-algorithm-episode.srt', 'utf8');
const PROSE = readFileSync('samples/founder-interview.txt', 'utf8');

let a: Analysis;
beforeAll(() => { a = analyze(SRT, { clipCount: 6, sourceTitle: 'Test recording' }); });

/** Words the engine may legitimately add as connective tissue. */
const CONNECTIVES = new Set([
  'here', 'heres', 'what', 'actually', 'happens', 'and', 'the', 'a', 'an', 'is', 'it',
  'everyone', 'gets', 'this', 'backwards', 'cost', 'whats', 'thats', 'i', 'to', 'of',
]);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);

describe('hooks are drawn from the transcript, not invented', () => {
  it('uses only words the clip actually contains', () => {
    for (const clip of a.clips) {
      const spoken = new Set(norm(clip.transcript));
      const invented = norm(clip.hook).filter((w) => !spoken.has(w) && !CONNECTIVES.has(w));
      expect(invented, `clip ${clip.id} hook: "${clip.hook}"`).toEqual([]);
    }
  });

  it('never ends a hook on a dangling fragment', () => {
    for (const clip of a.clips) {
      expect(clip.hook.trim()).toMatch(/[.!?]["')\]]?$/);
      // The specific defect this guards: a truncated clause with '?' bolted on.
      expect(clip.hook).not.toMatch(/\b(the|a|an|of|to|in|on|for|and|but|that|including)\s*[.?!]$/i);
    }
  });

  it('starts a hook with a capital and gives it real substance', () => {
    for (const clip of a.clips) {
      expect(clip.hook[0]).toBe(clip.hook[0].toUpperCase());
      expect(clip.hook.split(/\s+/).length).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('titles respect platform limits', () => {
  it('never exceeds a platform character limit', () => {
    for (const clip of a.clips) {
      for (const t of clip.titles) {
        expect(t.limit).toBe(PLATFORM_LIMITS[t.platform]);
        expect(t.chars, `${clip.id} ${t.platform}`).toBeLessThanOrEqual(t.limit);
        expect(t.chars).toBe(t.text.length);
      }
    }
  });

  it('produces a non-empty title for every requested platform', () => {
    const wanted = ['youtube-shorts', 'tiktok', 'instagram-reels', 'x', 'linkedin'] as const;
    const multi = analyze(SRT, { clipCount: 2, platforms: [...wanted] });
    for (const clip of multi.clips) {
      expect(clip.titles.map((t) => t.platform).sort()).toEqual([...wanted].sort());
      for (const t of clip.titles) expect(t.text.trim().length).toBeGreaterThan(3);
    }
  });
});

describe('captions', () => {
  it('emits cues that advance in time and never invert', () => {
    for (const clip of a.clips) {
      expect(clip.captions.length).toBeGreaterThan(0);
      let prev = -1;
      for (const cue of clip.captions) {
        expect(cue.end).toBeGreaterThan(cue.start);
        expect(cue.start).toBeGreaterThanOrEqual(prev);
        prev = cue.start;
      }
    }
  });

  it('keeps cues inside the clip duration', () => {
    for (const clip of a.clips) {
      const last = clip.captions[clip.captions.length - 1];
      expect(clip.captions[0].start).toBeGreaterThanOrEqual(0);
      expect(last.end).toBeLessThanOrEqual(clip.durationSec + 0.5);
    }
  });

  it('wraps to at most two lines within the burn-in width', () => {
    for (const clip of a.clips) {
      for (const cue of clip.captions) {
        const lines = cue.text.split('\n');
        expect(lines.length).toBeLessThanOrEqual(2);
        for (const line of lines) expect(line.length).toBeLessThanOrEqual(44);
      }
    }
  });

  it('writes SRT that parses back to the same cue count and timings', () => {
    for (const clip of a.clips) {
      const blocks = clip.srt.trim().split(/\n\s*\n/);
      expect(blocks.length).toBe(clip.captions.length);
      const times = [...clip.srt.matchAll(/(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/g)];
      expect(times.length).toBe(clip.captions.length);
      times.forEach(([, from, to], i) => {
        expect(parseTimecode(from)).toBeCloseTo(clip.captions[i].start, 2);
        expect(parseTimecode(to)!).toBeGreaterThan(parseTimecode(from)!);
      });
    }
  });

  it('writes VTT with the required header and dot-separated timings', () => {
    for (const clip of a.clips) {
      expect(clip.vtt.startsWith('WEBVTT')).toBe(true);
      expect(clip.vtt).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3} --> /);
    }
  });
});

describe('thumbnails', () => {
  it('renders well-formed 9:16 SVG with the overlay text escaped', () => {
    for (const clip of a.clips) {
      const svg = renderThumbnailSVG(clip, clip.rank);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
      expect(svg).toContain('viewBox="0 0 810 1440"');
      expect(svg).not.toMatch(/<script/i);
      // Balanced tags: a truncated SVG renders as nothing.
      expect((svg.match(/<text/g) ?? []).length).toBe((svg.match(/<\/text>/g) ?? []).length);
    }
  });

  it('grabs a frame inside the clip', () => {
    for (const clip of a.clips) {
      expect(clip.thumbnail.frameAtSec).toBeGreaterThanOrEqual(clip.start);
      expect(clip.thumbnail.frameAtSec).toBeLessThanOrEqual(clip.end);
      expect(clip.thumbnail.overlay.length).toBeGreaterThan(1);
    }
  });
});

describe('chapters and schedule', () => {
  it('starts chapters at zero and advances monotonically', () => {
    expect(a.seo.chapters.length).toBeGreaterThanOrEqual(3);
    expect(a.seo.chapters[0].start).toBe(0);
    for (let i = 1; i < a.seo.chapters.length; i++) {
      expect(a.seo.chapters[i].start).toBeGreaterThan(a.seo.chapters[i - 1].start);
    }
  });

  it('gives every chapter a distinct, non-empty label', () => {
    const labels = a.seo.chapters.map((c) => c.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const l of labels) expect(l.trim().length).toBeGreaterThan(2);
  });

  it('keeps channel titles inside the 70-character limit and well formed', () => {
    for (const t of a.seo.titles) {
      expect(t.length).toBeLessThanOrEqual(70);
      expect(t).not.toMatch(/\b(a|an|the|of|to|in|on|for|and|that|which|is|was|had|been)$/i);
    }
  });

  it('schedules every clip exactly once, with a reason', () => {
    expect(a.schedule.length).toBe(a.clips.length);
    expect(new Set(a.schedule.map((s) => s.clipId)).size).toBe(a.clips.length);
    for (const slot of a.schedule) {
      expect(slot.time).toMatch(/^\d{2}:\d{2}$/);
      expect(slot.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(slot.rationale.trim().length).toBeGreaterThan(10);
    }
  });

  it('emits CSV with one header plus one row per slot, and balanced quotes', () => {
    const csv = scheduleToCSV(a.schedule, a.clips);
    const rows = csv.split('\n');
    expect(rows.length).toBe(a.schedule.length + 1);
    for (const row of rows) expect((row.match(/"/g) ?? []).length % 2).toBe(0);
  });
});

describe('prose input still produces a complete package', () => {
  it('fills every output field without real timings', () => {
    const p = analyze(PROSE, { clipCount: 3, sourceTitle: 'Prose' });
    expect(p.clips.length).toBeGreaterThan(0);
    for (const c of p.clips) {
      expect(c.hook.length).toBeGreaterThan(8);
      expect(c.titles.length).toBeGreaterThan(0);
      expect(c.captions.length).toBeGreaterThan(0);
      expect(c.hashtags.length).toBeGreaterThan(0);
      expect(c.srt.length).toBeGreaterThan(20);
    }
  });
});
