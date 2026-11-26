#!/usr/bin/env node
// Copies public/ to dist/, injects public Clerk settings, and writes dist/_headers
// with a strict Content Security Policy built from the inline script hashes.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, extname } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const out = process.env.BUILD_OUT || join(root, 'dist');
const appEnv = process.env.APP_ENV || 'development';
const pk = process.env.CLERK_PUBLISHABLE_KEY || '';

export function frontendApiFromKey(key) {
  const m = /^pk_(test|live)_(.+)$/.exec(key || '');
  if (!m) return '';
  return Buffer.from(m[2], 'base64').toString('utf8').replace(/\$$/, '');
}
const frontendApi = process.env.CLERK_FRONTEND_API || frontendApiFromKey(pk);

if (appEnv === 'production' && !pk.startsWith('pk_live_')) {
  console.warn('WARNING: production build without a pk_live_ Clerk key (Clerk production instance needs a custom domain).');
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, 'public'), out, { recursive: true });

const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const scriptHashes = new Set();
for (const file of walk(out).filter(f => extname(f) === '.html')) {
  let html = readFileSync(file, 'utf8')
    .replaceAll('%%CLERK_PUBLISHABLE_KEY%%', pk)
    .replaceAll('%%CLERK_FRONTEND_API%%', frontendApi)
    .replaceAll('%%APP_ENV%%', appEnv);
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (m[1].trim()) scriptHashes.add(`'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
  }
  writeFileSync(file, html);
}

const clerk = frontendApi ? `https://${frontendApi}` : '';
const csp = [
  "default-src 'self'",
  `script-src 'self' ${[...scriptHashes].join(' ')} ${clerk} https://challenges.cloudflare.com`.replace(/\s+/g, ' ').trim(),
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  `img-src 'self' data: https://img.clerk.com`,
  `connect-src 'self' ${clerk} https://clerk-telemetry.com`.trim(),
  "worker-src 'self' blob:",
  "frame-src https://challenges.cloudflare.com",
  "media-src 'self' blob: data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ');

const common = [
  `  Content-Security-Policy: ${csp}`,
  '  Strict-Transport-Security: max-age=63072000; includeSubDomains',
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: strict-origin-when-cross-origin',
  '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  '  Cross-Origin-Opener-Policy: same-origin',
  '  Cross-Origin-Resource-Policy: same-origin',
  '  X-Frame-Options: DENY',
];
if (appEnv !== 'production') common.push('  X-Robots-Tag: noindex, nofollow');
const headers = ['/*', ...common, '', '/*.html', '  Cache-Control: public, max-age=0, must-revalidate', ''].join('\n');
writeFileSync(join(out, '_headers'), headers);
writeFileSync(join(out, 'robots.txt'), appEnv === 'production' ? 'User-agent: *\nAllow: /\nDisallow: /parents/\nDisallow: /api/\n' : 'User-agent: *\nDisallow: /\n');
writeFileSync(join(out, 'version.json'), JSON.stringify({ env: appEnv, commit: (process.env.COMMIT_REF || process.env.GITHUB_SHA || 'dev').slice(0, 12), builtAt: new Date().toISOString() }));
console.log(`Built dist/ for ${appEnv}: ${walk(out).length} files, ${scriptHashes.size} inline script hash(es), Clerk ${frontendApi || 'not configured'}.`);
