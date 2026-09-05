import type { ClipTitle, HookPattern, Platform, ScoredSentence } from '../types';
import { titleCase } from '../text/tokenize';
import { stripFiller } from './hooks';
import { metaScore } from '../signals';

/** Hard character limits before each platform truncates in-feed. */
export const PLATFORM_LIMITS: Record<Platform, number> = {
  'youtube-shorts': 70,
  tiktok: 100,
  'instagram-reels': 125,
  x: 220,
  linkedin: 200,
};

export const PLATFORM_LABELS: Record<Platform, string> = {
  'youtube-shorts': 'YouTube Shorts',
  tiktok: 'TikTok',
  'instagram-reels': 'Instagram Reels',
  x: 'X',
  linkedin: 'LinkedIn',
};

export const PLATFORM_SHORT: Record<Platform, string> = {
  'youtube-shorts': 'Shorts',
  tiktok: 'TikTok',
  'instagram-reels': 'Reels',
  x: 'X',
  linkedin: 'LinkedIn',
};

/** Trim to a limit at a word boundary, never mid-word, never leaving a dangling preposition. */
export function fit(text: string, limit: number): string {
  let t = text.trim().replace(/\s+/g, ' ');
  if (t.length <= limit) return t;

  t = t.slice(0, limit - 1);
  const cut = t.lastIndexOf(' ');
  if (cut > limit * 0.55) t = t.slice(0, cut);
  t = t.replace(/[\s,;:—-]+$/, '');
  t = t.replace(/\s+(the|a|an|of|to|in|on|for|and|or|with|that|is|it)$/i, '');
  return t;
}

/**
 * Platform-tuned titles.
 *
 * Each platform gets the hook plus as much of the clip's own supporting
 * material as its character budget allows, drawn from a different part of the
 * clip so no two platforms pad with the same line:
 *
 *   YouTube Shorts   70   the claim alone — the tightest readable version
 *   TikTok          100   the spoken hook, verbatim
 *   Reels           125   hook, then the line that pays it off
 *   X               220   hook and its evidence, as a two-line post
 *   LinkedIn        200   hook, then the lesson
 *
 * When a hook is short and self-contained, several platforms correctly receive
 * the same string. That is the right answer, not a gap: inventing variation
 * would mean padding a title with words the recording does not support.
 */
export function writeTitles(
  hook: string,
  slice: ScoredSentence[],
  keyTerms: string[],
  pattern: HookPattern,
  platforms: Platform[],
  spokenPhrases: string[] = [],
): ClipTitle[] {
  const bare = hook.replace(/\s*[.]+$/, '');

  // Chosen once, so two platforms never silently reach for the same line.
  const support = pickSupport(slice, hook);
  const payoff = pickPayoff(slice, hook, support);

  return platforms.map((platform) => {
    const limit = PLATFORM_LIMITS[platform];
    const join = (extra: string | null, sep: string) =>
      extra && `${bare}${sep}${extra}`.length <= limit ? `${bare}${sep}${extra}` : bare;

    let text: string;
    switch (platform) {
      case 'youtube-shorts': text = bare; break;
      case 'tiktok':         text = bare; break;
      case 'instagram-reels': text = join(payoff && lowerFirst(payoff), ' — '); break;
      case 'x':              text = join(support, '\n\n'); break;
      case 'linkedin':       text = join(payoff ?? support, '\n\n'); break;
    }

    const finalText = fitMultiline(text, limit);
    return { platform, text: finalText, chars: finalText.length, limit };
  });
}

/** Fit that respects deliberate line breaks — only the last line is trimmed. */
function fitMultiline(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const lines = text.split('\n');
  if (lines.length === 1) return fit(text, limit);

  const head = lines.slice(0, -1).join('\n');
  const room = limit - head.length - 1;
  if (room < 24) return fit(lines[0], limit);
  return `${head}\n${fit(lines[lines.length - 1], room)}`;
}

