import type { Cue, Sentence } from './types';
import { splitSentences, words, contentTerms, stem } from './text/tokenize';
import { STOPWORDS } from './text/stopwords';

/**
 * Turn timed cues into timed sentences. Cue timings are distributed across the
 * sentences inside them proportionally to word count, which keeps clip
 * boundaries accurate to roughly a word even when cues are long.
 */
export function buildSentences(cues: Cue[]): Sentence[] {
  const out: Sentence[] = [];

  for (const cue of cues) {
    const parts = splitSentences(cue.text);
    if (!parts.length) continue;

    const counts = parts.map((p) => Math.max(1, words(p).length));
    const total = counts.reduce((a, b) => a + b, 0);
    const span = Math.max(0.4, cue.end - cue.start);

    let cursor = cue.start;
    parts.forEach((text, i) => {
      const dur = (counts[i] / total) * span;
      const tokens = words(text);
      const start = cursor;
      const end = cursor + dur;
      cursor = end;

      out.push({
        index: out.length,
        text,
        start,
        end,
        tokens,
        terms: contentTerms(tokens),
        wordCount: tokens.length,
        wps: dur > 0 ? tokens.length / dur : 0,
      });
    });
  }

  return out.map((s, i) => ({ ...s, index: i }));
}

export interface Vocabulary {
  /** term → inverse document frequency across sentences. */
  idf: Map<string, number>;
  /** term → total occurrences. */
  freq: Map<string, number>;
  docCount: number;
}

export function buildVocabulary(sentences: Sentence[]): Vocabulary {
  const df = new Map<string, number>();
  const freq = new Map<string, number>();

  for (const s of sentences) {
    const seen = new Set<string>();
    for (const term of s.terms) {
      freq.set(term, (freq.get(term) ?? 0) + 1);
      if (!seen.has(term)) {
        seen.add(term);
        df.set(term, (df.get(term) ?? 0) + 1);
      }
    }
  }

  const n = Math.max(1, sentences.length);
  const idf = new Map<string, number>();
  for (const [term, d] of df) {
    // Smoothed IDF, bounded so a hapax cannot dominate a sentence's salience.
    idf.set(term, Math.log((n + 1) / (d + 0.5)));
  }

  return { idf, freq, docCount: n };
}

/** L2-normalised TF-IDF vector for a bag of terms. */
export function tfidfVector(terms: string[], vocab: Vocabulary): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);

  const vec = new Map<string, number>();
  let norm = 0;
  for (const [term, count] of tf) {
    const w = (1 + Math.log(count)) * (vocab.idf.get(term) ?? 0);
    if (w <= 0) continue;
    vec.set(term, w);
    norm += w * w;
  }

  norm = Math.sqrt(norm);
  if (norm > 0) for (const [term, w] of vec) vec.set(term, w / norm);
  return vec;
}

export function cosine(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [term, w] of small) {
    const other = large.get(term);
    if (other) dot += w * other;
  }
  return dot;
}

