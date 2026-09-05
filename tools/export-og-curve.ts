/**
 * Exports the sample recording's attention curve for the social card, so the
 * ridges on it are the engine's own output rather than a drawing of one.
 *
 *   npm run og
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { analyze } from '../src/engine/pipeline';

const POINTS = 120;

const analysis = analyze(readFileSync('samples/the-algorithm-episode.srt', 'utf8'), { clipCount: 6 });

const curve: number[] = [];
for (let i = 0; i < POINTS; i++) {
  const at = Math.round((i / (POINTS - 1)) * (analysis.curve.length - 1));
  curve.push(Math.round((analysis.curve[at]?.v ?? 0) * 1000) / 1000);
}

writeFileSync('tools/og-curve.json', JSON.stringify(curve));
console.log(`exported ${curve.length} points · peak ${Math.max(...curve)}`);
