#!/usr/bin/env node
// Verifies security headers on a deployed site. Usage: BASE_URL=... EXPECT_ENV=production node scripts/check-headers.mjs
const base = (process.env.BASE_URL || process.argv[2] || '').replace(/\/$/, '');
const env = process.env.EXPECT_ENV || 'production';
const r = await fetch(base + '/', { redirect: 'manual' });
const h = k => r.headers.get(k) || '';
const problems = [];
const need = (k, test, why) => { if (!test(h(k))) problems.push(`${k}: ${why} (got "${h(k).slice(0, 120)}")`); };
need('content-security-policy', v => v.includes("default-src 'self'") && v.includes("frame-ancestors 'none'") && v.includes("object-src 'none'"), 'strict CSP expected');
need('content-security-policy', v => !/script-src[^;]*'unsafe-inline'/.test(v) && !/script-src[^;]*'unsafe-eval'/.test(v), 'no unsafe script sources');
need('strict-transport-security', v => /max-age=\d{7,}/.test(v), 'HSTS of at least ~4 months');
need('x-content-type-options', v => v === 'nosniff', 'nosniff');
need('referrer-policy', v => /strict-origin|no-referrer/.test(v), 'privacy-preserving referrer policy');
need('permissions-policy', v => v.includes('camera=()') && v.includes('microphone=()') && v.includes('geolocation=()'), 'camera, microphone, geolocation off');
need('x-frame-options', v => v === 'DENY', 'DENY');
if (env === 'production') need('x-robots-tag', v => !v.includes('noindex'), 'production must be indexable');
else need('x-robots-tag', v => v.includes('noindex'), 'non-production must be noindex');
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log(`Security headers OK for ${base} (${env}).`);
