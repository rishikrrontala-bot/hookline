// Converts the authored prose sample into a realistic SRT with human-looking
// cue timings: variable delivery rate, breath pauses, and a beat between
// paragraphs. Run once to regenerate samples/the-algorithm-episode.srt.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('./episode.txt', import.meta.url), 'utf8');
const paragraphs = src.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);

// Deterministic jitter so the sample file is stable across regenerations.
let seed = 20260905;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

const pad = (n, w = 2) => String(n).padStart(w, '0');
const tc = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60), ms = Math.round((s - Math.floor(s)) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(sec)},${pad(ms, 3)}`;
};

const cues = [];
let t = 2.4;

for (const para of paragraphs) {
  // Split into caption-sized chunks the way an auto-captioner would.
  const words = para.split(' ');
  let buf = [];
  const flush = (hard) => {
    if (!buf.length) return;
    const text = buf.join(' ');
    // ~2.6 words/sec baseline with ±18% variation; emphasis lines run slower.
    const rate = 2.6 * (0.82 + rnd() * 0.36) * (/[!?]$/.test(text) ? 0.86 : 1);
    const dur = Math.max(0.9, buf.length / rate);
    cues.push({ start: t, end: t + dur, text });
    t += dur + (hard ? 0.22 + rnd() * 0.3 : 0.06);
    buf = [];
  };

  for (const w of words) {
    buf.push(w);
    const joined = buf.join(' ');
    if (/[.!?]["')]?$/.test(w) && joined.length > 24) flush(true);
    else if (joined.length >= 62) flush(false);
  }
  flush(true);
  t += 0.5 + rnd() * 0.6; // beat between paragraphs
}

const srt = cues
  .map((c, i) => `${i + 1}\n${tc(c.start)} --> ${tc(c.end)}\n${c.text}\n`)
  .join('\n');

writeFileSync(new URL('../the-algorithm-episode.srt', import.meta.url), srt);
console.log(`${cues.length} cues · ${(t / 60).toFixed(1)} min`);
