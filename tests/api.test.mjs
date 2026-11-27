import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startStack, call } from './helpers.mjs';
import { flushQueue, weeklyRollup, enforceRetention, reconcileRevocations } from '../src/jobs.mjs';
import { blobStores } from '../src/queue.mjs';
import { handleClerkEvent } from '../src/webhook.mjs';

let S;
const A = 'user_parentA', B = 'user_parentB';
const ctx = {};

beforeAll(async () => { S = await startStack(); });
afterAll(async () => { await S?.stop(); });

const round = (childId, startedAt, items) => ({
  id: randomUUID(), childId, startedAt, endedAt: new Date(Date.parse(startedAt) + 240_000).toISOString(),
  bridge: 'london', ageBand: 'masters', stars: 3, items,
});

describe('family set-up', () => {
  it('signed-out callers are refused', async () => {
    expect((await call(S.app, 'GET', '/api/me')).status).toBe(401);
  });
  it('a parent creates a family; core play is recorded, everything else is off', async () => {
    const r = await call(S.app, 'POST', '/api/family', { user: A, body: { country: 'gb' } });
    expect(r.status).toBe(201);
    expect(r.body.rules).toBe('uk');
    ctx.familyA = r.body.familyId;
    expect(S.clerkCalls.find(c => c[0] === 'meta')[2].publicMetadata.familyId).toBe(ctx.familyA);
    const me = await call(S.app, 'GET', '/api/me', { user: A });
    expect(me.body.consents.family).toEqual({ core: true });
  });
  it('adds children with an avatar and a curated game name; free text names are refused', async () => {
    const names = (await call(S.app, 'GET', '/api/game-names?n=3')).body.suggestions;
    const r = await call(S.app, 'POST', '/api/children', { user: A, body: { avatarId: 'amira', ageBand: 'masters', gameNameCode: names[0].code, displayMode: 'first_name', firstName: 'Zara' } });
    expect(r.status).toBe(201);
    expect(r.body.child.familyLabel).toBe('Zara');
    ctx.childA = r.body.child.id;
    const little = await call(S.app, 'POST', '/api/children', { user: A, body: { avatarId: 'owl', ageBand: 'little', gameNameCode: names[1].code } });
    ctx.littleA = little.body.child.id;
    const bad = await call(S.app, 'POST', '/api/children', { user: A, body: { avatarId: 'ada', ageBand: 'masters', gameNameCode: 'Cool Kid 99' } });
    expect(bad.status).toBe(422);
  });
  it('family B is isolated from family A', async () => {
    await call(S.app, 'POST', '/api/family', { user: B, body: { country: 'NG' } });
    const r = await call(S.app, 'PATCH', `/api/children/${ctx.childA}`, { user: B, body: { avatarId: 'fox' } });
    expect(r.status).toBe(404);
    const del = await call(S.app, 'DELETE', `/api/children/${ctx.childA}`, { user: B });
    expect(del.status).toBe(404);
  });
  it('row-level security blocks a query that forgets its WHERE clause', async () => {
    const famB = (await call(S.app, 'GET', '/api/me', { user: B })).body.family.id;
    const n = await S.db.withFamily(famB, async c => (await c.query('SELECT count(*)::int AS n FROM children')).rows[0].n);
    expect(n).toBe(0);
    await expect(S.db.withFamily(famB, c => c.query(`INSERT INTO children (family_id, avatar_id, age_band, game_name_code) VALUES ($1,'fox','masters','1-1-11')`, [ctx.familyA]))).rejects.toThrow(/row-level security/);
    await expect(S.db.withFamily(famB, c => c.query('DELETE FROM audit_log'))).rejects.toThrow(/permission denied/);
  });
});

