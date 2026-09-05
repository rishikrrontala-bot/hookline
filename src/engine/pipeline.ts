import type { Analysis, AnalysisOptions, Clip, Platform, PipelineStage, SignalSet, SignalName } from './types';
import { ingest, formatTimecode } from './ingest';
import { buildSentences, buildVocabulary, buildSurfaceForms, topPhrases, subjectTerms, mean } from './stats';
import { stem } from './text/tokenize';
import { findBoundaries, buildSegments } from './segment';
import { scoreSentences, buildCurve } from './signals';
import { buildCandidates, selectClips } from './clips';
import { detectPattern, writeHook, PATTERN_LABELS } from './generate/hooks';
import { writeTitles, writeDescription, writeHashtags, writeOverlay } from './generate/titles';
import { buildCaptions, wordTimings, toSRT, toVTT } from './generate/captions';
import { buildThumbnail } from './generate/thumbnail';
import { buildSEO } from './generate/seo';
import { buildSchedule } from './schedule';

const DEFAULT_PLATFORMS: Platform[] = ['youtube-shorts', 'tiktok', 'instagram-reels', 'x'];

/**
 * A creator cutting a clip by hand does eleven things: find it, trim it,
 * write a hook, write a title per platform, write a description, pick tags,
 * time captions, design a thumbnail, note b-roll, and place it on a calendar.
 * Conservatively, twelve minutes each — used only to report time saved, and
 * labelled as an estimate everywhere it appears.
 */
const MANUAL_MINUTES_PER_CLIP = 12;

export function analyze(raw: string, options: AnalysisOptions = {}): Analysis {
  const stages: PipelineStage[] = [];
  const mark = (key: string, label: string, detail: string, t0: number) =>
    stages.push({ key, label, detail, ms: now() - t0 });

  const platforms = options.platforms ?? DEFAULT_PLATFORMS;
  const clipCount = options.clipCount ?? 6;
  const minSec = options.minClipSec ?? 16;
  const maxSec = options.maxClipSec ?? 60;

  // ── 1. Ingest ────────────────────────────────────────────────────────────
  let t = now();
  const source = ingest(raw, { wpm: options.wpm });
  mark('ingest', 'Ingest', `${source.format.toUpperCase()} · ${source.cues.length} cues · ${source.wordCount.toLocaleString()} words`, t);

  // ── 2. Sentences + vocabulary ────────────────────────────────────────────
  t = now();
  const plain = buildSentences(source.cues);
  const vocab = buildVocabulary(plain);
  const surfaceForms = buildSurfaceForms(plain);
  mark('parse', 'Segment', `${plain.length} sentences · ${vocab.idf.size} distinct terms`, t);

  if (plain.length < 6) return emptyAnalysis(source, stages);

  // ── 3. Signal scoring ────────────────────────────────────────────────────
  t = now();
  const sentences = scoreSentences(plain, vocab, { hasRealTimings: source.hasRealTimings });
  mark('score', 'Score', `8 signals × ${plain.length} sentences${source.hasRealTimings ? '' : ' · pace withheld'}`, t);

  // ── 4. Topic boundaries ──────────────────────────────────────────────────
  t = now();
  const { boundaries, cohesion, cohesionRange } = findBoundaries(sentences, vocab);
  const segments = buildSegments(sentences, boundaries, vocab, surfaceForms);
  mark('boundaries', 'Boundaries', `${boundaries.length} topic shifts · ${segments.length} segments`, t);

  // ── 5. Candidate windows + NMS ───────────────────────────────────────────
  t = now();
  const candidates = buildCandidates(sentences, boundaries, segments, { minSec, maxSec });
  const picked = selectClips(candidates, clipCount);
  mark('extract', 'Extract', `${candidates.length.toLocaleString()} windows → ${picked.length} clips`, t);

  // ── 6. Copy, captions, thumbnails ────────────────────────────────────────
  t = now();
  // Distinctiveness lookup shared by the overlay writer, so thumbnail text
  // carries the subject rather than whichever long word came first.
  const weightOf = (word: string) => vocab.idf.get(stem(word)) ?? 0;

  // The recording's own subject, used where a clip has no strong vocabulary.
  const episodeTerms = topPhrases(sentences, vocab, { maxLen: 2, limit: 10, minCount: 2 })
    .flatMap((x) => x.phrase.split(' '));
  const sourceTitle =
    options.sourceTitle ?? inferTitle(sentences.slice(0, 6).map((s) => s.text).join(' '), episodeTerms);

  const clips: Clip[] = picked.map((c, i) => {
    const slice = sentences.slice(c.startSentence, c.endSentence + 1);
    const pattern = detectPattern(slice);
    const hook = writeHook(slice, pattern);
    const clipTerms = subjectTerms(slice, sentences, vocab, surfaceForms, { limit: 6, fallback: episodeTerms });
    // Phrases from this clip specifically — a subject the whole episode shares
    // says nothing about which clip the viewer is looking at.
    const clipPhrases = topPhrases(slice, vocab, { maxLen: 3, limit: 6, minCount: 1 }).map((x) => x.phrase);

    const captions = buildCaptions(slice, c.start);
    const words = wordTimings(slice, c.start);
    const overlay = writeOverlay(hook, clipTerms, pattern, weightOf);
    const score = Math.round(c.score * 1000) / 10;

    return {
      id: `clip-${String(i + 1).padStart(2, '0')}`,
      rank: i + 1,
      start: c.start,
      end: c.end,
      durationSec: c.durationSec,
      startSentence: c.startSentence,
      endSentence: c.endSentence,
      transcript: slice.map((s) => s.text).join(' '),
      score,
      breakdown: c.breakdown,
      signals: c.signals,
      evidence: c.evidence.length ? c.evidence : [PATTERN_LABELS[pattern].toLowerCase()],
      hookPattern: pattern,
      hook,
      titles: writeTitles(hook, slice, clipTerms, pattern, platforms, clipPhrases),
      description: writeDescription(hook, clipTerms, sourceTitle, formatTimecode(c.start), pattern, clipPhrases),
      hashtags: writeHashtags(clipTerms, platforms, clipPhrases, episodeTerms),
      captions,
      words,
      srt: toSRT(captions),
      vtt: toVTT(captions),
      thumbnail: buildThumbnail(overlay, pattern, c.start, c.durationSec, c.score),
      bRoll: buildBRoll(slice, clipPhrases, clipTerms),
      segmentIndex: c.segmentIndex,
    };
  });
  mark('write', 'Write', `${clips.length} hooks · ${clips.length * platforms.length} titles · ${clips.reduce((n, c) => n + c.captions.length, 0)} caption cues`, t);

  // ── 7. Channel SEO ───────────────────────────────────────────────────────
  t = now();
  const seo = buildSEO(sentences, segments, vocab, surfaceForms, source.durationSec, sourceTitle);
  mark('seo', 'Index', `${seo.chapters.length} chapters · ${seo.tags.length} tags`, t);

  // ── 8. Schedule ──────────────────────────────────────────────────────────
  t = now();
  const schedule = buildSchedule(clips, platforms, options.scheduleStart ?? new Date());
  mark('schedule', 'Schedule', `${schedule.length} slots across 7 days`, t);

  const curve = buildCurve(sentences, source.durationSec);
  const attentions = sentences.map((s) => s.attention);

  return {
    source,
    sentences,
    boundaries,
    cohesion,
    cohesionRange,
    segments,
    clips,
    seo,
    schedule,
    stages,
    curve,
    stats: {
      durationSec: source.durationSec,
      wordCount: source.wordCount,
      sentenceCount: sentences.length,
      segmentCount: segments.length,
      clipCount: clips.length,
      minutesOfOutput: clips.reduce((n, c) => n + c.durationSec, 0) / 60,
      meanAttention: mean(attentions),
      peakAttention: attentions.length ? Math.max(...attentions) : 0,
      estimatedManualMinutes: clips.length * MANUAL_MINUTES_PER_CLIP,
    },
  };
}

