import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadMigrations, lintMigrations } from '../scripts/migrations-lib.mjs';

const build = env => execFileSync('node', ['scripts/build.mjs'], { env: { ...process.env, ...env }, encoding: 'utf8' });
const pk = 'pk_test_' + Buffer.from('demo.clerk.accounts.dev$').toString('base64');

describe('build and security headers', () => {
  it('staging is noindex; production is indexable and has a strict CSP', () => {
    build({ APP_ENV: 'staging', CLERK_PUBLISHABLE_KEY: pk });
    let headers = readFileSync('dist/_headers', 'utf8');
    expect(headers).toContain('X-Robots-Tag: noindex');
    expect(readFileSync('dist/robots.txt', 'utf8')).toContain('Disallow: /');
    build({ APP_ENV: 'production', CLERK_PUBLISHABLE_KEY: pk });
    headers = readFileSync('dist/_headers', 'utf8');
    expect(headers).not.toContain('X-Robots-Tag');
    for (const h of ['Content-Security-Policy', 'Strict-Transport-Security', 'X-Content-Type-Options: nosniff', 'Permissions-Policy', 'frame-ancestors \'none\'', "object-src 'none'"]) expect(headers).toContain(h);
    expect(headers).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(headers).toContain('https://demo.clerk.accounts.dev');
  });
  it('the game page keeps working under the CSP (its inline script is hashed)', () => {
    build({ APP_ENV: 'production', CLERK_PUBLISHABLE_KEY: pk });
    expect(readFileSync('dist/_headers', 'utf8')).toMatch(/'sha256-[A-Za-z0-9+/=]+'/);
    expect(readFileSync('dist/parents/index.html', 'utf8')).not.toContain('%%');
  });
  it('migrations are expand-only', () => {
    expect(lintMigrations(loadMigrations())).toEqual([]);
    expect(lintMigrations([{ file: '0009_x.sql', sql: 'ALTER TABLE a DROP COLUMN b;' }])[0]).toMatch(/contract/);
    expect(lintMigrations([{ file: '0009_x.sql', sql: '-- contract: b unused since v1.4\nALTER TABLE a DROP COLUMN b;' }])).toEqual([]);
  });
});
