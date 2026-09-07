import type { Cue, Ingested, SourceFormat } from './types';
import { words } from './text/tokenize';

/** `00:01:23,456` / `00:01:23.456` / `1:23` / `83.5` → seconds. */
export function parseTimecode(raw: string): number | null {
  const s = raw.trim().replace(',', '.');
  const m = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  if (m) {
    const h = m[1] ? Number(m[1]) : 0;
    return h * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  return null;
}

export function formatTimecode(sec: number, opts: { ms?: boolean; comma?: boolean; force?: boolean } = {}): string {
  const total = Math.max(0, sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');

  if (opts.ms) {
    const msec = Math.round((total - Math.floor(total)) * 1000);
    const sep = opts.comma ? ',' : '.';
    return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(msec, 3)}`;
  }
  if (h > 0 || opts.force) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

/** Human duration, e.g. `1h 12m` or `42s`. */
export function humanDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

function detectFormat(text: string): SourceFormat {
  const head = text.slice(0, 4000);
  if (/^\s*WEBVTT/m.test(head)) return 'vtt';
  if (/^\s*\d+\s*\r?\n\s*\d{1,2}:\d{2}:\d{2}[.,]\d{3}\s*-->/m.test(head)) return 'srt';
  if (/-->/.test(head) && /\d{1,2}:\d{2}/.test(head)) return 'vtt';
  // A pasted YouTube transcript: a bare timecode leading most lines.
  const lines = head.split(/\r?\n/).filter((l) => l.trim());
  const timecoded = lines.filter((l) => /^\s*\(?\[?\d{1,2}:\d{2}(:\d{2})?\]?\)?[\s\-–—:]/.test(l)).length;
  // Two lines is enough to be sure: prose does not begin 40% of its lines with
  // a timecode. Requiring four discarded the real timings on a short pasted
  // transcript and silently fell back to a words-per-minute estimate.
  if (lines.length >= 2 && timecoded / lines.length > 0.4) return 'timecoded';
  return 'plain';
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/\{\\?[^}]*\}/g, '')
    .replace(/^\s*[-–—]\s*/, '')
    .replace(/\[[A-Z ]{2,}\]/g, '') // [MUSIC], [APPLAUSE]
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCueBlocks(text: string): Cue[] {
  const blocks = text.replace(/^﻿/, '').split(/\r?\n\s*\r?\n/);
  const cues: Cue[] = [];

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const arrowIdx = lines.findIndex((l) => l.includes('-->'));
    if (arrowIdx === -1) continue;

    const [rawStart, rawEnd] = lines[arrowIdx].split('-->').map((p) => p.trim().split(/\s+/)[0]);
    const start = parseTimecode(rawStart);
    const end = parseTimecode(rawEnd);
    if (start === null || end === null) continue;

    const body = stripTags(lines.slice(arrowIdx + 1).join(' '));
    if (!body) continue;
    cues.push({ start, end: Math.max(end, start + 0.2), text: body });
  }
  return cues;
}

function parseTimecoded(text: string): Cue[] {
  const cues: Cue[] = [];
  const lines = text.split(/\r?\n/);
  const re = /^\s*\(?\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\)?[\s\-–—:]*(.*)$/;

  for (const line of lines) {
    const m = line.match(re);
    if (!m) {
      // Continuation of the previous cue.
      const body = stripTags(line);
      if (body && cues.length) cues[cues.length - 1].text += ' ' + body;
      continue;
    }
    const t = parseTimecode(m[1]);
    const body = stripTags(m[2]);
    if (t === null || !body) continue;
    cues.push({ start: t, end: t + 4, text: body });
  }

  for (let i = 0; i < cues.length - 1; i++) {
    cues[i].end = Math.max(cues[i].start + 0.4, cues[i + 1].start);
  }
  return cues;
}

/**
 * Plain prose has no timings, so we synthesize them from a words-per-minute
 * model. The engine tracks this in `hasRealTimings` and withholds the delivery
 * pace signal rather than scoring noise.
 */
function synthesize(text: string, wpm: number): Cue[] {
  const perWord = 60 / wpm;
  const paragraphs = text.split(/\r?\n\s*\r?\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const chunks = paragraphs.length ? paragraphs : [text.replace(/\s+/g, ' ').trim()];

  const cues: Cue[] = [];
  let t = 0;
  for (const chunk of chunks) {
    const n = words(chunk).length;
    if (!n) continue;
    const dur = n * perWord;
    cues.push({ start: t, end: t + dur, text: chunk });
    t += dur + 0.35; // a beat between paragraphs
  }
  return cues;
}

/** Merge micro-cues (common in auto-generated SRT) into readable units. */
function coalesce(cues: Cue[], targetWords = 14): Cue[] {
  const out: Cue[] = [];
  for (const cue of cues) {
    const last = out[out.length - 1];
    const lastWords = last ? words(last.text).length : Infinity;
    const gap = last ? cue.start - last.end : Infinity;
    const endsSentence = last ? /[.!?]["')\]]?$/.test(last.text) : true;

    if (last && lastWords < targetWords && gap < 1.6 && !endsSentence) {
      last.text = `${last.text} ${cue.text}`.replace(/\s+/g, ' ');
      last.end = cue.end;
    } else {
      out.push({ ...cue });
    }
  }
  return out;
}

export function ingest(raw: string, opts: { wpm?: number } = {}): Ingested {
  const text = raw.replace(/\r\n/g, '\n');
  const format = detectFormat(text);
  const wpm = opts.wpm ?? 150;

  let cues: Cue[];
  let hasRealTimings = true;

  switch (format) {
    case 'srt':
    case 'vtt':
      cues = coalesce(parseCueBlocks(text));
      break;
    case 'timecoded':
      cues = coalesce(parseTimecoded(text));
      break;
    default:
      cues = synthesize(text, wpm);
      hasRealTimings = false;
  }

  // Any parse that produced nothing usable falls back to prose handling rather
  // than returning an empty analysis.
  if (cues.length < 2) {
    const stripped = text
      .replace(/^\s*\d+\s*$/gm, '')
      .replace(/^.*-->.*$/gm, '')
      .replace(/^\s*WEBVTT.*$/gm, '')
      .replace(/^\s*\(?\[?\d{1,2}:\d{2}(:\d{2})?\]?\)?[\s\-–—:]*/gm, '');
    cues = synthesize(stripped, wpm);
    hasRealTimings = false;
  }

  cues.sort((a, b) => a.start - b.start);
  const wordCount = cues.reduce((n, c) => n + words(c.text).length, 0);
  const durationSec = cues.length ? cues[cues.length - 1].end : 0;

  return { cues, format, hasRealTimings, durationSec, wordCount };
}
