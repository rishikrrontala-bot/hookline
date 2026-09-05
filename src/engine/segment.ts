import type { Boundary, Segment, Sentence, ScoredSentence } from './types';
import { type Vocabulary, tfidfVector, cosine, smooth, mean, topPhrases } from './stats';
import { titleCase, stem } from './text/tokenize';
import { metaScore } from './signals';

/**
 * Topic segmentation by lexical cohesion — a TextTiling variant.
 *
 * Two adjacent windows of `k` sentences slide across the transcript. At each
 * gap we measure the cosine similarity of the two windows' TF-IDF vectors.
 * Where the vocabulary on either side of a gap stops overlapping, the subject
 * has changed. The *depth* of that valley (how far the similarity drops
 * relative to the local peaks around it) is what marks a real boundary rather
 * than ordinary sentence-to-sentence variation.
 *
 * This is what keeps clips from ending mid-thought: the clip selector is only
 * allowed to cut at, or very near, one of these boundaries.
 */
export interface Segmentation {
  boundaries: Boundary[];
  /**
   * Block-similarity at each inter-sentence gap, 0..1, indexed by sentence.
   * Exposed so the interface can plot the measurement the boundaries came
   * from rather than a stand-in for it.
   */
  cohesion: number[];
  /**
   * The index range of `cohesion` that carries a real measurement. Outside it
   * there is not enough transcript on one side to fill a window, so the value
   * is a placeholder — plotting it draws a wall at each end of the chart.
   */
  cohesionRange: [number, number];
}

export function findBoundaries(
  sentences: Sentence[],
  vocab: Vocabulary,
  opts: { windowSize?: number; minGapSentences?: number } = {},
): Segmentation {
  const n = sentences.length;
  const k = opts.windowSize ?? Math.max(3, Math.min(8, Math.round(n / 28)));
  const minGap = opts.minGapSentences ?? Math.max(4, k);
  if (n < k * 2 + 2) return { boundaries: [], cohesion: new Array(n).fill(1), cohesionRange: [0, 0] };

  const vectors = sentences.map((s) => tfidfVector(s.terms, vocab));

  // Similarity at each inter-sentence gap i (between sentence i-1 and i).
  const gapScores: number[] = new Array(n).fill(1);
  for (let i = k; i <= n - k; i++) {
    const left = new Map<string, number>();
    const right = new Map<string, number>();
    for (let j = i - k; j < i; j++) for (const [t, w] of vectors[j]) left.set(t, (left.get(t) ?? 0) + w);
    for (let j = i; j < i + k; j++) for (const [t, w] of vectors[j]) right.set(t, (right.get(t) ?? 0) + w);
    normalizeVec(left);
    normalizeVec(right);
    gapScores[i] = cosine(left, right);
  }

  const sim = smooth(gapScores, 1.0);

  // Depth score: how far this valley sits below the nearest peak on each side.
  const depths: { index: number; depth: number }[] = [];
  for (let i = k + 1; i < n - k - 1; i++) {
    if (!(sim[i] <= sim[i - 1] && sim[i] <= sim[i + 1])) continue;

    let l = i;
    while (l > k && sim[l - 1] >= sim[l]) l--;
    let r = i;
    while (r < n - k - 1 && sim[r + 1] >= sim[r]) r++;

    const depth = (sim[l] - sim[i]) + (sim[r] - sim[i]);
    if (depth > 0) depths.push({ index: i, depth });
  }
  if (!depths.length) return { boundaries: [], cohesion: sim, cohesionRange: [k, n - k] };

  // Keep valleys deeper than mean + 0.4σ — the standard TextTiling cutoff.
  const ds = depths.map((d) => d.depth);
  const mu = mean(ds);
  const sigma = Math.sqrt(mean(ds.map((d) => (d - mu) ** 2)));
  const cutoff = mu + 0.4 * sigma;

  const kept: Boundary[] = [];
  for (const d of depths.sort((a, b) => b.depth - a.depth)) {
    if (d.depth < cutoff) continue;
    if (kept.some((b) => Math.abs(b.sentenceIndex - d.index) < minGap)) continue;
    kept.push({ sentenceIndex: d.index, timeSec: sentences[d.index].start, depth: d.depth });
  }

  return {
    boundaries: kept.sort((a, b) => a.sentenceIndex - b.sentenceIndex),
    cohesion: sim,
    cohesionRange: [k, n - k],
  };
}

function normalizeVec(v: Map<string, number>) {
  let norm = 0;
  for (const w of v.values()) norm += w * w;
  norm = Math.sqrt(norm);
  if (norm > 0) for (const [t, w] of v) v.set(t, w / norm);
}

