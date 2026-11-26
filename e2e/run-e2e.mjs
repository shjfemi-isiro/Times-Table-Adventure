#!/usr/bin/env node
// Browser checks against a deployed URL: pages render, no CSP violations or script
// errors, and no serious accessibility issues (axe-core) on the grown-up pages.
// Usage: BASE_URL=https://... node e2e/run-e2e.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const base = (process.env.BASE_URL || process.argv[2] || '').replace(/\/$/, '');
const browser = await chromium.launch();
const failures = [];
try {
  for (const [path, a11y] of [['/', false], ['/privacy/', true], ['/parents/', true]]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('console', m => { if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', e => errors.push(e.message));
    // Clerk's anti-bot service keeps polling, so 'networkidle' never comes: wait for load, then settle.
    const res = await page.goto(base + path, { waitUntil: 'load', timeout: 45_000 });
    await page.waitForTimeout(4000);
    if (!res || res.status() !== 200) failures.push(`${path}: status ${res?.status()}`);
    if (errors.length) failures.push(`${path}: ${errors.slice(0, 3).join(' | ')}`);
    if (path === '/parents/') {
      const err = await page.evaluate(() => document.querySelector('.msg.err')?.textContent || '');
      if (err) failures.push(`${path}: page shows an error: ${err}`);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) failures.push(`${path}: horizontal scroll at phone width`);
    if (a11y) {
      await page.evaluate(axeSource); // evaluated via DevTools, so the page CSP stays on
      // Clerk's development instance (staging only) shows its own orange 'Development mode'
      // label, which fails contrast. Production uses Clerk's live instance, which has no label.
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('#signin *')) {
          const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
          if (own !== 'Development mode') continue;
          // Skip the label and the orange box around it (Clerk's own colours).
          let box = el;
          for (let i = 0; i < 4 && box.parentElement && box.parentElement.id !== 'signin'; i++) box = box.parentElement;
          el.setAttribute('data-axe-skip', '');
          box.querySelectorAll('*').forEach(n => { if (/Development mode/.test(n.textContent)) n.setAttribute('data-axe-skip', ''); });
        }
      });
      const r = await page.evaluate(async () => (await window.axe.run({ exclude: [['[data-axe-skip]']] }, { resultTypes: ['violations'] })).violations
        .filter(v => ['serious', 'critical'].includes(v.impact))
        .map(v => `${v.id} (${v.nodes.length}): ` + v.nodes.slice(0, 3).map(n => `${n.target.join(' ')} ${(n.any[0]?.message || '').slice(0, 160)}`).join(' | ')));
      if (r.length) failures.push(`${path}: accessibility ${r.join(', ')}`);
    }
    await page.close();
  }
} finally { await browser.close(); }
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`Browser checks passed for ${base}.`);
