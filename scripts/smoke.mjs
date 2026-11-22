#!/usr/bin/env node
// Smoke test a deployed site. Usage: BASE_URL=https://... EXPECT_ENV=staging [EXPECT_COMMIT=abc] [HEALTH_KEY=...] node scripts/smoke.mjs
const base = (process.env.BASE_URL || process.argv[2] || '').replace(/\/$/, '');
if (!base) { console.error('Set BASE_URL'); process.exit(2); }
const checks = [];
const check = async (name, fn) => {
  try { await fn(); checks.push([name, 'ok']); }
  catch (e) { checks.push([name, `FAIL ${e.message}`]); }
};
const get = (p, init) => fetch(base + p, { redirect: 'manual', ...init });
const assert = (c, m) => { if (!c) throw new Error(m); };

await check('game page loads', async () => {
  const r = await get('/'); assert(r.status === 200, `status ${r.status}`);
  const t = await r.text(); assert(t.includes('Times Table Adventure'), 'title missing');
});
await check('grown-ups page loads', async () => { const r = await get('/parents/'); assert(r.status === 200, `status ${r.status}`); });
await check('privacy page loads', async () => { const r = await get('/privacy/'); assert(r.status === 200, `status ${r.status}`); });
await check('version matches', async () => {
  const v = await (await get('/version.json')).json();
  if (process.env.EXPECT_ENV) assert(v.env === process.env.EXPECT_ENV, `env ${v.env}`);
  if (process.env.EXPECT_COMMIT) assert(process.env.EXPECT_COMMIT.startsWith(v.commit), `commit ${v.commit}`);
});
await check('api health', async () => {
  const r = await get('/api/health'); assert(r.status === 200, `status ${r.status}`);
  const b = await r.json(); assert(b.ok === true, 'not ok');
  assert(r.headers.get('cache-control') === 'no-store', 'api responses must be no-store');
});
if (process.env.HEALTH_KEY) await check('database reachable, migrations applied, isolation holds', async () => {
  const r = await get('/api/health?deep=1', { headers: { 'x-health-key': process.env.HEALTH_KEY } });
  const b = await r.json(); assert(r.status === 200, JSON.stringify(b));
  if (process.env.EXPECT_MIGRATION) assert(b.db.latestMigration === process.env.EXPECT_MIGRATION, `migration ${b.db.latestMigration}`);
  assert(b.db.rlsIsolated === true, 'row-level security not isolating');
});
await check('private endpoints refuse anonymous callers', async () => {
  for (const [m, p] of [['GET', '/api/me'], ['GET', '/api/export'], ['DELETE', '/api/account'], ['GET', '/api/history']]) {
    const r = await get(p, { method: m }); assert(r.status === 401, `${m} ${p} gave ${r.status}`);
  }
  const s = await get('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Device ttd1.forged.sig' }, body: '{"sessions":[]}' });
  assert([401, 422].includes(s.status), `sync with forged token gave ${s.status}`);
});
await check('webhook rejects unsigned calls', async () => {
  const r = await get('/api/clerk-webhook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"type":"user.deleted","data":{"id":"x"}}' });
  assert(r.status === 400, `status ${r.status}`);
});

const failed = checks.filter(c => c[1] !== 'ok');
for (const [n, s] of checks) console.log(`${s === 'ok' ? 'PASS' : 'FAIL'}  ${n}${s === 'ok' ? '' : '  ' + s}`);
process.exit(failed.length ? 1 : 0);
