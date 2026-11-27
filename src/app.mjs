import { createHash, randomUUID } from 'node:crypto';
import { HttpError, json, errorResponse, readJson, parseOrThrow } from './http.mjs';
import { issueDeviceToken, requireRecentSignIn } from './auth.mjs';
import { renderGameName, suggestGameNames } from './gamenames.mjs';
import { AVATARS, CAR_COLORS } from './avatars.mjs';
import { POLICY_VERSION, rulesFor, regulatorFor, STRONG_CONSENT, LEAGUE_BANDS, COMPLAINT_ACK_DAYS, RETENTION, LIMITS } from './policy.mjs';
import { weekOf } from './scoring.mjs';
import { familySchema, childCreateSchema, childUpdateSchema, consentSchema, deviceSchema, syncSchema, complaintSchema } from './validate.mjs';
import { stripRefs } from './leagues.mjs';
import { eraseFamily } from './jobs.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Whole number from a query string, clamped; anything else falls back to the default.
function intParam(value, { min, max, fallback }) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

// What the grown-ups' page needs to explain complaints for this family.
const complaintsInfo = rules => ({ ackDays: COMPLAINT_ACK_DAYS, regulator: regulatorFor(rules) });

function childView(r) {
  return {
    id: r.id,
    avatarId: r.avatar_id,
    ageBand: r.age_band,
    displayMode: r.display_mode,
    firstName: r.first_name,          // family-only; never on public boards
    gameName: renderGameName(r.game_name_code),
    gameNameCode: r.game_name_code,
    carColor: r.car_color,
    // What the family board shows for this child.
    familyLabel: r.display_mode === 'first_name' && r.first_name ? r.first_name
      : r.display_mode === 'game_name' ? renderGameName(r.game_name_code) : null,
  };
}

async function consentMap(c, familyId) {
  const rows = (await c.query('SELECT child_id, purpose, granted FROM consent_state WHERE family_id = $1', [familyId])).rows;
  const family = {}, children = {};
  for (const r of rows) {
    if (r.child_id) (children[r.child_id] ||= {})[r.purpose] = r.granted;
    else family[r.purpose] = r.granted;
  }
  return { family, children };
}

async function audit(c, familyId, actor, action, detail = {}) {
  await c.query('INSERT INTO audit_log (family_id, actor, action, detail) VALUES ($1,$2,$3,$4)', [familyId, actor, action, JSON.stringify(detail)]);
}

/**
 * @param {object} deps  { db, auth, stores, clerk, deviceSecret, context, log }
 */
