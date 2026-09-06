'use strict';
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:5273';

const dump = () => Array.from(
  document.querySelectorAll('input, select, textarea, button, [contenteditable], [role="tab"], a')
).filter((el) => el.offsetParent !== null).map((el) => ({
  tag: el.tagName,
  type: el.type || '',
  cls: (typeof el.className === 'string' ? el.className : '').slice(0, 42),
  text: (el.textContent || '').trim().slice(0, 46),
  placeholder: el.placeholder ? el.placeholder.slice(0, 40) : '',
}));

(async () => {
  // SwiftShader gives headless Chromium a working WebGL stack; without it the
  // terrain — the whole visual point of the landing page — records as black.
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);

  const gl = await page.evaluate(() => {
    const c = document.querySelector('.hero__canvas canvas');
    return c ? { w: c.width, h: c.height, ok: c.width > 400 } : { ok: false };
  });
  console.log('WEBGL CANVAS:', JSON.stringify(gl));

  console.log('\n=== LANDING ===');
  console.log(JSON.stringify(await page.evaluate(dump), null, 1));

  await page.goto(`${BASE}/#workspace`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  console.log('\n=== WORKSPACE (empty) ===');
  console.log(JSON.stringify(await page.evaluate(dump), null, 1));

  await page.locator('button:has-text("Load SRT sample")').click();
  await page.waitForTimeout(600);
  await page.locator('button:has-text("Analyse recording")').click();
  await page.waitForTimeout(5000);
  console.log('\n=== WORKSPACE (results) ===');
  console.log(JSON.stringify(await page.evaluate(dump), null, 1));

  await browser.close();
})();
