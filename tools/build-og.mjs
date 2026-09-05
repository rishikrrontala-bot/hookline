/**
 * Renders the social card to public/og.png.
 *
 * The ridges on the card are the real attention curve of the sample recording,
 * produced by the engine at build time — the card shows the product's own
 * output rather than a drawing of it.
 *
 *   node tools/build-og.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => existsSync(p));

if (!CHROME) {
  console.error('No Chrome/Chromium found — skipping og.png. Install Chrome or commit the card by hand.');
  process.exit(1);
}

const curve = JSON.parse(readFileSync(join(root, 'tools/og-curve.json'), 'utf8'));

const template = readFileSync(join(root, 'tools/og-card.html'), 'utf8');
const page = template.replace(
  '<script>',
  `<script>window.__CURVE__ = ${JSON.stringify(curve)};</script>\n<script>`,
);

const temp = join(root, 'tools', '.og-render.html');
writeFileSync(temp, page);

try {
  execFileSync(CHROME, [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1200,630',
    `--screenshot=${join(root, 'public/og.png')}`,
    temp,
  ], { stdio: 'pipe' });
  console.log('wrote public/og.png');
} finally {
  unlinkSync(temp);
}
