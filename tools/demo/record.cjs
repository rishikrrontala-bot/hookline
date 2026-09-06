'use strict';
/**
 * Records the HOOKLINE demo video.
 *
 * Playwright is not a project dependency — a judge running `npm install`
 * should not pay for a 90MB browser download to use the tool. Install it
 * wherever you like and point NODE_PATH at it:
 *
 *   mkdir -p /tmp/hl-demo && cd /tmp/hl-demo
 *   npm init -y && npm i playwright && npx playwright install chromium
 *   cd <repo> && npm run dev
 *   NODE_PATH=/tmp/hl-demo/node_modules node tools/demo/record.cjs --rehearse
 *   NODE_PATH=/tmp/hl-demo/node_modules node tools/demo/record.cjs
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:5273';
const OUT_DIR = process.env.DEMO_OUT || path.join(__dirname, 'out');
const OUTPUT = 'hookline-demo.webm';
const REHEARSE = process.argv.includes('--rehearse');

/**
 * SwiftShader gives headless Chromium a real WebGL stack. Without it the
 * attention terrain — the entire visual argument of the landing page — records
 * as a black rectangle.
 */
const LAUNCH_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--force-device-scale-factor=1',
];

// ── Overlays ───────────────────────────────────────────────────────────────

async function injectCursor(page) {
  await page.evaluate(() => {
    if (document.getElementById('demo-cursor')) return;
    const c = document.createElement('div');
    c.id = 'demo-cursor';
    c.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M5 3L19 12L12 13L9 20L5 3Z" fill="#fff" stroke="#06070A" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
    c.style.cssText = `position:fixed;z-index:2147483647;pointer-events:none;width:22px;height:22px;
      left:0;top:0;transition:left .09s linear,top .09s linear;
      filter:drop-shadow(0 2px 4px rgba(0,0,0,.6))`;
    document.body.appendChild(c);
    document.addEventListener('mousemove', (e) => {
      c.style.left = e.clientX + 'px';
      c.style.top = e.clientY + 'px';
    });
  });
}

/** Captions in the product's own type and palette, not a generic black bar. */
async function injectSubtitle(page) {
  await page.evaluate(() => {
    if (document.getElementById('demo-sub')) return;
    const wrap = document.createElement('div');
    wrap.id = 'demo-sub';
    wrap.style.cssText = `position:fixed;left:0;right:0;bottom:0;z-index:2147483646;pointer-events:none;
      display:flex;justify-content:center;padding:0 0 34px;
      background:linear-gradient(to top,rgba(6,7,10,.94),rgba(6,7,10,.72) 46%,transparent);
      padding-top:80px;opacity:0;transition:opacity .32s cubic-bezier(.16,1,.3,1)`;
    const inner = document.createElement('div');
    inner.id = 'demo-sub-text';
    inner.style.cssText = `font-family:'Inter Tight Variable',system-ui,sans-serif;font-size:19px;font-weight:500;
      letter-spacing:-.01em;color:#E8EDF4;text-align:center;max-width:60ch;line-height:1.45;
      text-shadow:0 2px 12px rgba(6,7,10,.9)`;
    wrap.appendChild(inner);
    document.body.appendChild(wrap);
  });
}

async function say(page, text, hold = 0) {
  await page.evaluate((t) => {
    const w = document.getElementById('demo-sub');
    const i = document.getElementById('demo-sub-text');
    if (!w || !i) return;
    if (t) { i.textContent = t; w.style.opacity = '1'; } else { w.style.opacity = '0'; }
  }, text);
  if (text) await page.waitForTimeout(420 + hold);
}

async function dress(page) {
  await injectCursor(page);
  await injectSubtitle(page);
}

// ── Interaction helpers ────────────────────────────────────────────────────