/** The clip's strongest piece of evidence — a concrete, specific line. */
function pickSupport(slice: ScoredSentence[], hook: string): string | null {
  const lower = hook.toLowerCase();
  const candidate = slice
    .slice(1)
    .filter((s) => s.wordCount >= 5 && s.wordCount <= 24 && !lower.includes(s.text.slice(0, 22).toLowerCase()))
    // Stage direction is never evidence.
    .filter((s) => metaScore(s.text) < 0.25)
    .sort((a, b) => (b.signals.concrete + b.attention * 0.5) - (a.signals.concrete + a.attention * 0.5))[0];

  return candidate && candidate.signals.concrete > 0.08
    ? stripFiller(candidate.text).replace(/\s+/g, ' ')
    : null;
}

/** The line that closes the loop the hook opened. */
function pickPayoff(slice: ScoredSentence[], hook: string, taken: string | null): string | null {
  const lower = hook.toLowerCase();
  const candidate = slice
    .slice(1)
    .filter((s) => s.wordCount >= 5 && s.wordCount <= 22)
    .filter((s) => !lower.includes(s.text.slice(0, 22).toLowerCase()))
    .filter((s) => stripFiller(s.text) !== taken)
    .filter((s) => metaScore(s.text) < 0.25)
    .sort((a, b) => (b.signals.payoff + b.signals.quotable * 0.6) - (a.signals.payoff + a.signals.quotable * 0.6))[0];

  return candidate && candidate.signals.payoff + candidate.signals.quotable * 0.6 > 0.14
    ? stripFiller(candidate.text).replace(/\s+/g, ' ').replace(/[.]+$/, '')
    : null;
}

function lowerFirst(s: string): string {
  const t = s.trim();
  if (!t) return t;
  if (/^[A-Z]{2,}/.test(t)) return t;
  const first = t.split(/\s+/)[0];
  // Leave proper nouns and "I" alone.
  if (first === 'I' || (first.length > 1 && first[0] === first[0].toUpperCase() && first.slice(1) !== first.slice(1).toLowerCase())) return t;
  return t.charAt(0).toLowerCase() + t.slice(1);
}