/** Rank terms by total TF-IDF mass across a set of sentences. */
export function topTerms(sentences: Sentence[], vocab: Vocabulary, limit = 8): { term: string; weight: number }[] {
  const mass = new Map<string, number>();
  for (const s of sentences) {
    for (const term of s.terms) {
      mass.set(term, (mass.get(term) ?? 0) + (vocab.idf.get(term) ?? 0));
    }
  }
  return [...mass.entries()]
    .map(([term, weight]) => ({ term, weight }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit);
}

/**
 * Map a stem back to the most common surface form that produced it, so the UI
 * shows "creators" rather than "creator" when that is what was actually said.
 */
export function buildSurfaceForms(sentences: Sentence[]): Map<string, string> {
  const byStem = new Map<string, Map<string, number>>();

  for (const s of sentences) {
    for (const token of s.tokens) {
      if (token.length < 3) continue;
      const key = stem(token);
      const bucket = byStem.get(key) ?? new Map<string, number>();
      bucket.set(token, (bucket.get(token) ?? 0) + 1);
      byStem.set(key, bucket);
    }
  }

  const out = new Map<string, string>();
  for (const [key, forms] of byStem) {
    let best = key;
    let bestN = 0;
    for (const [form, n] of forms) {
      // Prefer the frequent form; break ties toward the shorter one.
      if (n > bestN || (n === bestN && form.length < best.length)) {
        best = form;
        bestN = n;
      }
    }
    out.set(key, best);
  }
  return out;
}

/** Gaussian smoothing over a 1-D series. */
export function smooth(values: number[], sigma = 1.4): number[] {
  if (values.length < 3 || sigma <= 0) return values.slice();
  const radius = Math.max(1, Math.ceil(sigma * 2.5));
  const kernel: number[] = [];
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(w);
    sum += w;
  }

  return values.map((_, i) => {
    let acc = 0;
    let weight = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j < 0 || j >= values.length) continue;
      const w = kernel[k + radius];
      acc += values[j] * w;
      weight += w;
    }
    return weight > 0 ? acc / weight : values[i];
  });
}

/** Rescale to 0..1 using robust percentile bounds so one outlier cannot flatten the curve. */
export function normalize(values: number[], lowPct = 0.05, highPct = 0.97): number[] {
  if (!values.length) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
  const lo = at(lowPct);
  const hi = at(highPct);
  const span = hi - lo;
  if (span < 1e-9) return values.map(() => 0.5);
  return values.map((v) => Math.min(1, Math.max(0, (v - lo) / span)));
}

export const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Contiguous noun-ish phrases the speaker actually said, ranked.
 *
 * Walks runs of content words of length 1–3 and scores whole phrases, so it
 * recovers things like "average view duration" that a pairwise scan would
 * split. Used wherever the engine needs a phrase the speaker demonstrably said
 * rather than one assembled from separately-ranked words.
 */