describe('consent', () => {
  it('leagues need backup first, then a fresh sign-in', async () => {
    let r = await call(S.app, 'POST', '/api/consents', { user: A, fva: 2, body: { purpose: 'public_leagues', granted: true } });
    expect(r.body.error).toBe('needs_cloud_sync');
    r = await call(S.app, 'POST', '/api/consents', { user: A, body: { purpose: 'cloud_sync', granted: true } });
    expect(r.status).toBe(201); expect(r.body.method).toBe('verified_email_session');
    r = await call(S.app, 'POST', '/api/consents', { user: A, fva: 45, body: { purpose: 'public_leagues', granted: true } });
    expect(r.status).toBe(403); expect(r.body.clerk_error.reason).toBe('reverification-error');
    r = await call(S.app, 'POST', '/api/consents', { user: A, fva: 2, body: { purpose: 'public_leagues', granted: true, childId: ctx.childA } });
    expect(r.status).toBe(201); expect(r.body.method).toBe('reverified_session');
  });
  it('the 3-5 band cannot be entered into leagues', async () => {
    const r = await call(S.app, 'POST', '/api/consents', { user: A, fva: 2, body: { purpose: 'public_leagues', granted: true, childId: ctx.littleA } });
    expect(r.body.error).toBe('not_for_age');
  });
  it('support impersonation cannot change consent', async () => {
    const r = await call(S.app, 'POST', '/api/consents', { user: A, actor: true, body: { purpose: 'product_emails', granted: true } });
    expect(r.status).toBe(403);
  });
  it('receipts are append-only', async () => {
    await expect(S.db.withSystem(c => c.query('UPDATE consents SET granted = false'))).rejects.toThrow(/append-only/);
  });
});