/** Corpus-wide mean of each signal — the baseline a clip's readout is compared against. */
export function corpusMean(analysis: Analysis): SignalSet {
  const keys: SignalName[] = ['hook', 'curiosity', 'emotion', 'concrete', 'salience', 'payoff', 'pace', 'quotable'];
  const out = {} as SignalSet;
  for (const k of keys) out[k] = mean(analysis.sentences.map((s) => s.signals[k]));
  return out;
}

/**
 * B-roll cues.
 *
 * These are search terms an editor pastes into a stock library, so a phrase is
 * worth far more than a word: "mid-scroll thumb" finds footage, "arrives" does
 * not. Named entities come first because they are the most specific thing the
 * clip mentions, then the clip's own phrases.
 */
function buildBRoll(
  slice: { tokens: string[]; text: string }[],
  clipPhrases: string[],
  clipTerms: string[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const add = (value: string) => {
    const key = value.toLowerCase();
    if (seen.has(key) || out.length >= 5) return;
    seen.add(key);
    out.push(value);
  };

  for (const s of slice) {
    for (const proper of s.text.match(/(?!^)\b[A-Z][a-zA-Z]{2,}/g) ?? []) add(proper);
  }
  for (const phrase of clipPhrases.filter((p) => p.includes(' '))) add(phrase);
  for (const term of clipTerms) add(term);

  return out.slice(0, 5);
}

function inferTitle(head: string, terms: string[]): string {
  if (terms.length) {
    return terms.slice(0, 3).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
  return head.split(/[.?!]/)[0]?.slice(0, 60) || 'Untitled recording';
}

function emptyAnalysis(source: Analysis['source'], stages: PipelineStage[]): Analysis {
  return {
    source,
    sentences: [], boundaries: [], cohesion: [], cohesionRange: [0, 0], segments: [], clips: [],
    seo: { titles: [], description: '', tags: [], chapters: [], pullQuote: '', keyTerms: [] },
    schedule: [], stages, curve: [],
    stats: {
      durationSec: source.durationSec, wordCount: source.wordCount, sentenceCount: 0,
      segmentCount: 0, clipCount: 0, minutesOfOutput: 0, meanAttention: 0, peakAttention: 0,
      estimatedManualMinutes: 0,
    },
  };
}

const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
