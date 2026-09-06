import type { ChannelSEO, Chapter, ScoredSentence, Segment } from '../types';
import { formatTimecode, humanDuration } from '../ingest';
import { type Vocabulary, topPhrases, subjectTerms } from '../stats';
import { titleCase } from '../text/tokenize';
import { stripFiller } from './hooks';
import { metaScore } from '../signals';
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
  phrases: string[],
  sourceTitle: string,
): string[] {
  const ranked = [...sentences].sort((a, b) => b.attention - a.attention);
  const out: string[] = [];

  const push = (text: string | null) => {
    if (!text) return;
    const fitted = fit(text, TITLE_LIMIT);
    if (isWellFormed(fitted)) out.push(fitted);
  };

  // 1. The strongest thing actually said, as a title.
  const quote = ranked.find((s) => s.wordCount >= 6 && s.wordCount <= 14 && metaScore(s.text) < 0.25);
  if (quote) push(titleCase(stripFiller(quote.text).replace(/[.?!]+$/, '')));

  // 2. Search-led. The subject must be a phrase the speaker actually said —
  //    joining the three top-ranked stems produced "Clip Seconds Video", which
  //    names nothing and was never uttered.
  const subject = phrases.find((p) => p.includes(' '));
  if (subject) {
    const angle = ranked.find((s) => s.signals.concrete > 0.45 && s.wordCount <= 18);
    const figure = angle?.text.match(/\b\$?\d[\d,.]*\s*(%|percent|x\b|k\b|hours?|years?|million|billion)?/i)?.[0];
    push(figure
      ? `${titleCase(subject)} — What ${figure.trim()} Actually Changes`
      : `${titleCase(subject)}: What Actually Works`);
  }

  // 3. The contrarian line, when there is one.
  const contrarian = ranked.find(
    (s) => /\b(but|actually|wrong|myth|nobody|most people)\b/i.test(s.text) && s.wordCount <= 15,
  );
  if (contrarian) push(titleCase(stripFiller(contrarian.text).replace(/[.?!]+$/, '')));

  if (!out.length) out.push(fit(sourceTitle, TITLE_LIMIT));
  return [...new Set(out)].slice(0, 3);
}

/**
 * A title has to end on a word that can end a sentence. `fit` trims at a word
 * boundary, which still leaves things like "…Into a Shape That Offended" —
 * grammatically a cliff-edge, and worse than a shorter title.
 */
const TITLE_TAIL = /\b(a|an|the|of|to|in|on|for|with|that|which|and|but|or|is|are|was|were|be|been|had|has|have|by|as|at|from|into|than|then|so|if|it|its|their|his|her|my|our|your)$/i;

function isWellFormed(title: string): boolean {
  const words = title.trim().split(/\s+/);
  if (words.length < 3) return false;
  if (TITLE_TAIL.test(words[words.length - 1])) return false;
  // A trailing participle with no object reads as a truncation.
  if (/(?:ed|ing)$/i.test(words[words.length - 1]) && words.length > 6) {
    const prev = words[words.length - 2].toLowerCase();
    if (['that', 'which', 'been', 'had', 'was', 'were', 'is', 'are'].includes(prev)) return false;
  }
  return true;
}

export function buildSEO(
  sentences: ScoredSentence[],
  segments: Segment[],
  vocab: Vocabulary,
  surfaceForms: Map<string, string>,
  durationSec: number,
  sourceTitle: string,
): ChannelSEO {
  // Same distinctiveness ranking the clips use, so the channel metadata never
  // advertises "clip, seconds, video" as what the episode is about.
  const termWords = subjectTerms(sentences, sentences, vocab, surfaceForms, { limit: 14 });
  const keyTerms = termWords.map((term) => ({ term, weight: vocab.idf.get(term) ?? 0 }));

  const phrases = topPhrases(sentences, vocab, { maxLen: 3, limit: 12, minCount: 2 })
    .filter((p) => p.phrase.includes(' '))
    .map((p) => p.phrase);

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
    // Phrases, not isolated stems: "on watch time, average view duration"
    // describes an episode; "on week, video, watch" describes nothing.
    `${humanDuration(durationSec)} on ${[...phrases, ...termWords].slice(0, 3).join(', ')}.`,
    chapterBlock.trim(),
    '',
    `Topics: ${[...new Set([...phrases, ...termWords])].slice(0, 10).join(' · ')}`,
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  /** Tags: single terms first, then the strongest adjacent pairs actually spoken. */
  const bigrams = phrases.slice(0, 6);
  // Multi-word phrases first — they are the tags a viewer would actually search.
  const tags = [...new Set([...bigrams, ...termWords])]
    .filter((t) => t.length >= 4)
    .slice(0, 16);

  return {
    titles: writeChannelTitles(sentences, phrases, sourceTitle),
    description,
    tags,
    chapters,
    pullQuote,
    keyTerms,
  };
}