async function ensureVisible(page, selector, label) {
  const el = page.locator(selector).first();
  const ok = await el.isVisible().catch(() => false);
  if (!ok) {
    console.error(`REHEARSAL FAIL: "${label}" — ${selector}`);
    const found = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button,input,textarea,a,[role="tab"]'))
        .filter((e) => e.offsetParent !== null)
        .map((e) => `${e.tagName}.${(typeof e.className === 'string' ? e.className : '').split(' ')[0]} "${(e.textContent || '').trim().slice(0, 30)}"`)
        .join('\n    '));
    console.error('  visible now:\n    ' + found);
    return false;
  }
  console.log(`REHEARSAL OK: ${label}`);
  return true;
}

async function moveAndClick(page, selector, label, postDelay = 900) {
  const el = page.locator(selector).first();
  if (!(await el.isVisible().catch(() => false))) {
    console.error(`WARN: skipped click — "${label}" not visible (${selector})`);
    return false;
  }
  try {
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(320);
    const box = await el.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 14 });
      await page.waitForTimeout(380);
    }
    await el.click();
  } catch (e) {
    console.error(`WARN: click failed on "${label}": ${e.message}`);
    return false;
  }
  await page.waitForTimeout(postDelay);
  return true;
}

async function hover(page, selector, ms = 500) {
  const el = page.locator(selector).first();
  if (!(await el.isVisible().catch(() => false))) return;
  const box = await el.boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
  await page.waitForTimeout(ms);
}

async function scrollTo(page, selector, offset = -90, settle = 1500) {
  await page.evaluate(([s, o]) => {
    const el = document.querySelector(s);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY + o, behavior: 'smooth' });
  }, [selector, offset]);
  await page.waitForTimeout(settle);
}

// ── Flow ───────────────────────────────────────────────────────────────────

const TABS = {
  copy: '[role="tab"]:has-text("Copy")',
  captions: '[role="tab"]:has-text("Captions")',
  thumbnail: '[role="tab"]:has-text("Thumbnail")',
  signals: '[role="tab"]:has-text("Signals")',
};

async function rehearse(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  let ok = true;
  const check = async (sel, label) => { if (!(await ensureVisible(page, sel, label))) ok = false; };

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await check('.masthead .logo', 'masthead logo');
  await check('button:has-text("Analyse a transcript")', 'hero CTA');
  await check('.readout__row', 'signals readout');
  await check('.cohesion', 'cohesion figure');
  await check('.showcase', 'output showcase');

  await moveAndClick(page, 'button:has-text("Analyse a transcript")', 'enter workspace', 1200);
  await check('.drop__area', 'transcript textarea');
  await check('button:has-text("Load SRT sample")', 'load sample');
  await check('button:has-text("Analyse recording")', 'analyse button');

  await page.locator('button:has-text("Load SRT sample")').click();
  await page.waitForTimeout(500);
  await page.locator('button:has-text("Analyse recording")').click();
  await page.waitForTimeout(5000);

  await check('.strip__svg', 'attention curve');
  await check('.cliplist__item', 'clip list');
  await check('.detail__hook', 'clip hook');
  for (const [name, sel] of Object.entries(TABS)) await check(sel, `tab: ${name}`);
  await check('.panels__tab:has-text("Chapters")', 'chapters panel tab');
  await check('.panels__tab:has-text("Schedule")', 'schedule panel tab');
  await check('.panels__tab:has-text("Export")', 'export panel tab');

  await page.close();
  return ok;
}

