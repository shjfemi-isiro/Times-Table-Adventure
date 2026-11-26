import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMigrations, lintMigrations } from '../scripts/migrations-lib.mjs';

// Build into a throwaway folder so tests never leave a stale dist/ behind for a deploy.
const OUT = mkdtempSync(join(tmpdir(), 'tta-build-'));
const build = env => execFileSync('node', ['scripts/build.mjs'], { env: { ...process.env, ...env, BUILD_OUT: OUT }, encoding: 'utf8' });
const read = f => readFileSync(join(OUT, f), 'utf8');
const pk = 'pk_test_' + Buffer.from('demo.clerk.accounts.dev$').toString('base64');

describe('build and security headers', () => {
  it('staging is noindex; production is indexable and has a strict CSP', () => {
    build({ APP_ENV: 'staging', CLERK_PUBLISHABLE_KEY: pk });
    let headers = read('_headers');
    expect(headers).toContain('X-Robots-Tag: noindex');
    expect(read('robots.txt')).toContain('Disallow: /');
    build({ APP_ENV: 'production', CLERK_PUBLISHABLE_KEY: pk });
    headers = read('_headers');
    expect(headers).not.toContain('X-Robots-Tag');
    for (const h of ['Content-Security-Policy', 'Strict-Transport-Security', 'X-Content-Type-Options: nosniff', 'Permissions-Policy', 'frame-ancestors \'none\'', "object-src 'none'"]) expect(headers).toContain(h);
    expect(headers).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(headers).toContain('https://demo.clerk.accounts.dev');
    expect(headers).toMatch(/script-src[^;]*https:\/\/\*\.protect\.clerk\.com/);
    expect(headers).toMatch(/connect-src[^;]*https:\/\/\*\.protect\.clerk\.com:\*/);
    expect(headers).toMatch(/frame-src[^;]*https:\/\/\*\.protect\.clerk\.com/);
  });
  it('the game page keeps working under the CSP (its inline script is hashed)', () => {
    build({ APP_ENV: 'production', CLERK_PUBLISHABLE_KEY: pk });
    expect(read('_headers')).toMatch(/'sha256-[A-Za-z0-9+/=]+'/);
    expect(read('parents/index.html')).not.toContain('%%');
  });
  it('migrations are expand-only', () => {
    expect(lintMigrations(loadMigrations())).toEqual([]);
    expect(lintMigrations([{ file: '0009_x.sql', sql: 'ALTER TABLE a DROP COLUMN b;' }])[0]).toMatch(/contract/);
    expect(lintMigrations([{ file: '0009_x.sql', sql: '-- contract: b unused since v1.4\nALTER TABLE a DROP COLUMN b;' }])).toEqual([]);
  });
});
