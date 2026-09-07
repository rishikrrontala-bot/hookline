import type { Boundary, ScoredSentence, Segment, SignalSet, SignalName } from './types';
import { clamp01, mean } from './stats';
import { DANGLING_REFS, CONTINUATION_OPENERS } from './text/lexicons';
import { SIGNAL_LABELS, metaScore } from './signals';

export interface Candidate {
  startSentence: number;
  endSentence: number; // inclusive
  start: number;
  end: number;
  durationSec: number;
  score: number;
  breakdown: {
    opening: number;
    body: number;
    payoff: number;
    containment: number;
    boundary: number;
  };
  signals: SignalSet;
  evidence: string[];
  segmentIndex: number;
}

/**
 * How the composite clip score is assembled.
 *
 * `opening` is weighted hardest on purpose: on a vertical feed the first two
 * seconds decide whether anything else is seen at all. A clip with a brilliant
 * middle and a soft open is worth less than one that lands immediately.
 */
const W = {
  opening: 0.34,
  body: 0.26,
  payoff: 0.14,
  containment: 0.14,
  boundary: 0.12,
};

/** Fraction of a candidate treated as "the opening" when scoring. */
const OPENING_SEC = 4.5;

/**
 * A clip that begins on a bare pronoun is not self-contained — the viewer has
 * no antecedent. This measures how much unresolved reference sits in the first
 * two sentences, and how abruptly the last sentence ends.
 */