describe('sync, history and leagues', () => {
  it('a paired device syncs without waking the database, then the flush saves it', async () => {
    const d = await call(S.app, 'POST', '/api/devices', { user: A, body: { label: 'Kitchen tablet' } });
    expect(d.status).toBe(201);
    ctx.device = d.body.token; ctx.deviceId = d.body.device.id;
    const now = Date.now();
    const s1 = round(ctx.childA, new Date(now - 3 * 3600_000).toISOString(), [
      { a: 7, b: 8, ok: true, firstTry: true, ms: 2400, help: 0 },
      { a: 6, b: 7, ok: false, firstTry: true, ms: 5200, help: 1 },
      { a: 6, b: 7, ok: true, firstTry: false, ms: 3100, help: 2 },
    ]);
    const r = await call(S.app, 'POST', '/api/sync', { device: ctx.device, body: { sessions: [s1, s1] } });
    expect(r.status).toBe(202);
    const hist = await call(S.app, 'GET', `/api/history?child=${ctx.childA}`, { user: A });
    expect(hist.body.pending.length).toBe(1);
    expect(hist.body.sessions.length).toBe(0);
    const stats = await flushQueue({ db: S.db, stores: S.stores });
    expect(stats.saved).toBe(1);
    const again = await call(S.app, 'GET', `/api/history?child=${ctx.childA}`, { user: A });
    expect(again.body.pending.length).toBe(0);
    expect(again.body.sessions[0].learning_points).toBe(3);
    expect(again.body.facts.find(f => f.a === 7 && f.b === 8).box).toBe(1);
  });
  it('rounds for another family\'s child are dropped at flush', async () => {
    const famB = (await call(S.app, 'GET', '/api/me', { user: B })).body.family.id;
    await S.stores.enqueue(famB, null, round(ctx.childA, new Date().toISOString(), [{ a: 2, b: 2, ok: true, firstTry: true, ms: 900, help: 0 }]));
    const stats = await flushQueue({ db: S.db, stores: S.stores });
    expect(stats.dropped).toBe(1);
  });
  it('the weekly rollup builds a league; boards show game names only', async () => {
    const nextMonday = new Date(Date.parse((await import('../src/scoring.mjs')).weekOf(new Date())) + 7 * 86400_000 + 3600_000);
    const out = await weeklyRollup({ db: S.db, stores: S.stores, now: nextMonday });
    expect(out.children).toBe(1); expect(out.leagues).toBe(1);
    const lg = await call(S.app, 'GET', `/api/leaderboards?child=${ctx.childA}`, { device: ctx.device });
    expect(lg.body.optedIn).toBe(true);
    expect(lg.body.league.entries[0]).toMatchObject({ rank: 1, you: true, avatar: 'amira' });
    expect(JSON.stringify(lg.body)).not.toContain('Zara');
    expect(JSON.stringify(lg.body)).not.toContain(ctx.childA);
    const world = await call(S.app, 'GET', `/api/leaderboards?child=${ctx.childA}&scope=global&band=masters`, { device: ctx.device });
    expect(world.body.entries.length).toBe(1);
    expect(Object.keys(world.body.entries[0]).sort()).toEqual(['avatar', 'name', 'points', 'rank']);
    const gb = await call(S.app, 'GET', `/api/leaderboards?child=${ctx.childA}&scope=country&country=GB&band=masters`, { device: ctx.device });
    expect(gb.body.entries.length).toBe(1);
    const fam = await call(S.app, 'GET', '/api/leaderboards/family', { user: A });
    expect(fam.body.entries.map(e => e.familyLabel)).toContain('Zara');
    expect((await weeklyRollup({ db: S.db, stores: S.stores, now: nextMonday })).skipped).toBe(true);
    // Another family cannot read this child's league, even knowing the child id.
    const other = await call(S.app, 'GET', `/api/leaderboards?child=${ctx.childA}`, { user: B });
    expect(other.body.optedIn).toBe(false);
    expect(JSON.stringify(other.body)).not.toContain('amira');
  });
  it('removing a device stops it syncing but keeps rounds it already sent', async () => {
    const played = round(ctx.childA, new Date(Date.now() - 3600_000).toISOString(), [{ a: 3, b: 4, ok: true, firstTry: true, ms: 2100, help: 0 }]);
    expect((await call(S.app, 'POST', '/api/sync', { device: ctx.device, body: { sessions: [played] } })).status).toBe(202);
    await new Promise(r => setTimeout(r, 5));
    await call(S.app, 'DELETE', `/api/devices/${ctx.deviceId}`, { user: A });
    const r = await call(S.app, 'POST', '/api/sync', { device: ctx.device, body: { sessions: [round(ctx.childA, new Date().toISOString(), [{ a: 2, b: 5, ok: true, firstTry: true, ms: 900, help: 0 }])] } });
    expect(r.body.error).toBe('device_revoked');
    // Something slipped into the queue for that device after it was removed: not saved.
    await new Promise(r => setTimeout(r, 5));
    const famA = (await call(S.app, 'GET', '/api/me', { user: A })).body.family.id;
    await S.stores.enqueue(famA, ctx.deviceId, round(ctx.childA, new Date().toISOString(), [{ a: 2, b: 6, ok: true, firstTry: true, ms: 900, help: 0 }]));
    const stats = await flushQueue({ db: S.db, stores: S.stores });
    expect(stats).toMatchObject({ saved: 1, dropped: 1 });
  });
  it('a removal lost from storage is put back from the database', async () => {
    const fresh = blobStores((await import('../src/queue.mjs')).memoryStoreFactory(), 'test'); // e.g. after a region move
    expect(await fresh.isRevoked(ctx.deviceId)).toBe(false);
    const out = await reconcileRevocations({ db: S.db, stores: fresh });
    expect(out.fixed).toBeGreaterThanOrEqual(1);
    expect(await fresh.isRevoked(ctx.deviceId)).toBe(true);
    expect((await reconcileRevocations({ db: S.db, stores: fresh })).fixed).toBe(0);
  });
  it('every store is opened in Frankfurt', () => {
    const seen = [];
    blobStores(o => { seen.push(o.region); return {}; }, 'production');
    expect(seen).toEqual(['eu-central-1', 'eu-central-1', 'eu-central-1']);
  });
  it('bad numbers and broken links in requests are handled, not crashed on', async () => {
    expect((await call(S.app, 'GET', `/api/history?child=${ctx.childA}&limit=abc`, { user: A })).status).toBe(200);
    expect((await call(S.app, 'GET', '/api/game-names?n=lots')).body.suggestions.length).toBe(3);
    expect((await call(S.app, 'DELETE', '/api/devices/%E0%A4%A', { user: A })).status).toBe(404);
    expect((await call(S.app, 'GET', `/api/leaderboards?child=${ctx.childA}&scope=weird`, { user: A })).status).toBe(422);
  });
});

