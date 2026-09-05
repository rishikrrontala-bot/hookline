import type { Analysis, Clip, ClipTitle } from './types';
import { PLATFORM_LIMITS, PLATFORM_LABELS, fit } from './generate/titles';
import { PATTERN_LABELS } from './generate/hooks';

/**
 * Optional Claude pass.
 *
 * The deterministic engine already produced a complete, publishable result.
 * This layer only rewrites the *copy* — hooks and titles — and it is strictly
 * additive: every failure mode (no key, network error, malformed response,
 * over-length output) falls back to the deterministic text rather than
 * degrading it. The clip selection, timings, captions, chapters and schedule
 * are never touched, because those are measurements, not prose.
 */

const MODEL = 'claude-opus-5';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';

export interface EnhanceConfig {
  apiKey?: string;
  model?: string;
  /** Set by the browser client, which must route through a proxy or opt in explicitly. */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export function hasClaudeKey(config: EnhanceConfig = {}): boolean {
  return Boolean(config.apiKey ?? readEnvKey());
}

function readEnvKey(): string | undefined {
  // Node only. The browser client passes the key explicitly.
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.ANTHROPIC_API_KEY;
}

interface Rewrite {
  id: string;
  hook?: string;
  titles?: Record<string, string>;
}

function buildPrompt(clips: Clip[]): string {
  const blocks = clips.map((c) => {
    const platforms = c.titles.map((t) => `${t.platform} (max ${t.limit} chars)`).join(', ');
    return [
      `<clip id="${c.id}" pattern="${PATTERN_LABELS[c.hookPattern]}" duration="${c.durationSec.toFixed(0)}s">`,
      `<transcript>${c.transcript}</transcript>`,
      `<current_hook>${c.hook}</current_hook>`,
      `<platforms>${platforms}</platforms>`,
      `</clip>`,
    ].join('\n');
  });

  return [
    'You are rewriting short-form video copy for clips that have already been selected and timed.',
    '',
    'Hard rules:',
    '1. Use ONLY claims, figures and language present in the clip transcript. Invent nothing — no statistics, outcomes, or promises that are not said.',
    '2. The hook must be one sentence and must work for a viewer with zero context who is mid-scroll.',
    '3. Never open a hook with a pronoun that has no antecedent in the hook itself.',
    '4. Respect each platform character limit exactly. Shorter is fine; over is not.',
    '5. No emoji except where the current title already has one. No hashtags in titles. No clickbait the transcript cannot support.',
    '6. Keep the speaker\'s register. If they are plain and dry, stay plain and dry.',
    '',
    'Return ONLY a JSON array, no prose, no code fence:',
    '[{"id":"clip-01","hook":"...","titles":{"youtube-shorts":"...","tiktok":"..."}}]',
    '',
    ...blocks,
  ].join('\n');
}

function extractJSON(text: string): Rewrite[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('[');
  const end = body.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('no JSON array in response');
  const parsed = JSON.parse(body.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error('response was not an array');
  return parsed as Rewrite[];
}

export async function enhanceWithClaude(analysis: Analysis, config: EnhanceConfig = {}): Promise<Analysis> {
  const apiKey = config.apiKey ?? readEnvKey();
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  if (!analysis.clips.length) return analysis;

  const doFetch = config.fetchImpl ?? fetch;
  const response = await doFetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Required for direct browser calls; harmless from Node.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: config.model ?? MODEL,
      max_tokens: 3000,
      messages: [{ role: 'user', content: buildPrompt(analysis.clips) }],
    }),
    signal: config.signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`API ${response.status}${detail ? `: ${detail.slice(0, 160)}` : ''}`);
  }

  const payload = (await response.json()) as { content?: { type: string; text?: string }[] };
  const text = payload.content?.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('') ?? '';
  const rewrites = extractJSON(text);
  const byId = new Map(rewrites.map((r) => [r.id, r]));

  const clips = analysis.clips.map((clip) => {
    const r = byId.get(clip.id);
    if (!r) return clip;

    const hook = typeof r.hook === 'string' && r.hook.trim().length > 8 ? r.hook.trim() : clip.hook;

    const titles: ClipTitle[] = clip.titles.map((t) => {
      const proposed = r.titles?.[t.platform];
      if (typeof proposed !== 'string' || proposed.trim().length < 4) return t;
      // Over-length output is trimmed rather than rejected — the model got the
      // idea right even when it miscounted characters.
      const text = fit(proposed.trim(), PLATFORM_LIMITS[t.platform]);
      return { ...t, text, chars: text.length };
    });

    return { ...clip, hook, titles, enhanced: true };
  });

  return { ...analysis, clips };
}

export { PLATFORM_LABELS };
