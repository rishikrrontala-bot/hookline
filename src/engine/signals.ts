import type { Sentence, ScoredSentence, SignalSet, SignalName } from './types';
import { type Vocabulary, clamp01, mean, smooth, normalize } from './stats';
import {
  HOOK_OPENERS, CURIOSITY, CONTRAST, PAYOFF, VALENCE, INTENSIFIERS,
  STRONG_VERBS, UNITS, DANGLING_REFS, META_TALK,
} from './text/lexicons';

/**
 * Relative contribution of each signal to a sentence's attention score.
 *
 * These are the model. They are exposed rather than hidden because the whole
 * premise is that a creator can read why a clip was chosen — every weight here
 * corresponds to a bar in the clip readout.
 */
export const SIGNAL_WEIGHTS: Record<SignalName, number> = {
  hook: 0.20,
  curiosity: 0.16,
  emotion: 0.13,
  concrete: 0.12,
  salience: 0.15,
  payoff: 0.09,
  pace: 0.06,
  quotable: 0.09,
};

export const SIGNAL_LABELS: Record<SignalName, string> = {
  hook: 'Hook',
  curiosity: 'Curiosity',
  emotion: 'Charge',
  concrete: 'Concrete',
  salience: 'Salience',
  payoff: 'Payoff',
  pace: 'Pace',
  quotable: 'Quotable',
};

export const SIGNAL_DESCRIPTIONS: Record<SignalName, string> = {
  hook: 'Opening construction that stops a scroll — direct address, imperatives, superlatives, framed questions.',
  curiosity: 'An open loop the listener now needs closed: contrast pivots, withheld information, forward reference.',
  emotion: 'Valence magnitude. Both poles hold attention; a flat line does not.',
  concrete: 'Numbers, units, named entities. Specificity that resists paraphrase.',
  salience: 'TF-IDF mass — how much of the recording’s actual subject this line carries.',
  payoff: 'Resolution markers that close a loop rather than opening another.',
  pace: 'Delivery rate against the speaker’s own baseline. Withheld when timings were synthesized.',
  quotable: 'Short, declarative, strong-verbed. The shape of a line that survives being cut out.',
};

const has = (hay: string, needles: string[]) => needles.some((n) => hay.includes(n));
const countIn = (tokens: string[], set: string[]) => tokens.filter((t) => set.includes(t)).length;

/** Saturating map from a raw count to 0..1 — the third hit matters much less than the first. */
const sat = (n: number, half = 1.4) => (n <= 0 ? 0 : n / (n + half));

/**
 * How much of this sentence is the speaker talking about their own talking.
 * 0 = pure content, 1 = pure stage direction.
 */
export function metaScore(text: string): number {
  const lower = ' ' + text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ');
  let hits = 0;
  for (const phrase of META_TALK) if (lower.includes(' ' + phrase)) hits++;

  // Discourse phrases matter far more at the very start of a sentence.
  const leading = META_TALK.some((p) => lower.trimStart().startsWith(p)) ? 1 : 0;
  return clamp01(hits * 0.34 + leading * 0.5);
}

function scoreHook(s: Sentence): { value: number; why: string | null } {
  const lower = s.text.toLowerCase();
  const opening = lower.slice(0, 46);
  let v = 0;
  let why: string | null = null;

  if (has(opening, HOOK_OPENERS)) { v += 0.42; why = 'opens on a hook construction'; }
  // A genuine interrogative opening, not a subordinate "when/if" clause.
  const inverted = /^\s*(what|why|how|who|which|is|are|do|does|did|can|should|would|will)\b/i.test(s.text);
  if (inverted && !s.text.split(/\s+/).slice(0, 7).join(' ').includes(',')) {
    v += 0.3;
    why ??= 'opens as a question';
  }
  if (s.text.trim().endsWith('?')) v += 0.16;

  const second = countIn(s.tokens, ['you', 'your', "you're", "you'll", "you've"]);
  if (second) { v += Math.min(0.22, second * 0.11); why ??= 'addresses the viewer directly'; }

  // A leading imperative verb: "stop doing X", "build the thing".
  if (/^(stop|start|never|always|forget|skip|try|watch|listen|imagine|think|remember|look)\b/i.test(s.text)) {
    v += 0.2;
    why ??= 'opens on an imperative';
  }
  if (/\b(most|best|worst|fastest|only|biggest|hardest|single)\b/i.test(opening)) v += 0.14;

  // Stage direction is not a hook, however direct it sounds.
  const meta = metaScore(s.text);
  if (meta > 0.3) { v -= meta * 0.75; why = null; }

  return { value: clamp01(v), why };
}

