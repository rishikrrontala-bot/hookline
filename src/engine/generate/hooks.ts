import type { ScoredSentence, HookPattern } from '../types';
import { sentenceCase } from '../text/tokenize';

/**
 * Hook rewriting.
 *
 * The engine does not invent claims. It detects the rhetorical shape already
 * present in the clip's opening lines and re-frames the speaker's own words
 * into the tightest version of that shape. Every output is traceable to text
 * that was actually said — which is also what makes it safe to publish.
 */

const FILLER = /^(so|and|but|okay|ok|now|well|right|yeah|um|uh|like|anyway|alright|you know|i mean|basically|actually)[,\s]+/i;

export function stripFiller(text: string): string {
  let out = text.trim();
  // Strip stacked fillers: "so, um, basically ..." peels one layer per pass.
  for (let i = 0; i < 4; i++) {
    const next = out.replace(FILLER, '');
    if (next === out) break;
    out = next;
  }
  return out.trim();
}

export function detectPattern(slice: ScoredSentence[]): HookPattern {
  const head = slice.slice(0, 3).map((s) => s.text).join(' ');
  const lower = head.toLowerCase();

  const first = (slice[0]?.text ?? '').trim();

  // Only the opening line decides whether this is a question — a '?' three
  // sentences later says nothing about how the clip starts.
  //
  // "When" and "if" are excluded deliberately: they introduce subordinate
  // clauses far more often than questions, and treating "When you have thirty
  // engineers, every meeting produces work" as interrogative produces a hook
  // that ends in a question mark it never earned.
  // A bare wh-word is not enough: "What finally broke it was that we ran out of
  // money" is a cleft, not a question. Only an explicit question mark, or
  // unambiguous subject-auxiliary inversion, earns the classification — because
  // the cost of getting it wrong is a fabricated question mark on a statement.
  const inverted = /^(is|are|was|were|do|does|did|can|could|should|would|will|have|has|am)\b/i.test(first);
  const subordinate = first.split(/\s+/).slice(0, 7).join(' ').includes(',');

  if (first.endsWith('?') || (inverted && !subordinate)) return 'question';

  if (/\b\d[\d,.]*\s*(%|percent|x|times|hours?|minutes?|dollars?|years?|k\b|million|billion)/i.test(head)) return 'statistic';
  if (/\b(everyone|everybody|most people|nobody|no one|they tell you|conventional|supposed to|myth|wrong about)\b/.test(lower)) return 'contrarian';
  if (/\b(lost|failed|cost me|almost|nearly|risk|mistake|broke|disaster|worst|scared|wasted)\b/.test(lower)) return 'stakes';
  if (/\b(i was|i used to|when i|back when|the first time|years ago|one day|i remember)\b/.test(lower)) return 'story';
  if (/^\s*(stop|start|never|always|do|don'?t|try|use|build|make|take|forget|skip|write)\b/i.test(first)) return 'instruction';
  return 'declaration';
}

export const PATTERN_LABELS: Record<HookPattern, string> = {
  question: 'Framed question',
  statistic: 'Concrete figure',
  contrarian: 'Received wisdom, inverted',
  stakes: 'Cost on the table',
  story: 'Cold open',
  instruction: 'Direct instruction',
  declaration: 'Flat assertion',
};

interface Core {
  text: string;
  /** True when the sentence had to be cut short — the result is a fragment. */
  truncated: boolean;
}

/**
 * Compress a sentence to its most load-bearing clause.
 *
 * Callers need to know whether the result is a whole thought or a fragment,
 * because a fragment must never have terminal punctuation bolted onto it —
 * that is how "If you take the full cost of that, including the?" happens.
 */
function core(text: string, maxWords = 15): Core {
  const t = stripFiller(text).replace(/[,;:]\s*$/, '').replace(/\s+/g, ' ');
  const w = t.split(' ');
  if (w.length <= maxWords) return { text: t.replace(/[.]+$/, ''), truncated: false };

  // Only cut at a clause marker. If there isn't one inside the budget, the
  // sentence is kept whole rather than broken — length is the lesser problem.
  const stop = w.findIndex((x, i) => i >= Math.floor(maxWords * 0.45) && /^(and|but|because|which|when|so|if|while|since|unless)$/i.test(x));
  if (stop > 0 && stop <= maxWords) {
    return { text: w.slice(0, stop).join(' ').replace(/[,.;:]+$/, ''), truncated: false };
  }
  return { text: t.replace(/[.]+$/, ''), truncated: true };
}

function firstFigure(text: string): string | null {
  const m = text.match(/\b\$?\d[\d,.]*\s*(%|percent|x\b|times|hours?|minutes?|seconds?|days?|weeks?|months?|years?|k\b|million|billion)?/i);
  return m ? m[0].trim() : null;
}

/**
 * Build the rewritten hook.
 *
 * The opening sentence is usually the right source, but not always — a short
 * fragment or a piece of stage direction is a worse hook than the line right
 * after it. We consider the first two lines and take whichever is stronger.
 */
export function writeHook(slice: ScoredSentence[], pattern: HookPattern): string {
  const source = pickSource(slice);
  const opener = source.text;
  const second = slice.find((s) => s.index > source.index)?.text ?? '';
  const joined = `${opener} ${second}`;
  const clean = stripFiller(opener);

  switch (pattern) {
    case 'question': {
      const trimmed = clean.trim();
      if (trimmed.endsWith('?')) return sentenceCase(trimmed);
      const c = core(clean, 14);
      // A question mark is only added to a complete interrogative clause.
      return sentenceCase(c.truncated ? terminate(c.text) : `${c.text}?`);
    }
    case 'statistic': {
      const fig = firstFigure(joined);
      const c = core(clean, 14);
      if (fig && !c.text.includes(fig) && !c.truncated) {
        return sentenceCase(terminate(`${fig} — and ${lowerFirst(c.text)}`));
      }
      return sentenceCase(terminate(c.text));
    }
    case 'contrarian':
    case 'stakes': {
      // A line that already inverts received wisdom, or already names a cost,
      // does not need a template bolted to it. Appending "Here's what actually
      // happens" to three clips in the same set is how a tool announces that a
      // machine wrote it — and it asserts a payoff the clip may not deliver.
      // The speaker's own sentence is the hook.
      const c = core(clean, 16);
      return sentenceCase(terminate(c.text));
    }
    default:
      return sentenceCase(terminate(core(clean, 16).text));
  }
}

/** Close a line with a full stop unless it already ends in terminal punctuation. */
function terminate(text: string): string {
  const t = text.trim().replace(/[,;:\s]+$/, '');
  return /[.!?]["')\]]?$/.test(t) ? t : `${t}.`;
}

/**
 * Choose which of the clip's first two lines becomes the hook. The opener wins
 * ties, because reordering a clip's own words is a bigger liberty than keeping
 * them.
 */
function pickSource(slice: ScoredSentence[]): ScoredSentence {
  const first = slice[0];
  const second = slice[1];
  if (!second) return first;

  const rate = (s: ScoredSentence) =>
    s.signals.hook * 0.5 +
    s.signals.curiosity * 0.2 +
    Math.max(s.signals.concrete, s.signals.quotable) * 0.3 -
    (s.wordCount < 5 ? 0.3 : 0);

  return rate(second) > rate(first) + 0.18 ? second : first;
}

function lowerFirst(s: string): string {
  const t = s.trim();
  if (!t) return t;
  // Don't lowercase an acronym or a proper noun.
  if (/^[A-Z]{2,}/.test(t)) return t;
  const first = t.split(/\s+/)[0];
  if (first.length > 1 && first[0] === first[0].toUpperCase() && first.slice(1) !== first.slice(1).toLowerCase()) return t;
  return t.charAt(0).toLowerCase() + t.slice(1);
}
