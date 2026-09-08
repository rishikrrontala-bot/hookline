/**
 * Rasterises the HOOKLINE mark and wordmark to PNG.
 *
 * SVG is the source of truth, but plenty of places refuse it — Devpost's image
 * gallery, app icon slots, README badges, slide decks. This renders the same
 * geometry through headless Chrome so the PNGs cannot drift from the SVG, and
 * so the wordmark uses the real Archivo face rather than a fallback.
 *
 *   node tools/brand/render.mjs
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, unlinkSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const OUT = join(root, 'public', 'brand');

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => existsSync(p));

if (!CHROME) {
  console.error('No Chrome/Chromium found — cannot rasterise. The SVGs in public/ are still current.');
  process.exit(1);
}

const CYAN = '#2FD2F5';
const HEAT = '#FF6A1F';
const INK = '#0A0C10';
const MIST = '#E8EDF4';

/** One source of truth for the geometry — mirrors public/mark.svg exactly. */
const mark = (bar, curve) => `
  <rect x="4" y="5.4" width="3.6" height="21.2" rx="1.8" fill="${bar}"/>
  <rect x="24.4" y="5.4" width="3.6" height="21.2" rx="1.8" fill="${bar}"/>
  <path d="M 10.4 20.6 C 12.5 20.6 12.7 10.6 15.9 10.6 C 19.1 10.6 19.4 17.8 21.6 17.8"
        stroke="${curve}" stroke-width="3" stroke-linecap="round" fill="none"/>`;

const ARCHIVO = join(root, 'node_modules/@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2');
const FONT = `@font-face{font-family:'Archivo';src:url('file://${ARCHIVO}') format('woff2-variations');font-weight:100 900;font-stretch:62% 125%;}`;

const page = (body, css = '') => `<!doctype html><meta charset="utf-8"><style>
${FONT}
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:transparent}
.word{font-family:'Archivo',sans-serif;font-weight:800;font-stretch:118%;letter-spacing:.085em;line-height:1}
${css}</style>${body}`;

function shoot(name, html, w, h, opaque = false) {
  const tmp = join(here, `.render-${name}.html`);
  writeFileSync(tmp, html);
  try {
    execFileSync(CHROME, [
      '--headless', '--disable-gpu', '--hide-scrollbars',
      `--window-size=${w},${h}`,
      '--force-device-scale-factor=1',
      ...(opaque ? [] : ['--default-background-color=00000000']),
      `--screenshot=${join(OUT, name)}`,
      tmp,
    ], { stdio: 'pipe' });
    console.log(`  ${name.padEnd(30)} ${w}x${h}  ${(statSync(join(OUT, name)).size / 1024).toFixed(0)}KB`);
  } finally {
    unlinkSync(tmp);
  }
}

mkdirSync(OUT, { recursive: true });

// ── The mark alone, transparent, at icon sizes ─────────────────────────────
for (const size of [1024, 512, 256, 128, 64, 32]) {
  shoot(`mark-${size}.png`,
    page(`<svg width="${size}" height="${size}" viewBox="0 0 32 32" style="display:block">${mark(CYAN, HEAT)}</svg>`),
    size, size);
}

// Monochrome, for a single-colour context.
shoot('mark-512-mono-light.png',
  page(`<svg width="512" height="512" viewBox="0 0 32 32" style="display:block">${mark(MIST, MIST)}</svg>`), 512, 512);
shoot('mark-512-mono-dark.png',
  page(`<svg width="512" height="512" viewBox="0 0 32 32" style="display:block">${mark('#06070A', '#06070A')}</svg>`), 512, 512);

// ── App icon: the mark on its own tile ─────────────────────────────────────
//
// Rendered with transparency on, so the area outside the rounded corners is
// clear rather than white. An opaque render leaves white triangles that show
// against any dark surface the icon is placed on.
for (const size of [1024, 512, 180]) {
  const r = Math.round(size * 0.22);
  shoot(`icon-${size}.png`, page(
    `<div style="width:${size}px;height:${size}px;background:${INK};border-radius:${r}px;display:grid;place-items:center">
       <svg width="${Math.round(size * 0.62)}" height="${Math.round(size * 0.62)}" viewBox="0 0 32 32">${mark(CYAN, HEAT)}</svg>
     </div>`), size, size);
}

// Unrounded square, for iOS and macOS, which apply their own mask and would
// otherwise round an already-rounded icon twice.
for (const size of [1024, 512]) {
  shoot(`icon-${size}-square.png`, page(
    `<div style="width:${size}px;height:${size}px;background:${INK};display:grid;place-items:center">
       <svg width="${Math.round(size * 0.58)}" height="${Math.round(size * 0.58)}" viewBox="0 0 32 32">${mark(CYAN, HEAT)}</svg>
     </div>`), size, size, true);
}

// ── Horizontal lockup, transparent, light and dark ─────────────────────────
for (const [name, textColor, barColor, curveColor] of [
  ['lockup-light-on-dark', MIST, CYAN, HEAT],
  ['lockup-dark-on-light', '#06070A', '#0A6E85', '#C4470D'],
  ['lockup-mono-light', MIST, MIST, MIST],
  ['lockup-mono-dark', '#06070A', '#06070A', '#06070A'],
]) {
  const H = 96;
  shoot(`${name}.png`, page(
    `<div style="height:${H}px;display:inline-flex;align-items:center;gap:18px;padding:0 4px">
       <svg width="64" height="64" viewBox="0 0 32 32">${mark(barColor, curveColor)}</svg>
       <span class="word" style="font-size:38px;color:${textColor};padding-top:3px">HOOKLINE</span>
     </div>`), 340, H);
}

// ── 3:2 brand card, sized for a project gallery ────────────────────────────
shoot('brand-card-1440x960.png', page(
  `<div class="card">
     <div class="lk">
       <svg width="132" height="132" viewBox="0 0 32 32">${mark(CYAN, HEAT)}</svg>
       <span class="word" style="font-size:82px;color:${MIST};padding-top:6px">HOOKLINE</span>
     </div>
     <p class="tag">Measure where a recording holds attention.<br/>Cut where the subject actually changes.</p>
     <div class="rule"></div>
     <p class="foot">EIGHT SIGNALS PER SENTENCE &nbsp;·&nbsp; TOPIC-BOUNDARY CUTS &nbsp;·&nbsp; NO API KEY</p>
   </div>`,
  `.card{width:1440px;height:960px;background:${INK};display:flex;flex-direction:column;
     align-items:center;justify-content:center;gap:44px;position:relative;overflow:hidden}
   .card::after{content:'';position:absolute;inset:0;opacity:.05;mix-blend-mode:overlay;
     background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E")}
   .lk{display:flex;align-items:center;gap:30px}
   .tag{font-family:'Archivo',sans-serif;font-weight:500;font-size:29px;line-height:1.5;
     color:#9AA6B6;text-align:center;letter-spacing:-.01em}
   .rule{width:190px;height:3px;background:${HEAT};border-radius:2px}
   .foot{font-family:ui-monospace,monospace;font-size:17px;letter-spacing:.2em;color:#7E8A9B}`),
  1440, 960, true);

console.log(`\n  → public/brand/`);