export function topPhrases(
  sentences: Sentence[],
  vocab: Vocabulary,
  opts: { maxLen?: number; limit?: number; minCount?: number } = {},
): { phrase: string; score: number; count: number }[] {
  const maxLen = opts.maxLen ?? 3;
  const limit = opts.limit ?? 8;
  const minCount = opts.minCount ?? 1;

  const counts = new Map<string, number>();

  for (const s of sentences) {
    // Split on punctuation first. A phrase must never span a comma — that is
    // how "better audio, tighter edit" becomes the phantom "audio tighter edit".
    const clauses = s.text.toLowerCase().split(/[^a-z0-9'’\s-]+/);

    for (const clause of clauses) {
      const tokens = clause.match(/[a-z0-9][a-z0-9'’-]*/g) ?? [];
      let run: string[] = [];

      const flushRun = () => {
        for (let n = 1; n <= maxLen; n++) {
          for (let i = 0; i + n <= run.length; i++) {
            counts.set(run.slice(i, i + n).join(' '), (counts.get(run.slice(i, i + n).join(' ')) ?? 0) + 1);
          }
        }
        run = [];
      };

      for (const token of tokens) {
        const isContent = token.length >= 3 && !STOPWORDS.has(token) && !/^\d+$/.test(token);
        if (isContent) run.push(token);
        else flushRun();
      }
      flushRun();
    }
  }

  // Keep only maximal n-grams. If "eight hundred" and "eight hundred
  // subscribers" occur the same number of times, the shorter one is just a
  // prefix of the longer — reporting it truncates the actual phrase.
  const maximal = new Map(counts);
  for (const [phrase, count] of counts) {
    const parts = phrase.split(' ');
    if (parts.length >= maxLen) continue;
    for (const [other, otherCount] of counts) {
      if (other === phrase || otherCount < count) continue;
      const otherParts = other.split(' ');
      if (otherParts.length <= parts.length) continue;
      // Contained as a contiguous run inside a longer phrase of equal frequency.
      if ((' ' + other + ' ').includes(' ' + phrase + ' ')) { maximal.delete(phrase); break; }
    }
  }

  return [...maximal.entries()]
    .filter(([, n]) => n >= minCount)
    .map(([phrase, count]) => {
      const parts = phrase.split(' ');
      const idfMass = parts.reduce((acc, w) => acc + (vocab.idf.get(stem(w)) ?? 0), 0);
      // English noun phrases are head-final: the last word carries the subject.
      // Weighting it separately keeps "average view duration" ahead of a
      // modifier-heavy fragment like "average view".
      const headIdf = vocab.idf.get(stem(parts[parts.length - 1])) ?? 0;
      const lengthBonus = parts.length === 1 ? 0.85 : parts.length === 2 ? 1.35 : 1.5;
      const repeatBonus = 1 + Math.log(count) * 0.9;
      return { phrase, score: (idfMass + headIdf * 1.3) * lengthBonus * repeatBonus, count };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Words that score as terms but never name a subject. */
const NON_SUBJECT = new Set([
  'better', 'best', 'worse', 'worst', 'every', 'each', 'other', 'another', 'same', 'whole',
  'true', 'false', 'real', 'actual', 'entire', 'total', 'full', 'half', 'more', 'less', 'much',
  'first', 'second', 'third', 'last', 'next', 'early', 'late', 'long', 'short', 'high', 'low',
  'good', 'bad', 'great', 'small', 'large', 'hundred', 'thousand', 'million', 'billion',
  'already', 'almost', 'enough', 'quite', 'rather', 'pretty', 'nearly', 'barely', 'simply',
  'anything', 'everything', 'nothing', 'someone', 'anyone', 'everyone', 'nobody', 'somebody',
]);

/**
 * The terms a stretch of transcript is actually *about*.
 *
 * Plain TF-IDF ranking answers "which words are unusual here", which is not the
 * same question: it happily returns "better", "hundred" and "every" for a
 * narrative passage. This weights a term by how much more this stretch leans on
 * it than the whole recording does (lift), and rejects the words that score
 * well but name nothing.
 *
 * `fallback` supplies the recording's own subject for passages that genuinely
 * have no distinctive vocabulary — a cold open, say — because a subject that is
 * merely broad is far better than one that is wrong.
 */
export function subjectTerms(
  slice: Sentence[],
  all: Sentence[],
  vocab: Vocabulary,
  surfaceForms: Map<string, string>,
  opts: { limit?: number; fallback?: string[] } = {},
): string[] {
  const limit = opts.limit ?? 6;
  const localN = slice.reduce((n, s) => n + s.terms.length, 0) || 1;
  const globalN = all.reduce((n, s) => n + s.terms.length, 0) || 1;

  const local = new Map<string, number>();
  for (const s of slice) for (const t of s.terms) local.set(t, (local.get(t) ?? 0) + 1);

  const ranked = [...local.entries()]
    .map(([term, count]) => {
      const lift = (count / localN) / ((vocab.freq.get(term) ?? 1) / globalN + 1e-9);
      return { term, score: Math.log(1 + count) * Math.log(1 + lift) * (vocab.idf.get(term) ?? 0) };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => surfaceForms.get(x.term) ?? x.term)
    .filter((w) => w.length >= 4 && !NON_SUBJECT.has(w.toLowerCase()));

  // Collapse surface variants of one word: "arrives" and "arrive" are the same
  // subject and listing both reads as a bug.
  const seenStems = new Set<string>();
  const deduped: string[] = [];
  for (const word of ranked) {
    const key = stem(word.toLowerCase());
    if (seenStems.has(key)) continue;
    seenStems.add(key);
    deduped.push(word);
  }

  const out = deduped.slice(0, limit);
  if (out.length >= 3 || !opts.fallback) return out;

  for (const word of opts.fallback) {
    if (out.length >= limit) break;
    const key = stem(word.toLowerCase());
    if (word.length < 4 || NON_SUBJECT.has(word.toLowerCase()) || seenStems.has(key)) continue;
    seenStems.add(key);
    out.push(word);
  }
  return out;
}
