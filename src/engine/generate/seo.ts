import type { ChannelSEO, Chapter, ScoredSentence, Segment } from '../types';
import { formatTimecode, humanDuration } from '../ingest';
import { type Vocabulary, topTerms, topPhrases } from '../stats';
import { titleCase } from '../text/tokenize';
import { stripFiller } from './hooks';
import { fit } from './titles';

/**
 * Chapters come free from topic segmentation — the same boundaries that keep
 * clips from cutting mid-thought are exactly where a chapter should start.
 * YouTube requires the first chapter at 00:00 and a minimum of three.
 */
export function buildChapters(segments: Segment[], durationSec: number): Chapter[] {
  const usable = segments.filter((s, i) => i === 0 || s.end - s.start > Math.min(45, durationSec * 0.02));
  if (usable.length < 3) return [];

  const chapters: Chapter[] = usable.map((s, i) => ({
    start: i === 0 ? 0 : s.start,
    timecode: formatTimecode(i === 0 ? 0 : s.start, { force: durationSec >= 3600 }),
    label: s.label,
  }));

  // Deduplicate labels that collapsed to the same phrase.
  const seen = new Map<string, number>();
  for (const c of chapters) {
    const key = c.label.toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n > 1) c.label = `${c.label} (${n})`;
  }

  return chapters;
}

const TITLE_LIMIT = 70;

/**
 * Main-video title options. Three genuinely different strategies rather than
 * three rewordings: the strongest spoken line, the subject as a search query,
 * and the recording's own biggest number or claim.
 */
function writeChannelTitles(
  sentences: ScoredSentence[],
  keyTerms: string[],
  sourceTitle: string,
): string[] {
  const ranked = [...sentences].sort((a, b) => b.attention - a.attention);
  const subject = titleCase(keyTerms.slice(0, 3).join(' '));
  const out: string[] = [];

  const quote = ranked.find((s) => s.wordCount >= 6 && s.wordCount <= 15);
  if (quote) out.push(fit(titleCase(stripFiller(quote.text).replace(/[.?!]+$/, '')), TITLE_LIMIT));

  if (subject) {
    const angle = ranked.find((s) => s.signals.concrete > 0.45 && s.wordCount <= 18);
    const figure = angle?.text.match(/\b\$?\d[\d,.]*\s*(%|percent|x\b|k\b|hours?|years?|million|billion)?/i)?.[0];
    out.push(fit(figure ? `${subject} — What ${figure.trim()} Actually Changes` : `${subject}: What Actually Works`, TITLE_LIMIT));
  }

  const contrarian = ranked.find((s) => /\b(but|actually|wrong|myth|nobody|most people)\b/i.test(s.text) && s.wordCount <= 16);
  if (contrarian) out.push(fit(titleCase(stripFiller(contrarian.text).replace(/[.?!]+$/, '')), TITLE_LIMIT));

  if (!out.length) out.push(fit(sourceTitle, TITLE_LIMIT));

  return [...new Set(out.filter(Boolean))].slice(0, 3);
}

export function buildSEO(
  sentences: ScoredSentence[],
  segments: Segment[],
  vocab: Vocabulary,
  surfaceForms: Map<string, string>,
  durationSec: number,
  sourceTitle: string,
): ChannelSEO {
  const ranked = topTerms(sentences, vocab, 18);
  const keyTerms = ranked.map((t) => ({ term: surfaceForms.get(t.term) ?? t.term, weight: t.weight }));
  const termWords = keyTerms.map((t) => t.term);

  const chapters = buildChapters(segments, durationSec);

  const pullSource = [...sentences]
    .filter((s) => s.wordCount >= 8 && s.wordCount <= 26)
    .sort((a, b) => b.attention + b.signals.quotable * 0.4 - (a.attention + a.signals.quotable * 0.4))[0];
  const pullQuote = pullSource ? stripFiller(pullSource.text) : '';

  const chapterBlock = chapters.length
    ? `\n\nChapters\n${chapters.map((c) => `${c.timecode} ${c.label}`).join('\n')}`
    : '';

  const description = [
    pullQuote,
    '',
    `${humanDuration(durationSec)} on ${termWords.slice(0, 3).join(', ')}.`,
    chapterBlock.trim(),
    '',
    `Topics: ${termWords.slice(0, 10).join(' · ')}`,
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  /** Tags: single terms first, then the strongest adjacent pairs actually spoken. */
  const bigrams = topPhrases(sentences, vocab, { maxLen: 2, limit: 6, minCount: 2 })
    .filter((p) => p.phrase.includes(' '))
    .map((p) => p.phrase);
  const tags = [...new Set([...termWords.slice(0, 12), ...bigrams])]
    .filter((t) => t.length >= 3)
    .slice(0, 18);

  return {
    titles: writeChannelTitles(sentences, termWords, sourceTitle),
    description,
    tags,
    chapters,
    pullQuote,
    keyTerms,
  };
}