/** Build contiguous segments from the boundary list. */
export function buildSegments(
  sentences: ScoredSentence[],
  boundaries: Boundary[],
  vocab: Vocabulary,
  surfaceForms: Map<string, string>,
): Segment[] {
  const cuts = [0, ...boundaries.map((b) => b.sentenceIndex), sentences.length];
  const draft: { slice: ScoredSentence[]; from: number; to: number; terms: string[] }[] = [];

  for (let i = 0; i < cuts.length - 1; i++) {
    const from = cuts[i];
    const to = cuts[i + 1] - 1;
    if (to < from) continue;
    const slice = sentences.slice(from, to + 1);
    draft.push({ slice, from, to, terms: distinctiveTerms(slice, sentences, vocab, surfaceForms) });
  }

  const used = new Set<string>();
  return draft.map((d, index) => ({
    index,
    startSentence: d.from,
    endSentence: d.to,
    start: d.slice[0].start,
    end: d.slice[d.slice.length - 1].end,
    keyTerms: d.terms,
    label: labelSegment(d.slice, d.terms, vocab, used),
    meanAttention: mean(d.slice.map((s) => s.attention)),
  }));
}

/**
 * Terms that are characteristic of *this stretch* rather than of the recording
 * as a whole. A word the speaker uses constantly describes the episode, not the
 * chapter; what identifies a chapter is the vocabulary that spikes inside it.
 */
function distinctiveTerms(
  slice: ScoredSentence[],
  all: ScoredSentence[],
  vocab: Vocabulary,
  surfaceForms: Map<string, string>,
  limit = 6,
): string[] {
  const localN = slice.reduce((n, s) => n + s.terms.length, 0) || 1;
  const globalN = all.reduce((n, s) => n + s.terms.length, 0) || 1;

  const local = new Map<string, number>();
  for (const s of slice) for (const t of s.terms) local.set(t, (local.get(t) ?? 0) + 1);

  return [...local.entries()]
    .map(([term, count]) => {
      const localRate = count / localN;
      const globalRate = (vocab.freq.get(term) ?? 1) / globalN;
      // Lift: how much more this stretch leans on the term than the whole does.
      const lift = localRate / (globalRate + 1e-9);
      return { term, score: Math.log(1 + count) * Math.log(1 + lift) * (vocab.idf.get(term) ?? 0) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => surfaceForms.get(x.term) ?? x.term);
}

/**
 * A chapter label names the subject of a stretch, in one to three words.
 *
 * Earlier revisions tried to extract a heading from the segment's strongest
 * sentence. That consistently failed: conversational speech does not contain
 * clean headings, and every fragment it produced ("If It Is Already Known",
 * "Gets Shown") read as a bug in a table of contents. A short phrase the
 * speaker actually said, anchored to the vocabulary that spikes inside this
 * segment, is shorter, always parses, and is verifiably on topic.
 */
function labelSegment(
  slice: ScoredSentence[],
  keyTerms: string[],
  vocab: Vocabulary,
  used: Set<string>,
): string {
  const anchors = new Set(keyTerms.slice(0, 5).map((t) => stem(t)));
  const onTopic = (phrase: string) => phrase.split(' ').some((w) => anchors.has(stem(w)));

  const take = (phrase: string | null): string | null => {
    if (!phrase) return null;
    const label = titleCase(phrase.replace(/["'’]/g, '').trim());
    const key = label.toLowerCase();
    if (!label || key.length < 4 || used.has(key)) return null;
    used.add(key);
    return label;
  };

  const phrases = topPhrases(slice, vocab, { maxLen: 3, limit: 20, minCount: 1 }).filter((p) => onTopic(p.phrase));

  const two = phrases.filter((p) => p.phrase.split(' ').length === 2);
  const three = phrases.filter((p) => p.phrase.split(' ').length === 3);
  const one = phrases.filter((p) => p.phrase.split(' ').length === 1);

  // Repeated phrases first — repetition is what separates a subject from an
  // accident of word order.
  const ordered = [
    ...three.filter((p) => p.count > 1),
    ...two.filter((p) => p.count > 1),
    ...three,
    ...two,
    ...one,
  ];

  for (const p of ordered) {
    const accepted = take(p.phrase);
    if (accepted) return accepted;
  }

  for (const term of keyTerms) {
    const accepted = take(term);
    if (accepted) return accepted;
  }

  return `Part ${used.size + 1}`;
}