async function record(page) {
  // ── Act 1: the claim ────────────────────────────────────────────────────
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await dress(page);
  await page.waitForTimeout(2600); // let the terrain build

  await say(page, 'Every recording has an attention curve.', 2100);
  await page.mouse.move(700, 380, { steps: 26 });
  await page.waitForTimeout(900);
  await say(page, 'HOOKLINE measures it — in your browser, with no API key.', 2400);
  await say(page, '');

  // ── Act 2: the mechanism ────────────────────────────────────────────────
  await scrollTo(page, '#measurement', -60, 1700);
  await say(page, 'Eight linguistic signals, scored on every sentence.', 1900);
  await hover(page, '.readout__row:nth-child(1)', 620);
  await hover(page, '.readout__row:nth-child(5)', 620);
  await say(page, '');

  await scrollTo(page, '.boundaries-section', -60, 1700);
  await say(page, 'Topic boundaries come from lexical cohesion, so clips never end mid-thought.', 2600);
  await say(page, '');

  // ── Act 3: it actually runs ─────────────────────────────────────────────
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await page.waitForTimeout(1300);
  await moveAndClick(page, 'button:has-text("Analyse a transcript")', 'enter workspace', 1400);
  await dress(page);

  await say(page, 'Bring a transcript — SRT, VTT, or plain text.', 1500);
  await moveAndClick(page, 'button:has-text("Load SRT sample")', 'load sample', 1300);
  await say(page, 'A ten-minute podcast episode.', 1400);
  await say(page, '');

  await moveAndClick(page, 'button:has-text("Analyse recording")', 'run analysis', 300);
  await say(page, 'Nothing is uploaded. The whole pipeline runs in this tab.', 2700);
  await say(page, '');
  await page.waitForTimeout(2200);

  // ── Act 4: the output ───────────────────────────────────────────────────
  await scrollTo(page, '.ws__curve', -70, 1500);
  await say(page, 'Six clips, ranked and non-overlapping.', 2000);
  await hover(page, '.strip__handle:nth-child(2)', 700);
  await say(page, '');

  await scrollTo(page, '.panels', -70, 1200);
  await moveAndClick(page, '.cliplist__item:nth-child(1)', 'select clip 2', 1100);
  await say(page, 'Each hook is rewritten from the speaker’s own words.', 2200);
  await say(page, '');

  await moveAndClick(page, TABS.copy, 'copy tab', 900);
  await say(page, 'Titles fitted to every platform’s character limit.', 2400);
  await say(page, '');

  await moveAndClick(page, TABS.captions, 'captions tab', 900);
  await say(page, 'Captions timed to the word, wrapped for a vertical safe area.', 2500);
  await say(page, '');

  await moveAndClick(page, TABS.thumbnail, 'thumbnail tab', 1000);
  await say(page, 'A 9:16 thumbnail layout, with the frame to grab.', 2300);
  await say(page, '');

  await moveAndClick(page, TABS.signals, 'signals tab', 1000);
  await say(page, 'And every score is inspectable — no black box.', 2400);
  await say(page, '');

  // ── Act 5: the week ─────────────────────────────────────────────────────
  await scrollTo(page, '.panels', -70, 900);
  await moveAndClick(page, '.panels__tab:has-text("Chapters")', 'chapters', 1100);
  await say(page, 'Chapters for the source video, from the same boundaries.', 2300);
  await say(page, '');

  await moveAndClick(page, '.panels__tab:has-text("Schedule")', 'schedule', 1100);
  await say(page, 'A week of posts — each slot says why it landed there.', 2400);
  await say(page, '');

  await moveAndClick(page, '.panels__tab:has-text("Export")', 'export', 1100);
  await say(page, 'Then take the whole package out.', 2100);
  await say(page, '');

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await page.waitForTimeout(1400);
  await say(page, 'HOOKLINE — one recording in, a publishable week out.', 3000);
  await say(page, '');
  await page.waitForTimeout(900);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });

  if (REHEARSE) {
    const ok = await rehearse(browser);
    await browser.close();
    console.log(ok ? '\nREHEARSAL PASSED' : '\nREHEARSAL FAILED — fix selectors before recording');
    process.exit(ok ? 0 : 1);
  }

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: OUT_DIR, size: { width: 1280, height: 720 } },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  try {
    await record(page);
  } catch (err) {
    console.error('DEMO ERROR:', err.message);
  } finally {
    await context.close();
    const video = page.video();
    if (video) {
      const src = await video.path();
      const dest = path.join(OUT_DIR, OUTPUT);
      fs.copyFileSync(src, dest);
      fs.unlinkSync(src);
      console.log('video:', dest, `(${(fs.statSync(dest).size / 1e6).toFixed(1)} MB)`);
    }
    await browser.close();
  }
})();