/** Descriptions carry the searchable terms the title had no room for. */
export function writeDescription(
  hook: string,
  keyTerms: string[],
  sourceTitle: string,
  timecode: string,
  pattern: HookPattern,
  clipPhrases: string[] = [],
): string {
  // Phrases describe a clip far better than isolated words: "better lighting,
  // tighter edit" tells a reader what is in it; "lighting, audio, edit" does not.
  const topics = [
    ...clipPhrases.filter((p) => p.includes(' ')),
    ...keyTerms,
  ];
  const terms = [...new Set(topics)].slice(0, 4).join(', ');
  const closer =
    pattern === 'question' ? 'Full answer in the episode.'
    : pattern === 'instruction' ? 'Full walkthrough in the episode.'
    : pattern === 'statistic' ? 'The numbers and the method are in the episode.'
    : 'Full context in the episode.';

  return [
    hook,
    '',
    `${closer} From “${sourceTitle}” at ${timecode}.`,
    terms ? `\nCovered here: ${terms}.` : '',
  ]
    .filter((l) => l !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const PLATFORM_CONVENTION: Record<Platform, string[]> = {
  'youtube-shorts': ['shorts'],
  tiktok: ['fyp'],
  'instagram-reels': ['reels'],
  x: [],
  linkedin: [],
};

/**
 * Hashtags come from the clip's own vocabulary, plus at most two platform
 * conventions.
 *
 * The filter matters more than the ranking: a tag has to be a thing, not an
 * adjective or a verb form. "#better", "#every" and "#offended" are all words
 * the speaker said, and all of them are noise that costs reach rather than
 * buying it — so anything that is not a plausible topic noun is dropped, even
 * when it scored well as a term.
 */
const TAG_REJECT = new Set([
  'better', 'best', 'worse', 'worst', 'every', 'each', 'other', 'another', 'same', 'whole',
  'true', 'false', 'real', 'actual', 'entire', 'total', 'full', 'half', 'more', 'less',
  'first', 'second', 'third', 'last', 'next', 'early', 'late', 'long', 'short', 'high', 'low',
  'good', 'bad', 'great', 'small', 'large', 'hundred', 'thousand', 'million', 'billion',
  'measure', 'shape', 'offended', 'believing', 'arrives', 'arrive', 'previous', 'optimized',
  'name', 'thing', 'stuff', 'part', 'lot', 'bit', 'kind', 'sort', 'side', 'end', 'start',
]);

export function writeHashtags(
  keyTerms: string[],
  platforms: Platform[],
  clipPhrases: string[] = [],
  episodeTerms: string[] = [],
): string[] {
  const clean = (raw: string) => raw.replace(/[^a-z0-9]/gi, '').toLowerCase();

  const usable = (t: string) =>
    t.length >= 4 && t.length <= 18 &&
    !TAG_REJECT.has(t) &&
    // Comparatives, superlatives and participles are not topics.
    (!/(?:ing|ed|er|est|ly)$/.test(t) || t.length > 9);

  // Single distinctive terms are the conventional form and come first.
  const singles = [
    ...clipPhrases.filter((p) => !p.includes(' ')),
    ...keyTerms,
  ].map(clean).filter(usable);

  // A two-word phrase is only worth a tag when it stays short enough to read
  // as one — "#eleventhousandhours" is not a hashtag anyone types.
  const pairs = clipPhrases
    .filter((p) => p.split(' ').length === 2)
    .map(clean)
    .filter((t) => t.length <= 14 && !TAG_REJECT.has(t));

  let content = [...new Set([...singles, ...pairs])].slice(0, 5);

  // Some clips — a narrative opening, say — have no strong vocabulary of their
  // own. Falling back to relaxed terms from a weak clip produces "#better" and
  // "#every"; falling back to the recording's subject produces tags that are
  // at least true of the clip.
  if (content.length < 3) {
    const fromEpisode = episodeTerms.map(clean).filter(usable);
    content = [...new Set([...content, ...fromEpisode])].slice(0, 5);
  }

  const conventions = new Set<string>();
  for (const p of platforms) for (const t of PLATFORM_CONVENTION[p]) conventions.add(`#${t}`);

  return [...new Set([...content.map((t) => `#${t}`), ...[...conventions].slice(0, 2)])];
}

/**
 * The two-to-four words burned onto the thumbnail.
 *
 * Taking the first long words produced "EVERYBODY TELLS" — grammatically the
 * opening of the hook, and semantically nothing. The overlay has to carry the
 * *subject*, so candidates are ranked by how distinctive they are in the
 * recording, then restored to spoken order so the phrase still reads.
 */
export function writeOverlay(
  hook: string,
  keyTerms: string[],
  pattern: HookPattern,
  weightOf: (word: string) => number = () => 0,
): string {
  const figure = hook.match(/\b\$?\d[\d,.]*\s*(%|percent|x\b|k\b|million|billion)?/i)?.[0];
  if (pattern === 'statistic' && figure) {
    const rest = keyTerms[0] ? ` ${keyTerms[0].toUpperCase()}` : '';
    return `${figure.toUpperCase().trim()}${rest}`.slice(0, 22).trim();
  }

  const WEAK = new Set(['this', 'that', 'here', 'there', 'what', 'when', 'which', 'about', 'from', 'with', 'into', 'your', 'their', 'been', 'have', 'were', 'will', 'they', 'them', 'than', 'then', 'everybody', 'everyone', 'nobody', 'anyone', 'something', 'nothing', 'really', 'actually', 'because']);

  const words = hook
    .replace(/[^a-z0-9\s'-]/gi, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => ({ word: w, i, key: w.toLowerCase() }))
    .filter((w) => w.key.length >= 4 && !WEAK.has(w.key));

  // Prefer a run of adjacent words: "ALGORITHM DECIDES" reads as language,
  // "TELLS ALGORITHM DECIDES" reads as three words that happened to score well.
  let picked: string[] = [];
  let best = -Infinity;
  for (let n = 3; n >= 2; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const run = words.slice(i, i + n);
      const adjacent = run[run.length - 1].i - run[0].i === n - 1;
      const mass = run.reduce((acc, w) => acc + weightOf(w.key), 0) / n;
      const score = mass * (adjacent ? 1.45 : 1) * (n === 2 ? 1.1 : 1);
      if (score > best) { best = score; picked = run.map((w) => w.word); }
    }
  }
  if (picked.length < 2) picked = words.length ? words.slice(0, 2).map((w) => w.word) : keyTerms.slice(0, 2);
  let out = picked.join(' ').toUpperCase();

  if (out.length > 24) out = out.slice(0, 24).replace(/\s\S*$/, '');
  return out || (keyTerms[0] ?? 'WATCH').toUpperCase();
}