function containment(slice: ScoredSentence[]): number {
  const head = slice.slice(0, 2);
  let dangling = 0;
  let considered = 0;

  for (const s of head) {
    const firstFew = s.tokens.slice(0, 4);
    for (const t of firstFew) {
      considered++;
      if (DANGLING_REFS.includes(t)) dangling++;
    }
  }
  const refPenalty = considered ? dangling / considered : 0;

  // Starting on a conjunction reads as mid-thought.
  const opensOnConjunction = /^(and|but|so|because|which|then|or|also|plus)\b/i.test(slice[0]?.text ?? '') ? 0.28 : 0;

  const last = slice[slice.length - 1];
  const endsClean = last && /[.!?]["')\]]?$/.test(last.text.trim()) ? 0 : 0.2;

  return clamp01(1 - refPenalty * 1.6 - opensOnConjunction - endsClean);
}

/** Reward candidates whose edges sit on, or very near, a detected topic boundary. */
function boundaryFit(startIdx: number, endIdx: number, boundarySet: Set<number>, sentenceCount: number): number {
  const near = (idx: number, span = 2) => {
    for (let d = 0; d <= span; d++) {
      if (boundarySet.has(idx - d) || boundarySet.has(idx + d)) return 1 - d / (span + 1);
    }
    return 0;
  };
  // The very start and very end of the recording count as natural boundaries.
  const startFit = startIdx === 0 ? 1 : near(startIdx);
  const endFit = endIdx >= sentenceCount - 1 ? 1 : near(endIdx + 1);
  return (startFit + endFit) / 2;
}

/**
 * The opening is scored on the first line specifically, not on the average of
 * the opening window. On a vertical feed the first sentence either works or the
 * clip is never seen, so a strong second line cannot rescue a dead first one.
 *
 * Three things are disqualifying rather than merely weak:
 *   - the line is stage direction ("let me be specific about what I mean");
 *   - the line is a fragment continuing a thought the viewer never heard;
 *   - the line carries no content at all, only rhetoric.
 */
function scoreOpening(window: ScoredSentence[], first: ScoredSentence | undefined): number {
  if (!first || !window.length) return 0;

  const rhetoric = 0.55 * first.signals.hook + 0.3 * first.signals.curiosity + 0.15 * first.attention;

  // Something must actually be said in the first line.
  const substance = Math.max(first.signals.concrete, first.signals.salience, first.signals.quotable);
  const contentGate = 0.55 + 0.45 * substance;

  const firstWord = (first.tokens[0] ?? '').toLowerCase();
  const continuation = CONTINUATION_OPENERS.includes(firstWord) ? 0.3 : 0;
  const meta = metaScore(first.text) * 0.6;
  const tooShort = first.wordCount < 5 ? 0.22 : 0;

  // The rest of the opening window can lift the score, but only a little.
  const support = window.length > 1
    ? Math.max(...window.slice(1).map((s) => 0.5 * s.signals.hook + 0.5 * s.attention)) * 0.18
    : 0;

  return clamp01(rhetoric * contentGate + support - continuation - meta - tooShort);
}

function meanSignals(slice: ScoredSentence[]): SignalSet {
  const keys = Object.keys(slice[0].signals) as SignalName[];
  const out = {} as SignalSet;
  for (const k of keys) out[k] = mean(slice.map((s) => s.signals[k]));
  return out;
}

export function buildCandidates(
  sentences: ScoredSentence[],
  boundaries: Boundary[],
  segments: Segment[],
  opts: { minSec: number; maxSec: number },
): Candidate[] {
  const boundarySet = new Set(boundaries.map((b) => b.sentenceIndex));
  const candidates: Candidate[] = [];
  const n = sentences.length;

  /**
   * A window cannot hold more sentences than its duration allows at any
   * plausible speech rate, so the search is bounded by sentence count as well
   * as by duration.
   *
   * The duration break alone is not enough: a transcript whose timestamps run
   * backwards — a concatenated subtitle file, or one stitched together by an
   * editor — never trips it, and the search degrades from linear to quadratic.
   * A two-hour recording then locks the tab for twelve seconds instead of
   * finishing in a quarter of a second.
   */
  const maxSentences = Math.max(24, Math.ceil(opts.maxSec * 1.5));

  // Preferred start points: every sentence, but boundary-adjacent starts get
  // their bonus through `boundaryFit` rather than by restricting the search.
  for (let i = 0; i < n; i++) {
    const start = sentences[i].start;

    for (let j = i; j < n && j - i < maxSentences; j++) {
      const end = sentences[j].end;
      const dur = end - start;
      // Time ran backwards, so no later sentence forms a valid window either.
      if (dur < 0) break;
      if (dur < opts.minSec) continue;
      if (dur > opts.maxSec) break;

      const slice = sentences.slice(i, j + 1);
      if (slice.length < 2) continue;

      const openingSlice = slice.filter((s) => s.start - start < OPENING_SEC);
      const opening = scoreOpening(openingSlice, slice[0]);

      const body = mean(slice.map((s) => s.attention));

      const tailSlice = slice.slice(-Math.max(1, Math.ceil(slice.length * 0.3)));
      const payoff = Math.max(...tailSlice.map((s) => Math.max(s.signals.payoff, s.signals.quotable * 0.7)));

      const contain = containment(slice);
      const bfit = boundaryFit(i, j, boundarySet, n);

      const score =
        W.opening * opening +
        W.body * body +
        W.payoff * payoff +
        W.containment * contain +
        W.boundary * bfit;

      // Duration preference: 22–48s is the sweet spot for vertical feeds.
      const durPenalty = dur < 20 ? (20 - dur) * 0.006 : dur > 52 ? (dur - 52) * 0.004 : 0;

      const segmentIndex = segments.findIndex((s) => i >= s.startSentence && i <= s.endSentence);

      candidates.push({
        startSentence: i,
        endSentence: j,
        start,
        end,
        durationSec: dur,
        score: clamp01(score - durPenalty),
        breakdown: { opening, body, payoff, containment: contain, boundary: bfit },
        signals: meanSignals(slice),
        evidence: collectEvidence(slice),
        segmentIndex: segmentIndex === -1 ? 0 : segmentIndex,
      });
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
}

function collectEvidence(slice: ScoredSentence[]): string[] {
  const counts = new Map<string, number>();
  for (const s of slice) for (const e of s.evidence) counts.set(e, (counts.get(e) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([e]) => e);
}

/** Temporal IoU between two candidates. */
function overlap(a: Candidate, b: Candidate): number {
  const inter = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  if (inter <= 0) return 0;
  const union = Math.max(a.end, b.end) - Math.min(a.start, b.start);
  return union > 0 ? inter / union : 0;
}

/**
 * Non-maximum suppression. Greedy: take the best remaining candidate, drop
 * everything that overlaps it beyond `iouLimit`, repeat. A soft penalty on
 * repeating the same topic segment keeps the week's output varied instead of
 * returning six cuts of the same three minutes.
 */
export function selectClips(candidates: Candidate[], count: number, iouLimit = 0.12): Candidate[] {
  const chosen: Candidate[] = [];
  const segmentUse = new Map<number, number>();

  const pool = candidates.map((c) => ({ ...c }));

  while (chosen.length < count && pool.length) {
    let bestIdx = -1;
    let bestAdjusted = -Infinity;

    for (let i = 0; i < pool.length; i++) {
      const c = pool[i];
      const reuse = segmentUse.get(c.segmentIndex) ?? 0;
      const adjusted = c.score * Math.pow(0.82, reuse);
      if (adjusted > bestAdjusted) { bestAdjusted = adjusted; bestIdx = i; }
    }
    if (bestIdx === -1) break;

    const pick = pool[bestIdx];
    chosen.push(pick);
    segmentUse.set(pick.segmentIndex, (segmentUse.get(pick.segmentIndex) ?? 0) + 1);

    for (let i = pool.length - 1; i >= 0; i--) {
      if (overlap(pool[i], pick) > iouLimit) pool.splice(i, 1);
    }
  }

  return chosen.sort((a, b) => b.score - a.score);
}

/** The two signals that most distinguish this clip from the recording's average. */
export function standoutSignals(signals: SignalSet, corpusMean: SignalSet): SignalName[] {
  return (Object.keys(signals) as SignalName[])
    .filter((k) => SIGNAL_LABELS[k])
    .map((k) => ({ k, lift: signals[k] - corpusMean[k] }))
    .sort((a, b) => b.lift - a.lift)
    .slice(0, 2)
    .map((x) => x.k);
}