function scoreCuriosity(s: Sentence): { value: number; why: string | null } {
  const lower = s.text.toLowerCase();
  let v = 0;
  let why: string | null = null;

  const curio = countIn(s.tokens, CURIOSITY);
  v += sat(curio, 1.8) * 0.5;

  const contrast = countIn(s.tokens, CONTRAST);
  if (contrast) { v += Math.min(0.3, contrast * 0.18); why = 'pivots on a contrast marker'; }

  if (/\b(but|and) (here|then|that'?s when|it turns out)\b/.test(lower)) v += 0.16;
  if (/\b(later|in a (second|minute|moment)|coming up|i'?ll (explain|show|get to))\b/.test(lower)) {
    v += 0.2;
    why ??= 'defers a payoff — an open loop';
  }
  if (/\b(nobody|no one|most people) (talks|tells|knows|realizes|mentions)\b/.test(lower)) {
    v += 0.24;
    why ??= 'frames withheld information';
  }
  if (curio >= 2) why ??= 'stacks curiosity language';

  return { value: clamp01(v), why };
}

function scoreEmotion(s: Sentence): { value: number; why: string | null } {
  let charge = 0;
  let peak = 0;
  let peakWord = '';

  for (const t of s.tokens) {
    const val = VALENCE[t];
    if (val === undefined) continue;
    const m = Math.abs(val);
    charge += m;
    if (m > peak) { peak = m; peakWord = t; }
  }

  const intens = countIn(s.tokens, INTENSIFIERS);
  charge += intens * 0.22;
  if (/[!]/.test(s.text)) charge += 0.18;

  const density = s.wordCount ? charge / Math.sqrt(s.wordCount) : 0;
  const value = clamp01(density * 1.5);
  const why = peak >= 0.6 ? `strong valence on "${peakWord}"` : null;
  return { value, why };
}

function scoreConcrete(s: Sentence): { value: number; why: string | null } {
  const numerals = (s.text.match(/\b\d[\d,.]*\b|\b\d+%|\$\d/g) ?? []).length;
  const units = countIn(s.tokens, UNITS);
  // Mid-sentence capitalised words are a cheap, reliable proper-noun proxy.
  const propers = (s.text.match(/(?!^)\b[A-Z][a-zA-Z]{2,}/g) ?? []).length;

  let v = sat(numerals, 1.0) * 0.5 + sat(units, 1.4) * 0.24 + sat(propers, 1.6) * 0.26;
  if (/\b\d+\s*(x|%|percent|times)\b/i.test(s.text)) v += 0.14;

  const why = numerals >= 1 ? 'carries a specific figure' : propers >= 2 ? 'names specific things' : null;
  return { value: clamp01(v), why };
}

function scoreSalience(s: Sentence, vocab: Vocabulary): { value: number; why: string | null } {
  if (!s.terms.length) return { value: 0, why: null };
  let massTotal = 0;
  for (const t of s.terms) massTotal += vocab.idf.get(t) ?? 0;
  // Length-normalised so a long rambling sentence does not out-score a dense one.
  const density = massTotal / Math.sqrt(s.terms.length);
  return { value: density, why: null }; // normalised across the corpus later
}

function scorePayoff(s: Sentence): { value: number; why: string | null } {
  const lower = ' ' + s.text.toLowerCase();
  let v = 0;
  let why: string | null = null;

  for (const marker of PAYOFF) {
    if (lower.includes(' ' + marker)) {
      v += marker.includes(' ') ? 0.3 : 0.16;
      why ??= 'resolves — closes the loop';
    }
  }
  if (/^\s*(so|therefore|which is why|and that'?s)\b/i.test(s.text)) v += 0.22;
  return { value: clamp01(v), why };
}

function scorePace(s: Sentence, baseline: number, enabled: boolean): { value: number; why: string | null } {
  if (!enabled || baseline <= 0 || s.wps <= 0) return { value: 0, why: null };
  const ratio = s.wps / baseline;
  // Both faster and slower than baseline are interesting; flat is not.
  const dev = Math.abs(ratio - 1);
  const value = clamp01(dev * 1.9);
  const why = ratio > 1.28 ? 'delivered faster than baseline' : ratio < 0.72 ? 'slows down — emphasis' : null;
  return { value, why };
}

function scoreQuotable(s: Sentence): { value: number; why: string | null } {
  const n = s.wordCount;
  if (n < 4) return { value: 0, why: null };

  // A soundbite peaks around 12–20 words.
  const lengthFit = clamp01(1 - Math.abs(n - 16) / 16);
  const verbs = countIn(s.tokens, STRONG_VERBS);
  const firstPerson = countIn(s.tokens, ['i', "i'm", "i've", 'we', "we're", 'my', 'our']) > 0 ? 1 : 0;
  const isQuestion = s.text.trim().endsWith('?') ? 0.5 : 0;
  const hedged = /\b(maybe|probably|kind of|sort of|i guess|i think|might|perhaps)\b/i.test(s.text) ? 0.35 : 0;

  const v = lengthFit * 0.42 + sat(verbs, 1.2) * 0.3 + firstPerson * 0.16 + isQuestion * 0.12 - hedged;
  const why = v > 0.6 && verbs > 0 ? 'soundbite shape — short, declarative, strong verb' : null;
  return { value: clamp01(v), why };
}

/**
 * Score every sentence, then smooth into the continuous attention curve.
 *
 * Salience is the one signal computed against the whole corpus rather than the
 * sentence alone, so it is normalised after the fact; the rest are already 0..1.
 */
export function scoreSentences(
  sentences: Sentence[],
  vocab: Vocabulary,
  opts: { hasRealTimings: boolean },
): ScoredSentence[] {
  const paceEnabled = opts.hasRealTimings;
  const wpsValues = sentences.map((s) => s.wps).filter((w) => w > 0.4 && w < 12);
  const baseline = wpsValues.length ? mean(wpsValues) : 0;

  const rawSalience = sentences.map((s) => scoreSalience(s, vocab).value);
  const salience = normalize(rawSalience, 0.08, 0.95);

  const partial = sentences.map((s, i) => {
    const hook = scoreHook(s);
    const curiosity = scoreCuriosity(s);
    const emotion = scoreEmotion(s);
    const concrete = scoreConcrete(s);
    const payoff = scorePayoff(s);
    const pace = scorePace(s, baseline, paceEnabled);
    const quotable = scoreQuotable(s);

    const signals: SignalSet = {
      hook: hook.value,
      curiosity: curiosity.value,
      emotion: emotion.value,
      concrete: concrete.value,
      salience: salience[i],
      payoff: payoff.value,
      pace: pace.value,
      quotable: quotable.value,
    };

    const evidence = [hook.why, curiosity.why, emotion.why, concrete.why, payoff.why, pace.why, quotable.why]
      .filter((x): x is string => Boolean(x));

    // Pace is withheld on synthesized timings; redistribute its weight so
    // plain-text transcripts are scored on the same 0..1 range.
    let total = 0;
    let weightSum = 0;
    for (const key of Object.keys(SIGNAL_WEIGHTS) as SignalName[]) {
      if (key === 'pace' && !paceEnabled) continue;
      total += signals[key] * SIGNAL_WEIGHTS[key];
      weightSum += SIGNAL_WEIGHTS[key];
    }
    const raw = weightSum > 0 ? total / weightSum : 0;

    return { ...s, signals, raw, evidence };
  });

  const smoothed = smooth(partial.map((p) => p.raw), 1.15);
  const attention = normalize(smoothed, 0.04, 0.98);

  return partial.map((p, i) => ({ ...p, attention: attention[i] }));
}

/** Downsample the sentence-level curve to a fixed-width series for rendering. */
export function buildCurve(sentences: ScoredSentence[], duration: number, points = 240): { t: number; v: number }[] {
  if (!sentences.length || duration <= 0) return [];
  const out: { t: number; v: number }[] = [];
  const step = duration / points;

  let cursor = 0;
  for (let i = 0; i < points; i++) {
    const t0 = i * step;
    const t1 = t0 + step;
    const bucket: number[] = [];
    while (cursor < sentences.length && sentences[cursor].start < t1) {
      if (sentences[cursor].end > t0) bucket.push(sentences[cursor].attention);
      cursor++;
    }
    // Step back so a long sentence can contribute to the next bucket too.
    while (cursor > 0 && sentences[cursor - 1].end > t1) cursor--;

    const v = bucket.length ? Math.max(...bucket) : out.length ? out[out.length - 1].v : 0;
    out.push({ t: t0, v });
  }
  return out;
}
