import { STOPWORDS, SIGNAL_STOPWORDS } from './stopwords';
import { SUFFIXES } from './lexicons';

const WORD_RE = /[a-z0-9][a-z0-9'’-]*/g;

export function words(text: string): string[] {
  return text.toLowerCase().match(WORD_RE)?.map((w) => w.replace(/[’']s$/, '')) ?? [];
}

/**
 * Light suffix stripper. Not a Porter stemmer — deliberately conservative, so
 * that "running"→"run" and "creators"→"creator" collapse but short words are
 * left alone rather than mangled into collisions.
 */
export function stem(word: string): string {
  if (word.length <= 4) return word;
  for (const suffix of SUFFIXES) {
    if (word.length - suffix.length >= 3 && word.endsWith(suffix)) {
      let base = word.slice(0, -suffix.length);
      // Undo doubled consonants left behind by -ing/-ed ("shipp" -> "ship").
      if (/([bdfglmnprt])\1$/.test(base)) base = base.slice(0, -1);
      return base;
    }
  }
  return word;
}

/** Content terms for TF-IDF: stopwords out, stems in, single letters dropped. */
export function contentTerms(tokens: string[]): string[] {
  const out: string[] = [];
  for (const t of tokens) {
    if (t.length < 3) continue;
    if (STOPWORDS.has(t) && !SIGNAL_STOPWORDS.has(t)) continue;
    if (STOPWORDS.has(t)) continue;
    if (/^\d+$/.test(t)) continue;
    out.push(stem(t));
  }
  return out;
}

const ABBREV = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'e.g', 'i.e', 'inc', 'ltd', 'co', 'approx', 'fig', 'no']);

/**
 * Sentence splitter tuned for speech: transcripts are frequently unpunctuated
 * or lightly punctuated, so we split on terminal punctuation first and then
 * force-break any run that exceeds `maxWords` at the nearest clause marker.
 */
export function splitSentences(text: string, maxWords = 34): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const rough: string[] = [];
  let buffer = '';
  const chars = [...normalized];

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    buffer += ch;
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;

    // Don't split inside decimals ("3.5") or ellipses.
    const next = chars[i + 1];
    const prev = chars[i - 1];
    if (ch === '.' && /\d/.test(prev ?? '') && /\d/.test(next ?? '')) continue;
    if (next === '.' || prev === '.') continue;

    const lastWord = buffer.trim().split(/\s+/).pop()?.replace(/[.!?]+$/, '').toLowerCase() ?? '';
    if (ABBREV.has(lastWord)) continue;
    if (next && next !== ' ') continue;

    rough.push(buffer.trim());
    buffer = '';
  }
  if (buffer.trim()) rough.push(buffer.trim());

  // Second pass: break unpunctuated runs at conjunctions so the engine still
  // has usable units when the transcript is a wall of text.
  const out: string[] = [];
  for (const chunk of rough) {
    const w = chunk.split(' ');
    if (w.length <= maxWords) {
      out.push(chunk);
      continue;
    }
    let start = 0;
    for (let i = 0; i < w.length; i++) {
      const len = i - start + 1;
      const atBreak = /^(and|but|so|because|then|which|when|while|however|although|if)$/i.test(w[i]);
      if ((len >= Math.floor(maxWords * 0.6) && atBreak) || len >= maxWords) {
        const piece = w.slice(start, i + (atBreak ? 0 : 1)).join(' ').trim();
        if (piece) out.push(piece);
        start = i + (atBreak ? 0 : 1);
      }
    }
    const tail = w.slice(start).join(' ').trim();
    if (tail) out.push(tail);
  }

  return out.filter((s) => s.replace(/[^a-z0-9]/gi, '').length > 1);
}

/** Title-case that leaves acronyms and small words alone. */
const SMALL = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'for', 'to', 'of', 'in', 'on', 'at', 'by', 'vs', 'with', 'from']);
export function titleCase(input: string): string {
  const parts = input.replace(/["“”]/g, '').trim().split(/\s+/).filter(Boolean);
  return parts
    .map((w, i) => {
      if (w === w.toUpperCase() && w.length > 1) return w;
      const lower = w.toLowerCase();
      if (i > 0 && i < parts.length - 1 && SMALL.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

export function sentenceCase(input: string): string {
  const t = input.trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}