export function createApp(deps) {
  const { db, auth, stores, log = console } = deps;
  const routes = [];
  const on = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, handler });
  };

  // ---- Health (no database unless asked with the deploy key) -------------------
  on('GET', '/api/health', async ({ req, url }) => {
    const body = { ok: true, env: deps.appEnv, version: deps.version, policy: POLICY_VERSION };
    if (url.searchParams.get('deep') === '1') {
      const key = req.headers.get('x-health-key');
      if (!deps.healthKey || key !== deps.healthKey) throw new HttpError(403, 'forbidden', 'Deep health needs the health key.');
      const r = await db.withSystem(c => c.query(`SELECT max(name) AS latest, count(*)::int AS n FROM schema_migrations`));
      const rls = await db.withFamily(randomUUID(), c => c.query('SELECT count(*)::int AS n FROM families'));
      body.db = { latestMigration: r.rows[0].latest, migrations: r.rows[0].n, rlsIsolated: rls.rows[0].n === 0 };
    }
    return json(body);
  });

  // ---- Reference data (no auth, no database; fresh suggestions each call) --------
  on('GET', '/api/game-names', async ({ url }) => {
    const n = intParam(url.searchParams.get('n'), { min: 1, max: 6, fallback: 3 });
    return json({ suggestions: suggestGameNames(n), avatars: AVATARS, carColors: CAR_COLORS }, 200, { 'cache-control': 'no-store' });
  });

  // ---- Family -----------------------------------------------------------------
  on('GET', '/api/me', async ({ req }) => {
    const who = await auth.parent(req, { needFamily: false });
    if (!who.familyId) return json({ family: null, policyVersion: POLICY_VERSION, suggestedCountry: deps.geoCountry?.(req) || null });
    return db.withFamily(who.familyId, async c => {
      const f = (await c.query('SELECT id, country, rules, created_at FROM families WHERE id = $1', [who.familyId])).rows[0];
      const kids = (await c.query('SELECT * FROM children WHERE family_id = $1 ORDER BY created_at', [who.familyId])).rows.map(childView);
      const devices = (await c.query('SELECT id, label, created_at, last_sync_at FROM devices WHERE family_id = $1 AND revoked_at IS NULL ORDER BY created_at', [who.familyId])).rows;
      return json({ family: f, role: who.family.role, children: kids, consents: await consentMap(c, who.familyId), devices, policyVersion: POLICY_VERSION, complaints: complaintsInfo(f.rules), limits: { players: LIMITS.playersPerFamily, devices: LIMITS.devicesPerFamily } });
    });
  });

  on('POST', '/api/family', async ({ req }) => {
    const who = await auth.parent(req, { needFamily: false });
    const body = parseOrThrow(familySchema, await readJson(req));
    if (who.familyId) {
      await db.withFamily(who.familyId, async c => {
        await c.query('UPDATE families SET country = $2, rules = $3 WHERE id = $1', [who.familyId, body.country, rulesFor(body.country)]);
        await audit(c, who.familyId, who.userId, 'family.country_changed', { country: body.country });
      });
      return json({ familyId: who.familyId, country: body.country, rules: rulesFor(body.country) });
    }
    const familyId = await db.withSystem(async c => {
      const id = (await c.query('INSERT INTO families (owner_user_id, country, rules) VALUES ($1,$2,$3) RETURNING id',
        [who.userId, body.country, rulesFor(body.country)])).rows[0].id;
      await c.query(`INSERT INTO family_members (family_id, user_id, role) VALUES ($1,$2,'owner')`, [id, who.userId]);
      // Core play is always allowed; everything else starts off.
      await c.query(`INSERT INTO consents (family_id, purpose, granted, method, policy_version, actor_user_id, receipt)
                     VALUES ($1,'core',true,'verified_email_session',$2,$3,$4)`, [id, POLICY_VERSION, who.userId, receipt(id, 'core', true)]);
      await audit(c, id, who.userId, 'family.created', { country: body.country });
      return id;
    });
    await deps.clerk?.users.updateUserMetadata(who.userId, { publicMetadata: { familyId, policyVersion: POLICY_VERSION } }).catch(e => log.warn?.('metadata', e.message));
    return json({ familyId, country: body.country, rules: rulesFor(body.country) }, 201);
  });

  // ---- Children ---------------------------------------------------------------
  on('POST', '/api/children', async ({ req }) => {
    const who = await auth.parent(req);
    const b = parseOrThrow(childCreateSchema, await readJson(req));
    const row = await db.withFamily(who.familyId, async c => {
      const n = (await c.query('SELECT count(*)::int AS n FROM children WHERE family_id = $1', [who.familyId])).rows[0].n;
      if (n >= LIMITS.playersPerFamily) throw new HttpError(409, 'too_many_children', `A family can have up to ${LIMITS.playersPerFamily} players.`);
      const r = (await c.query(
        `INSERT INTO children (family_id, avatar_id, age_band, game_name_code, display_mode, first_name, car_color)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [who.familyId, b.avatarId, b.ageBand, b.gameNameCode, b.displayMode, b.firstName || null, b.carColor || null])).rows[0];
      await audit(c, who.familyId, who.userId, 'child.added', { child: r.id });
      return r;
    });
    return json({ child: childView(row) }, 201);
  });

  on('PATCH', '/api/children/:id', async ({ req, params }) => {
    const who = await auth.parent(req);
    if (!UUID.test(params.id)) throw new HttpError(404, 'not_found', 'No such player.');
    const b = parseOrThrow(childUpdateSchema, await readJson(req));
    const cols = { avatarId: 'avatar_id', ageBand: 'age_band', gameNameCode: 'game_name_code', displayMode: 'display_mode', firstName: 'first_name', carColor: 'car_color' };
    const sets = [], vals = [params.id];
    for (const [k, col] of Object.entries(cols)) if (b[k] !== undefined) { vals.push(b[k]); sets.push(`${col} = $${vals.length}`); }
    if (!sets.length) throw new HttpError(422, 'invalid', 'Nothing to change.');
    const row = await db.withFamily(who.familyId, async c => {
      vals.push(who.familyId);
      const r = (await c.query(`UPDATE children SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 AND family_id = $${vals.length} RETURNING *`, vals)).rows[0];
      if (!r) throw new HttpError(404, 'not_found', 'No such player.');
      if (r.display_mode === 'first_name' && !r.first_name) throw new HttpError(422, 'invalid', 'Add a first name or pick another option.');
      await audit(c, who.familyId, who.userId, 'child.updated', { child: r.id, fields: Object.keys(b) });
      return r;
    });
    return json({ child: childView(row) });
  });

  on('DELETE', '/api/children/:id', async ({ req, params }) => {
    const who = await auth.parent(req);
    if (!UUID.test(params.id)) throw new HttpError(404, 'not_found', 'No such player.');
    await db.withFamily(who.familyId, async c => {
      const r = await c.query('DELETE FROM children WHERE id = $1 AND family_id = $2', [params.id, who.familyId]);
      if (!r.rowCount) throw new HttpError(404, 'not_found', 'No such player.');
      await audit(c, who.familyId, who.userId, 'child.deleted', { child: params.id });
    });
    await stores.purgeChildren([params.id]);
    return json({ deleted: true });
  });

  // ---- Consent ----------------------------------------------------------------
  on('POST', '/api/consents', async ({ req }) => {
    const who = await auth.parent(req);
    const b = parseOrThrow(consentSchema, await readJson(req));
    if (b.purpose === 'core') throw new HttpError(422, 'invalid', 'Core play cannot be switched off here; delete the account instead.');
    if (who.impersonated) throw new HttpError(403, 'impersonation_blocked', 'Support sessions cannot change consent.');
    let method = 'verified_email_session';
    if (b.granted && STRONG_CONSENT.has(b.purpose)) { requireRecentSignIn(who); method = 'reverified_session'; }
    const saved = await db.withFamily(who.familyId, async c => {
      if (b.childId) {
        const ch = (await c.query('SELECT age_band FROM children WHERE id = $1 AND family_id = $2', [b.childId, who.familyId])).rows[0];
        if (!ch) throw new HttpError(404, 'not_found', 'No such player.');
        if (b.purpose === 'public_leagues' && b.granted && !LEAGUE_BANDS.has(ch.age_band)) {
          throw new HttpError(422, 'not_for_age', 'Leagues start from age 6.');
        }
      }
      if (b.granted && b.purpose === 'public_leagues') {
        const sync = (await c.query(`SELECT granted FROM consent_state WHERE family_id = $1 AND child_id IS NULL AND purpose = 'cloud_sync'`, [who.familyId])).rows[0];
        if (!sync?.granted) throw new HttpError(422, 'needs_cloud_sync', 'Turn on progress backup first.');
      }
      const r = (await c.query(
        `INSERT INTO consents (family_id, child_id, purpose, granted, method, policy_version, actor_user_id, receipt)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, created_at`,
        [who.familyId, b.childId || null, b.purpose, b.granted, method, POLICY_VERSION, who.userId, receipt(who.familyId, b.purpose, b.granted, b.childId)])).rows[0];
      await audit(c, who.familyId, who.userId, b.granted ? 'consent.granted' : 'consent.withdrawn', { purpose: b.purpose, child: b.childId || null });
      return { ...r, consents: await consentMap(c, who.familyId) };
    });
    // Withdrawing sync stops further uploads: drop anything still queued.
    if (!b.granted && b.purpose === 'cloud_sync') await stores.purgeFamily(who.familyId);
    if (!b.granted && b.purpose === 'public_leagues') {
      const ids = b.childId ? [b.childId] : (await db.withFamily(who.familyId, c => c.query('SELECT id FROM children WHERE family_id = $1', [who.familyId]))).rows.map(r => r.id);
      await stores.purgeChildren(ids);
    }
    return json({ receiptId: String(saved.id), at: saved.created_at, method, policyVersion: POLICY_VERSION, consents: saved.consents }, 201);
  });

  on('GET', '/api/consents', async ({ req }) => {
    const who = await auth.parent(req);
    return db.withFamily(who.familyId, async c => json({
      receipts: (await c.query('SELECT id, child_id, purpose, granted, method, policy_version, created_at FROM consents WHERE family_id = $1 ORDER BY id DESC LIMIT 200', [who.familyId])).rows,
    }));
  });

  // ---- Devices ----------------------------------------------------------------
  on('POST', '/api/devices', async ({ req }) => {
    const who = await auth.parent(req);
    const b = parseOrThrow(deviceSchema, await readJson(req));
    const dev = await db.withFamily(who.familyId, async c => {
      const n = (await c.query('SELECT count(*)::int AS n FROM devices WHERE family_id = $1 AND revoked_at IS NULL', [who.familyId])).rows[0].n;
      if (n >= LIMITS.devicesPerFamily) throw new HttpError(409, 'too_many_devices', `Remove a device first (up to ${LIMITS.devicesPerFamily}).`);
      const r = (await c.query('INSERT INTO devices (family_id, label) VALUES ($1,$2) RETURNING id, label, created_at', [who.familyId, b.label])).rows[0];
      await audit(c, who.familyId, who.userId, 'device.paired', { device: r.id });
      return r;
    });
    const token = issueDeviceToken(deps.deviceSecret, { familyId: who.familyId, deviceId: dev.id });
    return json({ device: dev, token }, 201);
  });

  on('DELETE', '/api/devices/:id', async ({ req, params }) => {
    const who = await auth.parent(req);
    if (!UUID.test(params.id)) throw new HttpError(404, 'not_found', 'No such device.');
    await db.withFamily(who.familyId, async c => {
      const r = await c.query('UPDATE devices SET revoked_at = now() WHERE id = $1 AND family_id = $2 AND revoked_at IS NULL', [params.id, who.familyId]);
      if (!r.rowCount) throw new HttpError(404, 'not_found', 'No such device.');
      await audit(c, who.familyId, who.userId, 'device.removed', { device: params.id });
    });
    await stores.revoke(params.id);
    return json({ removed: true });
  });

  // ---- Sync (Blobs only: the database is not woken) ------------------------------
  on('POST', '/api/sync', async ({ req }) => {
    const who = await auth.parentOrDevice(req);
    const b = parseOrThrow(syncSchema, await readJson(req, LIMITS.syncBodyBytes));
    const now = Date.now();
    const accepted = [], rejected = [];
    for (const s of b.sessions) {
      const start = Date.parse(s.startedAt);
      if (start > now + LIMITS.clockSkewMinutes * 60_000 || start < now - RETENTION.queueMaxAgeDays * 86400_000) { rejected.push({ id: s.id, reason: 'out_of_range' }); continue; }
      await stores.enqueue(who.familyId, who.kind === 'device' ? who.deviceId : null, s);
      accepted.push(s.id);
    }
    return json({ accepted, rejected, note: 'Saved. Progress updates twice a day.' }, 202);
  });

  // ---- Game history -----------------------------------------------------------
  on('GET', '/api/history', async ({ req, url }) => {
    const who = await auth.parent(req);
    const childId = url.searchParams.get('child');
    const before = url.searchParams.get('before');
    const limit = intParam(url.searchParams.get('limit'), { min: 1, max: LIMITS.historyPageMax, fallback: LIMITS.historyPageDefault });
    if (childId && !UUID.test(childId)) throw new HttpError(422, 'invalid', 'Bad player id.');
    if (before && Number.isNaN(Date.parse(before))) throw new HttpError(422, 'invalid', 'Bad date.');
    const out = await db.withFamily(who.familyId, async c => {
      const rows = (await c.query(
        `SELECT id, child_id, started_at, ended_at, bridge, age_band, answered, first_try_correct, stars,
                learning_points, facts_improved, facts_mastered, flagged
           FROM sessions WHERE family_id = $1 AND ($2::uuid IS NULL OR child_id = $2) AND ($3::timestamptz IS NULL OR started_at < $3)
          ORDER BY started_at DESC LIMIT $4`, [who.familyId, childId, before, limit])).rows;
      const facts = childId ? (await c.query(
        'SELECT a, b, box, seen, correct, best_ms, mastered_at FROM fact_progress WHERE child_id = $1 AND family_id = $2 ORDER BY a, b', [childId, who.familyId])).rows : undefined;
      const weeks = (await c.query(
        `SELECT child_id, week, points, facts_improved, facts_mastered, sessions FROM weekly_points
          WHERE family_id = $1 AND ($2::uuid IS NULL OR child_id = $2) ORDER BY week DESC LIMIT 12`, [who.familyId, childId])).rows;
      const rewards = (await c.query(
        `SELECT child_id, kind, code, reason, earned_at FROM rewards WHERE family_id = $1 AND ($2::uuid IS NULL OR child_id = $2) ORDER BY earned_at DESC LIMIT 50`,
        [who.familyId, childId])).rows;
      return { sessions: rows, facts, weeks, rewards };
    });
    // Rounds played since the last sync are shown as "on the way".
    const pending = [];
    try {
      for (const k of await stores.listQueued(`${who.familyId}/`)) {
        const v = await stores.getQueued(k);
        if (v && (!childId || v.session.childId === childId)) pending.push({ id: v.session.id, childId: v.session.childId, startedAt: v.session.startedAt, bridge: v.session.bridge, answered: v.session.items.length, pending: true });
      }
    } catch (e) {
      log.warn?.('pending rounds unavailable', e.message); // history still loads
    }
    return json({ ...out, pending, nextBefore: out.sessions.length === limit ? out.sessions.at(-1).started_at : null });
  });

  // ---- Leaderboards (served from the weekly snapshot, no database) ---------------
  on('GET', '/api/leaderboards', async ({ req, url }) => {
    const who = await auth.parentOrDevice(req);
    const childId = url.searchParams.get('child');
    if (!childId || !UUID.test(childId)) throw new HttpError(422, 'invalid', 'Pick a player.');
    const scope = url.searchParams.get('scope') || 'league';
    if (!['league', 'country', 'global'].includes(scope)) throw new HttpError(422, 'invalid', 'Unknown board.');
    const latest = await stores.getBoard('latest.json');
    if (!latest) return json({ ready: false, message: 'The first leagues start next Monday.' });
    // The league view is stored under the caller's own family id, so a child id from
    // another family finds nothing. It only exists if the parent opted in.
    const mine = await stores.getBoard(`${latest.week}/league-of/${who.familyId}/${childId}.json`);
    if (scope === 'league') return json({ ready: true, week: latest.week, league: mine ? stripRefs(mine) : null, optedIn: !!mine });
    if (!mine) return json({ ready: true, week: latest.week, optedIn: false, entries: [] });
    const band = url.searchParams.get('band');
    if (!LEAGUE_BANDS.has(band)) throw new HttpError(422, 'invalid', 'Pick an age band.');
    const country = scope === 'country' ? String(url.searchParams.get('country') || '').toUpperCase() : 'all';
    if (scope === 'country' && !/^[A-Z]{2}$/.test(country)) throw new HttpError(422, 'invalid', 'Pick a country.');
    const board = await stores.getBoard(`${latest.week}/${scope}-${country}-${band}.json`);
    return json({ ready: true, week: latest.week, optedIn: true, ...stripRefs(board || { entries: [] }) });
  });

  // Family board: private, can show first names. Uses the database (parents only).
  on('GET', '/api/leaderboards/family', async ({ req }) => {
    const who = await auth.parent(req);
    return db.withFamily(who.familyId, async c => {
      const rows = (await c.query(
        `SELECT ch.*, coalesce(wp.points, 0) AS points, coalesce(wp.facts_mastered, 0) AS mastered
           FROM children ch LEFT JOIN weekly_points wp ON wp.child_id = ch.id AND wp.week = $2::date
          WHERE ch.family_id = $1 ORDER BY points DESC, ch.created_at`, [who.familyId, weekOf(new Date())])).rows;
      return json({ entries: rows.map((r, i) => ({ rank: i + 1, ...childView(r), points: r.points, mastered: r.mastered })) });
    });
  });

  // ---- Rights: export, complaints, erasure ---------------------------------------
  on('GET', '/api/export', async ({ req }) => {
    const who = await auth.parent(req);
    const data = await db.withFamily(who.familyId, async c => {
      const q = async (sql) => (await c.query(sql, [who.familyId])).rows;
      return {
        exportedAt: new Date().toISOString(), policyVersion: POLICY_VERSION,
        family: (await q('SELECT id, country, rules, created_at, last_active_at FROM families WHERE id = $1'))[0],
        children: await q('SELECT * FROM children WHERE family_id = $1'),
        consents: await q('SELECT * FROM consents WHERE family_id = $1 ORDER BY id'),
        devices: await q('SELECT id, label, created_at, last_sync_at, revoked_at FROM devices WHERE family_id = $1'),
        sessions: await q('SELECT * FROM sessions WHERE family_id = $1 ORDER BY started_at'),
        factProgress: await q('SELECT * FROM fact_progress WHERE family_id = $1'),
        weeklyPoints: await q('SELECT * FROM weekly_points WHERE family_id = $1'),
        leagues: await q('SELECT lm.*, l.week, l.tier, l.age_band FROM league_members lm JOIN leagues l ON l.id = lm.league_id WHERE lm.family_id = $1'),
        rewards: await q('SELECT * FROM rewards WHERE family_id = $1'),
        complaints: await q('SELECT * FROM complaints WHERE family_id = $1'),
        auditLog: await q('SELECT actor, action, detail, at FROM audit_log WHERE family_id = $1 ORDER BY at'),
      };
    });
    await db.withFamily(who.familyId, c => audit(c, who.familyId, who.userId, 'data.exported'));
    return json(data, 200, { 'content-disposition': 'attachment; filename="times-table-adventure-data.json"' });
  });

  on('POST', '/api/complaints', async ({ req }) => {
    const who = await auth.parent(req);
    const b = parseOrThrow(complaintSchema, await readJson(req, LIMITS.complaintBodyBytes));
    const r = await db.withFamily(who.familyId, async c => {
      const open = (await c.query(`SELECT count(*)::int AS n FROM complaints WHERE family_id = $1 AND status <> 'resolved'`, [who.familyId])).rows[0].n;
      if (open >= LIMITS.openComplaints) throw new HttpError(429, 'too_many_open', `You have ${LIMITS.openComplaints} open complaints; we will reply to those first.`);
      const row = (await c.query('INSERT INTO complaints (family_id, category, message) VALUES ($1,$2,$3) RETURNING id, status, created_at', [who.familyId, b.category, b.message])).rows[0];
      await audit(c, who.familyId, who.userId, 'complaint.received', { complaint: row.id, category: b.category });
      return row;
    });
    const due = new Date(Date.parse(r.created_at) + COMPLAINT_ACK_DAYS * 86400_000).toISOString().slice(0, 10);
    return json({ complaint: r, acknowledgeBy: due, regulator: `You can also complain to ${regulatorFor(who.family.rules)}.` }, 201);
  });

  on('GET', '/api/complaints', async ({ req }) => {
    const who = await auth.parent(req);
    return db.withFamily(who.familyId, async c => json({
      complaints: (await c.query('SELECT id, category, status, created_at, acknowledged_at, resolved_at FROM complaints WHERE family_id = $1 ORDER BY created_at DESC', [who.familyId])).rows,
    }));
  });

  on('DELETE', '/api/account', async ({ req }) => {
    const who = await auth.parent(req);
    requireRecentSignIn(who);
    if (who.family.role !== 'owner') throw new HttpError(403, 'owner_only', 'Only the family owner can delete the family.');
    const r = await eraseFamily({ db, stores, familyId: who.familyId, reason: 'parent_request' });
    // Deleting the Clerk user also fires user.deleted, which is handled idempotently.
    await deps.clerk?.users.deleteUser(who.userId).catch(e => log.error?.('clerk delete failed', e.message));
    return json({ ...r, message: 'Everything has been deleted.' });
  });

  return async function handle(req) {
    const url = new URL(req.url);
    for (const r of routes) {
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      if (r.method !== req.method) continue;
      try {
        let params;
        try { params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])); }
        catch { throw new HttpError(404, 'not_found', 'Not found.'); } // malformed %-escape
        return await r.handler({ req, url, params });
      } catch (e) { return errorResponse(e, log); }
    }
    const pathExists = routes.some(r => r.re.test(url.pathname));
    return errorResponse(new HttpError(pathExists ? 405 : 404, pathExists ? 'method_not_allowed' : 'not_found', pathExists ? 'Method not allowed.' : 'Not found.'), log);
  };
}

function receipt(familyId, purpose, granted, childId = '') {
  return createHash('sha256').update(`${POLICY_VERSION}|${familyId}|${childId}|${purpose}|${granted}|${Date.now()}`).digest('hex');
}