describe('rights', () => {
  it('export includes the whole family record', async () => {
    const r = await call(S.app, 'GET', '/api/export', { user: A });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.headers.get('content-disposition')).toContain('attachment');
    expect(r.body.children.length).toBe(2);
    expect(r.body.sessions.length).toBe(2);
    expect(r.body.consents.length).toBeGreaterThanOrEqual(3);
  });
  it('complaints are logged with a 30-day acknowledgement date', async () => {
    const r = await call(S.app, 'POST', '/api/complaints', { user: A, body: { category: 'privacy', message: 'Please explain the backup.' } });
    expect(r.status).toBe(201); expect(r.body.acknowledgeBy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.body.regulator).toContain('ICO'); // family A is in the UK
    const me = await call(S.app, 'GET', '/api/me', { user: A });
    expect(me.body.complaints).toMatchObject({ ackDays: 30 });
  });
  it('deleting the account needs a fresh sign-in, then erases everything', async () => {
    expect((await call(S.app, 'DELETE', '/api/account', { user: A, fva: 40 })).status).toBe(403);
    const r = await call(S.app, 'DELETE', '/api/account', { user: A, fva: 1 });
    expect(r.body.erased).toBe(true);
    const left = await S.db.withSystem(async c => (await c.query('SELECT (SELECT count(*) FROM children WHERE family_id = $1)::int + (SELECT count(*) FROM sessions WHERE family_id = $1)::int + (SELECT count(*) FROM consents WHERE family_id = $1)::int AS n', [ctx.familyA])).rows[0].n);
    expect(left).toBe(0);
    const latest = await S.stores.getBoard('latest.json');
    const world = await S.stores.getBoard(`${latest.week}/global-all-masters.json`);
    expect(world.entries.length).toBe(0);
    expect(await S.stores.getBoard(`${latest.week}/league-of/${ctx.familyA}/${ctx.childA}.json`)).toBe(null);
    expect(S.clerkCalls.some(c => c[0] === 'delete' && c[1] === A)).toBe(true);
    expect((await call(S.app, 'GET', '/api/me', { user: A })).body.family).toBe(null);
  });
  it('Clerk user.deleted erases a family too (idempotent)', async () => {
    const r = await handleClerkEvent({ type: 'user.deleted', data: { id: B } }, { db: S.db, stores: S.stores });
    expect(r.erased).toBe(true);
    const r2 = await handleClerkEvent({ type: 'user.deleted', data: { id: B } }, { db: S.db, stores: S.stores });
    expect(r2.erased).toBe(false);
  });
  it('retention runs cleanly', async () => {
    const out = await enforceRetention({ db: S.db, stores: S.stores });
    expect(out.inactiveFamilies).toEqual([]);
  });
});

describe('health', () => {
  it('shallow health needs no database; deep health needs the key and proves isolation', async () => {
    expect((await call(S.app, 'GET', '/api/health')).body.ok).toBe(true);
    expect((await call(S.app, 'GET', '/api/health?deep=1')).status).toBe(403);
    const r = await S.app(new Request('https://app.test/api/health?deep=1', { headers: { 'x-health-key': 'hk' } }));
    const b = await r.json();
    expect(b.db.latestMigration).toBe('0004_row_security');
    expect(b.db.rlsIsolated).toBe(true);
  });
  it('unknown routes 404 and wrong methods 405', async () => {
    expect((await call(S.app, 'GET', '/api/nope')).status).toBe(404);
    expect((await call(S.app, 'PUT', '/api/me', { user: A })).status).toBe(405);
  });
});
