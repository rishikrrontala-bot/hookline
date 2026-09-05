#!/usr/bin/env node
/**
 * HOOKLINE CLI — runs the identical engine the browser workspace runs, and
 * writes a complete export package to disk.
 *
 *   npm run cli -- <transcript> [--out DIR] [--clips N] [--min S] [--max S]
 *                  [--title "..."] [--platforms a,b] [--enhance] [--json]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename, extname, resolve } from 'node:path';
import { analyze } from '../engine/pipeline';
import { renderThumbnailSVG } from '../engine/generate/thumbnail';
import { scheduleToCSV } from '../engine/schedule';
import { formatTimecode, humanDuration } from '../engine/ingest';
import { PLATFORM_LABELS, PLATFORM_SHORT } from '../engine/generate/titles';
import { PATTERN_LABELS } from '../engine/generate/hooks';
import { SIGNAL_LABELS } from '../engine/signals';
import { enhanceWithClaude, hasClaudeKey } from '../engine/enhance';
import type { Analysis, Platform, SignalName } from '../engine/types';

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  heat: '\x1b[38;5;208m', cyan: '\x1b[38;5;80m', mist: '\x1b[38;5;245m',
  lime: '\x1b[38;5;149m', white: '\x1b[38;5;255m',
};
const supportsColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;
const c = (code: string, s: string) => (supportsColor ? `${code}${s}${C.reset}` : s);

interface Args {
  input?: string; out: string; clips: number; min: number; max: number;
  title?: string; platforms?: Platform[]; enhance: boolean; json: boolean; help: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { out: 'out', clips: 6, min: 16, max: 60, enhance: false, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--help' || arg === '-h') a.help = true;
    else if (arg === '--out' || arg === '-o') a.out = next();
    else if (arg === '--clips' || arg === '-n') a.clips = Number(next());
    else if (arg === '--min') a.min = Number(next());
    else if (arg === '--max') a.max = Number(next());
    else if (arg === '--title') a.title = next();
    else if (arg === '--platforms') a.platforms = next().split(',').map((p) => p.trim()) as Platform[];
    else if (arg === '--enhance') a.enhance = true;
    else if (arg === '--json') a.json = true;
    else if (!arg.startsWith('-')) a.input ??= arg;
  }
  return a;
}

const HELP = `
${c(C.heat + C.bold, 'HOOKLINE')} ${c(C.mist, '— one recording in, a week of channel output out')}

${c(C.bold, 'USAGE')}
  npm run cli -- <transcript.srt|.vtt|.txt> [options]

${c(C.bold, 'OPTIONS')}
  -o, --out <dir>        Output directory                    ${c(C.dim, '(default: out)')}
  -n, --clips <n>        Number of clips to extract          ${c(C.dim, '(default: 6)')}
      --min <sec>        Minimum clip length                 ${c(C.dim, '(default: 16)')}
      --max <sec>        Maximum clip length                 ${c(C.dim, '(default: 60)')}
      --title "<text>"   Source recording title
      --platforms <list> youtube-shorts,tiktok,instagram-reels,x,linkedin
      --enhance          Rewrite hooks and titles with Claude ${c(C.dim, '(needs ANTHROPIC_API_KEY)')}
      --json             Print the full analysis as JSON instead of a report

${c(C.bold, 'EXAMPLE')}
  npm run cli -- samples/the-algorithm-episode.srt --out out/demo --clips 6
`;

function bar(value: number, width = 18): string {
  const filled = Math.round(Math.max(0, Math.min(1, value)) * width);
  return c(C.heat, '█'.repeat(filled)) + c(C.dim, '░'.repeat(width - filled));
}

function sparkline(curve: { v: number }[], width = 64): string {
  if (!curve.length) return '';
  const blocks = '▁▂▃▄▅▆▇█';
  const step = curve.length / width;
  let out = '';
  for (let i = 0; i < width; i++) {
    const slice = curve.slice(Math.floor(i * step), Math.max(Math.floor((i + 1) * step), Math.floor(i * step) + 1));
    const v = slice.length ? Math.max(...slice.map((p) => p.v)) : 0;
    const ch = blocks[Math.min(blocks.length - 1, Math.floor(v * blocks.length))];
    out += v > 0.66 ? c(C.heat, ch) : v > 0.36 ? c(C.mist, ch) : c(C.dim, ch);
  }
  return out;
}

function report(a: Analysis, outDir: string) {
  const line = c(C.dim, '─'.repeat(72));
  const src = a.source;

  console.log(`\n${c(C.heat + C.bold, 'HOOKLINE')}  ${c(C.dim, '·')}  ${c(C.mist, `${humanDuration(src.durationSec)} · ${src.wordCount.toLocaleString()} words · ${src.format.toUpperCase()}`)}`);
  if (!src.hasRealTimings) console.log(c(C.dim, '  timings synthesized from a words-per-minute model · pace signal withheld'));
  console.log(line);

  for (const s of a.stages) {
    const label = s.label.padEnd(11);
    console.log(`  ${c(C.cyan, label)}${c(C.mist, s.detail.padEnd(48))}${c(C.dim, `${s.ms.toFixed(0)}ms`)}`);
  }

  console.log(`\n  ${c(C.bold, 'ATTENTION CURVE')}  ${c(C.dim, `0:00 ${'→'} ${formatTimecode(src.durationSec)}`)}`);
  console.log('  ' + sparkline(a.curve));
  console.log(c(C.dim, `  peak ${(a.stats.peakAttention * 100).toFixed(0)} · mean ${(a.stats.meanAttention * 100).toFixed(0)} · ${a.boundaries.length} topic boundaries`));
  console.log(line);

  for (const clip of a.clips) {
    const range = `${formatTimecode(clip.start)}–${formatTimecode(clip.end)}`;
    console.log(`\n  ${c(C.heat + C.bold, `#${clip.rank}`)} ${c(C.white, clip.score.toFixed(1).padStart(5))}  ${c(C.cyan, range)}  ${c(C.dim, `${clip.durationSec.toFixed(0)}s · ${PATTERN_LABELS[clip.hookPattern]}`)}`);
    console.log(`     ${c(C.white, clip.hook)}`);

    const top = (Object.keys(SIGNAL_LABELS) as SignalName[])
      .map((k) => ({ k, v: clip.signals[k] }))
      .sort((x, y) => y.v - x.v)
      .slice(0, 3);
    console.log('     ' + top.map((t) => `${c(C.dim, SIGNAL_LABELS[t.k].toLowerCase())} ${c(C.mist, (t.v * 100).toFixed(0))}`).join(c(C.dim, '  ·  ')));
    console.log(`     ${c(C.dim, clip.evidence.join(' · '))}`);
    for (const t of clip.titles.slice(0, 2)) {
      console.log(`     ${c(C.dim, PLATFORM_SHORT[t.platform].padEnd(9))}${c(C.mist, t.text.split('\n')[0])} ${c(C.dim, `${t.chars}/${t.limit}`)}`);
    }
  }

  console.log(`\n${line}\n  ${c(C.bold, 'CHAPTERS')}`);
  for (const ch of a.seo.chapters) console.log(`     ${c(C.cyan, ch.timecode.padEnd(9))}${c(C.mist, ch.label)}`);

  console.log(`\n  ${c(C.bold, 'SCHEDULE')}`);
  for (const s of a.schedule) {
    console.log(`     ${c(C.cyan, `${s.dayLabel.slice(0, 3)} ${s.time}`)}  ${c(C.mist, PLATFORM_LABELS[s.platform].padEnd(18))}${c(C.dim, s.clipId)}`);
  }

  const minutes = a.stats.estimatedManualMinutes;
  console.log(`\n${line}`);
  console.log(`  ${c(C.lime, '✓')} ${c(C.white, `${a.clips.length} clips`)} ${c(C.dim, '·')} ${c(C.white, `${a.clips.reduce((n, cl) => n + cl.titles.length, 0)} titles`)} ${c(C.dim, '·')} ${c(C.white, `${a.clips.reduce((n, cl) => n + cl.captions.length, 0)} caption cues`)} ${c(C.dim, '·')} ${c(C.white, `${a.seo.chapters.length} chapters`)}`);
  console.log(`  ${c(C.dim, `written to ${outDir}/ · replaces an estimated ${Math.floor(minutes / 60)}h ${minutes % 60}m of manual work`)}\n`);
}

function writePackage(a: Analysis, outDir: string, sourceName: string) {
  const dirs = ['clips', 'captions', 'thumbnails', 'metadata'];
  mkdirSync(outDir, { recursive: true });
  for (const d of dirs) mkdirSync(join(outDir, d), { recursive: true });

  for (const clip of a.clips) {
    writeFileSync(join(outDir, 'captions', `${clip.id}.srt`), clip.srt);
    writeFileSync(join(outDir, 'captions', `${clip.id}.vtt`), clip.vtt);
    writeFileSync(join(outDir, 'thumbnails', `${clip.id}.svg`), renderThumbnailSVG(clip, clip.rank));

    const md = [
      `# ${clip.id} · score ${clip.score.toFixed(1)}`,
      '',
      `**In / out** \`${formatTimecode(clip.start, { ms: true })}\` → \`${formatTimecode(clip.end, { ms: true })}\`  (${clip.durationSec.toFixed(1)}s)`,
      `**Hook pattern** ${PATTERN_LABELS[clip.hookPattern]}`,
      `**Selected because** ${clip.evidence.join('; ')}`,
      '',
      '## Hook', '', clip.hook, '',
      '## Titles', '',
      ...clip.titles.map((t) => `- **${PLATFORM_LABELS[t.platform]}** (${t.chars}/${t.limit}) — ${t.text.replace(/\n/g, ' ')}`),
      '',
      '## Description', '', clip.description, '',
      '## Hashtags', '', clip.hashtags.join(' '), '',
      '## Thumbnail', '',
      `- Overlay: **${clip.thumbnail.overlay}**`,
      `- Grab frame at \`${formatTimecode(clip.thumbnail.frameAtSec, { ms: true })}\``,
      `- ${clip.thumbnail.composition}`,
      '',
      '## B-roll cues', '', clip.bRoll.map((b) => `- ${b}`).join('\n'), '',
      '## Transcript', '', clip.transcript, '',
      '## Signals', '',
      '| signal | value |', '| --- | --- |',
      ...(Object.keys(SIGNAL_LABELS) as SignalName[]).map((k) => `| ${SIGNAL_LABELS[k]} | ${(clip.signals[k] * 100).toFixed(0)} |`),
    ].join('\n');
    writeFileSync(join(outDir, 'clips', `${clip.id}.md`), md);
  }

  // An ffmpeg script that cuts the actual clips — the bridge from analysis to media.
  const ff = [
    '#!/usr/bin/env bash',
    '# Generated by HOOKLINE. Cuts every clip from the source recording and burns in captions.',
    '# Usage: ./cut.sh /path/to/source-video.mp4',
    'set -euo pipefail',
    'SRC="${1:?pass the source video as the first argument}"',
    'OUT="$(cd "$(dirname "$0")" && pwd)/rendered"',
    'mkdir -p "$OUT"',
    '',
    ...a.clips.flatMap((clip) => [
      `# ${clip.id} — ${clip.hook.replace(/\n/g, ' ').slice(0, 70)}`,
      `ffmpeg -y -ss ${clip.start.toFixed(3)} -to ${clip.end.toFixed(3)} -i "$SRC" \\`,
      `  -vf "crop=ih*9/16:ih,scale=1080:1920,subtitles=$(printf %q "captions/${clip.id}.srt"):force_style='Fontsize=17,Outline=2,Alignment=2,MarginV=140'" \\`,
      `  -c:a aac -b:a 192k -c:v libx264 -preset slow -crf 20 "$OUT/${clip.id}.mp4"`,
      '',
    ]),
  ].join('\n');
  writeFileSync(join(outDir, 'cut.sh'), ff, { mode: 0o755 });

  writeFileSync(join(outDir, 'schedule.csv'), scheduleToCSV(a.schedule, a.clips));
  writeFileSync(
    join(outDir, 'chapters.txt'),
    a.seo.chapters.map((ch) => `${ch.timecode} ${ch.label}`).join('\n') + '\n',
  );
  writeFileSync(
    join(outDir, 'metadata', 'channel-seo.md'),
    [
      '# Source recording — titles, description, tags', '',
      '## Title options', '',
      ...a.seo.titles.map((t, i) => `${i + 1}. ${t}  \`${t.length}/70\``),
      '', '## Description', '', '```', a.seo.description, '```', '',
      '## Tags', '', a.seo.tags.join(', '), '',
      '## Pull quote', '', `> ${a.seo.pullQuote}`,
    ].join('\n'),
  );
  writeFileSync(join(outDir, 'metadata', 'analysis.json'), JSON.stringify(
    { source: a.source, stats: a.stats, stages: a.stages, boundaries: a.boundaries, segments: a.segments, clips: a.clips, seo: a.seo, schedule: a.schedule },
    null, 2,
  ));
  writeFileSync(join(outDir, 'metadata', 'attention-curve.json'), JSON.stringify(a.curve));

  const readme = [
    `# Output package — ${sourceName}`, '',
    `Generated by HOOKLINE from a ${humanDuration(a.stats.durationSec)} recording (${a.stats.wordCount.toLocaleString()} words).`,
    '',
    '| | |', '| --- | --- |',
    `| Clips | ${a.stats.clipCount} (${a.stats.minutesOfOutput.toFixed(1)} min of vertical output) |`,
    `| Topic segments | ${a.stats.segmentCount} |`,
    `| Chapters | ${a.seo.chapters.length} |`,
    `| Scheduled posts | ${a.schedule.length} across 7 days |`,
    `| Peak attention | ${(a.stats.peakAttention * 100).toFixed(0)} / 100 |`,
    '',
    '## What is in here', '',
    '- `clips/` — one Markdown brief per clip: hook, titles, description, hashtags, thumbnail spec, b-roll, transcript, signal readout.',
    '- `captions/` — SRT and VTT per clip, cut for a vertical safe area and timed to the word.',
    '- `thumbnails/` — a 9:16 SVG layout proof per clip with the overlay text and grab timecode.',
    '- `metadata/` — channel title options, description with chapters, tag set, and the full analysis as JSON.',
    '- `chapters.txt` — paste straight into the source video description.',
    '- `schedule.csv` — a week of posts with times, platforms and the reason for each placement.',
    '- `cut.sh` — ffmpeg script that renders every clip vertically with captions burned in.',
    '',
    '## Cutting the video', '', '```bash', './cut.sh /path/to/source-video.mp4', '```', '',
    `_Estimated manual equivalent: ${Math.floor(a.stats.estimatedManualMinutes / 60)}h ${a.stats.estimatedManualMinutes % 60}m._`,
  ].join('\n');
  writeFileSync(join(outDir, 'README.md'), readme);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.input) { console.log(HELP); process.exit(args.input ? 0 : 1); }

  const inputPath = resolve(args.input!);
  if (!existsSync(inputPath)) {
    console.error(c(C.heat, `\n  Not found: ${inputPath}\n`));
    process.exit(1);
  }

  const raw = readFileSync(inputPath, 'utf8');
  const sourceName = basename(inputPath, extname(inputPath));
  const title = args.title ?? sourceName.replace(/[-_]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

  let analysis = analyze(raw, {
    clipCount: args.clips, minClipSec: args.min, maxClipSec: args.max,
    platforms: args.platforms, sourceTitle: title,
  });

  if (!analysis.clips.length) {
    console.error(c(C.heat, '\n  Transcript too short to analyze — needs at least a few sentences.\n'));
    process.exit(1);
  }

  if (args.enhance) {
    if (!hasClaudeKey()) {
      console.error(c(C.dim, '\n  --enhance skipped: ANTHROPIC_API_KEY is not set. Deterministic output below.\n'));
    } else {
      process.stdout.write(c(C.dim, '  enhancing with Claude… '));
      try {
        analysis = await enhanceWithClaude(analysis);
        console.log(c(C.lime, 'done'));
      } catch (err) {
        console.log(c(C.heat, `failed — keeping deterministic output (${(err as Error).message})`));
      }
    }
  }

  if (args.json) { console.log(JSON.stringify(analysis, null, 2)); return; }

  const outDir = resolve(args.out);
  writePackage(analysis, outDir, title);
  report(analysis, args.out);
}

main().catch((err) => { console.error(err); process.exit(1); });
