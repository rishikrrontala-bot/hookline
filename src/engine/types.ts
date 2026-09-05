/**
 * HOOKLINE engine — shared types.
 *
 * The engine is framework-free and dependency-free by design: the exact same
 * modules run inside the browser workspace and inside the Node CLI. Nothing in
 * here may import from `src/app` or touch `window`, `document`, or `fs`.
 */

/** A timed unit of transcript as it arrived from the source file. */
export interface Cue {
  start: number; // seconds
  end: number; // seconds
  text: string;
}

export type SourceFormat = 'srt' | 'vtt' | 'timecoded' | 'plain';

export interface Ingested {
  cues: Cue[];
  format: SourceFormat;
  /** True when timings came from the file. False when synthesized from a WPM model. */
  hasRealTimings: boolean;
  durationSec: number;
  wordCount: number;
}

/** A sentence is the atomic unit the engine scores and cuts on. */
export interface Sentence {
  index: number;
  text: string;
  start: number;
  end: number;
  /** Lowercased word tokens, punctuation stripped. */
  tokens: string[];
  /** Content tokens only — stopwords removed, light stemming applied. */
  terms: string[];
  wordCount: number;
  /** Words per second. Meaningless when timings were synthesized. */
  wps: number;
}

/** The eight independent signals scored per sentence. Each is 0..1. */
export interface SignalSet {
  hook: number;
  curiosity: number;
  emotion: number;
  concrete: number;
  salience: number;
  payoff: number;
  pace: number;
  quotable: number;
}

export type SignalName = keyof SignalSet;

export interface ScoredSentence extends Sentence {
  signals: SignalSet;
  /** Weighted combination of `signals`, 0..1, before smoothing. */
  raw: number;
  /** `raw` after Gaussian smoothing across neighbours. The attention curve. */
  attention: number;
  /** Human-readable reasons this sentence scored where it did. */
  evidence: string[];
}

/** A topic boundary found by lexical-cohesion segmentation. */
export interface Boundary {
  /** Index of the sentence that *starts* the new topic. */
  sentenceIndex: number;
  timeSec: number;
  /** Depth score of the cohesion valley. Higher = sharper topic change. */
  depth: number;
}

/** Block similarity at each inter-sentence gap — the series boundaries came from. */
export type CohesionSeries = number[];

export interface Segment {
  index: number;
  startSentence: number;
  endSentence: number; // inclusive
  start: number;
  end: number;
  /** Top TF-IDF terms describing what this stretch is about. */
  keyTerms: string[];
  /** A short generated label used for chapters. */
  label: string;
  meanAttention: number;
}

export type Platform = 'youtube-shorts' | 'tiktok' | 'instagram-reels' | 'x' | 'linkedin';

export interface CaptionCue {
  index: number;
  start: number; // seconds, relative to clip start
  end: number;
  text: string;
}

export interface WordCue {
  word: string;
  start: number;
  end: number;
}

export interface ThumbnailConcept {
  /** 2–4 words, all caps, burned over the frame. */
  overlay: string;
  /** Where in the clip to grab the still. */
  frameAtSec: number;
  composition: string;
  /** Hex pair driving the generated SVG card. */
  heat: [string, string];
}

export interface ClipTitle {
  platform: Platform;
  text: string;
  chars: number;
  limit: number;
}

export interface Clip {
  id: string;
  rank: number;
  start: number;
  end: number;
  durationSec: number;
  startSentence: number;
  endSentence: number;
  transcript: string;
  /** 0..100, the composite selection score. */
  score: number;
  /** Component parts of `score`, each 0..1, so the choice is inspectable. */
  breakdown: {
    opening: number;
    body: number;
    payoff: number;
    containment: number;
    boundary: number;
  };
  /** Mean of each signal across the clip. Drives the readout bars. */
  signals: SignalSet;
  /** The strongest named reasons this clip was selected. */
  evidence: string[];
  /** Detected rhetorical shape of the opening. */
  hookPattern: HookPattern;
  hook: string;
  titles: ClipTitle[];
  description: string;
  hashtags: string[];
  captions: CaptionCue[];
  words: WordCue[];
  srt: string;
  vtt: string;
  thumbnail: ThumbnailConcept;
  bRoll: string[];
  /** Which topic segment this clip came out of. */
  segmentIndex: number;
  /** True once an optional Claude pass has rewritten the copy. */
  enhanced?: boolean;
}

export type HookPattern =
  | 'question'
  | 'statistic'
  | 'contrarian'
  | 'stakes'
  | 'story'
  | 'instruction'
  | 'declaration';

export interface Chapter {
  start: number;
  timecode: string;
  label: string;
}

export interface ChannelSEO {
  titles: string[];
  description: string;
  tags: string[];
  chapters: Chapter[];
  /** The strongest single sentence in the whole recording. */
  pullQuote: string;
  keyTerms: { term: string; weight: number }[];
}

export interface ScheduleSlot {
  clipId: string;
  platform: Platform;
  /** ISO date, local. */
  date: string;
  /** 24h local time, `HH:MM`. */
  time: string;
  dayLabel: string;
  rationale: string;
}

export interface PipelineStage {
  key: string;
  label: string;
  detail: string;
  ms: number;
}

export interface AnalysisOptions {
  /** How many clips to extract. */
  clipCount?: number;
  minClipSec?: number;
  maxClipSec?: number;
  /** Local date the schedule starts from. Defaults to today. */
  scheduleStart?: Date;
  platforms?: Platform[];
  /** Words per minute used to synthesize timings for plain text. */
  wpm?: number;
  /** Optional title of the source recording, used in SEO copy. */
  sourceTitle?: string;
}

export interface Analysis {
  source: Ingested;
  sentences: ScoredSentence[];
  boundaries: Boundary[];
  /** Lexical cohesion at each sentence gap. Valleys are the topic boundaries. */
  cohesion: CohesionSeries;
  /** The slice of `cohesion` that carries a real measurement. */
  cohesionRange: [number, number];
  segments: Segment[];
  clips: Clip[];
  seo: ChannelSEO;
  schedule: ScheduleSlot[];
  stages: PipelineStage[];
  /** Downsampled attention curve for rendering. */
  curve: { t: number; v: number }[];
  stats: {
    durationSec: number;
    wordCount: number;
    sentenceCount: number;
    segmentCount: number;
    clipCount: number;
    minutesOfOutput: number;
    meanAttention: number;
    peakAttention: number;
    estimatedManualMinutes: number;
  };
}
