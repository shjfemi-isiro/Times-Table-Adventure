import { createHash } from 'node:crypto';
import { scoreSession, weekOf } from './scoring.mjs';
import { buildLeagues, buildBoard, leagueView, TIER_PAINT } from './leagues.mjs';
import { LEAGUE_BANDS, RETENTION } from './policy.mjs';

const dayStart = iso => new Date(iso.slice(0, 10) + 'T00:00:00Z').toISOString();

// ---- Flush: queue (Blobs) -> database. Runs twice a day and before the weekly rollup.
export async function flushQueue({ db, stores, now = new Date(), limit = 2000, log = console }) {
  const keys = (await stores.listQueued()).slice(0, limit);
  const stats = { seen: keys.length, saved: 0, duplicate: 0, dropped: 0 };
  if (!keys.length) return stats;
  const maxAge = now.getTime() - RETENTION.queueMaxAgeDays * 86400_000;

  // Group by family so each family is one short transaction.
  const byFamily = new Map();
  for (const k of keys) {
    const fam = k.split('/')[0];
    if (!byFamily.has(fam)) byFamily.set(fam, []);
    byFamily.get(fam).push(k);
  }

  for (const [familyId, famKeys] of byFamily) {
    const items = [];
    for (const k of famKeys) {
      const v = await stores.getQueued(k);
      if (!v || Date.parse(v.queuedAt) < maxAge) { stats.dropped++; await stores.deleteQueued(k); continue; }
      items.push({ key: k, ...v });
    }
    items.sort((x, y) => x.session.startedAt.localeCompare(y.session.startedAt));
    try {
      await db.withSystem(async c => {
        const fam = await c.query('SELECT id FROM families WHERE id = $1', [familyId]);
        if (!fam.rowCount) { stats.dropped += items.length; return; }
        const kids = new Map((await c.query('SELECT id, age_band FROM children WHERE family_id = $1', [familyId])).rows.map(r => [r.id, r]));
        const devices = new Map((await c.query('SELECT id, revoked_at FROM devices WHERE family_id = $1', [familyId])).rows.map(r => [r.id, r]));
        const sync = await c.query(
          `SELECT child_id, bool_and(granted) AS on FROM consent_state WHERE family_id = $1 AND purpose = 'cloud_sync' GROUP BY child_id`, [familyId]);
        const familySync = sync.rows.find(r => r.child_id === null)?.on === true;

        for (const it of items) {
          const s = it.session;
          const child = kids.get(s.childId);
          const dev = it.deviceId ? devices.get(it.deviceId) : null;
          if (!child || !familySync || (it.deviceId && (!dev || dev.revoked_at))) { stats.dropped++; continue; }
          const dup = await c.query('SELECT 1 FROM sessions WHERE id = $1', [s.id]);
          if (dup.rowCount) { stats.duplicate++; continue; }

          const prog = new Map((await c.query(
            'SELECT a, b, box, streak, seen, correct, best_ms, mastered_at FROM fact_progress WHERE child_id = $1', [s.childId]
          )).rows.map(r => [`${r.a}x${r.b}`, r]));
          const today = (await c.query(
            `SELECT coalesce(sum(learning_points),0)::int AS p, count(*)::int AS n FROM sessions
              WHERE child_id = $1 AND started_at >= $2 AND started_at < $2::timestamptz + interval '1 day'`,
            [s.childId, dayStart(s.startedAt)])).rows[0];
          const band = child.age_band; // the server's band wins over the device's
          const r = scoreSession(prog, { ...s, ageBand: band }, { pointsToday: today.p, sessionsToday: today.n });

          await c.query(
            `INSERT INTO sessions (id, family_id, child_id, device_id, started_at, ended_at, bridge, age_band, answered,
               first_try_correct, stars, learning_points, facts_improved, facts_mastered, flagged, items)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
            [s.id, familyId, s.childId, it.deviceId || null, s.startedAt, s.endedAt, s.bridge, band, r.answered,
             r.firstTryCorrect, s.stars, r.points, r.improved, r.mastered, r.flagged, JSON.stringify(s.items)]);
          for (const f of r.changed) {
            await c.query(
              `INSERT INTO fact_progress (child_id, family_id, a, b, box, streak, seen, correct, best_ms, mastered_at, updated_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
               ON CONFLICT (child_id, a, b) DO UPDATE SET box = EXCLUDED.box, streak = EXCLUDED.streak, seen = EXCLUDED.seen,
                 correct = EXCLUDED.correct, best_ms = EXCLUDED.best_ms, mastered_at = EXCLUDED.mastered_at, updated_at = now()`,
              [s.childId, familyId, f.a, f.b, f.box, f.streak, f.seen, f.correct, f.best_ms, f.mastered_at]);
          }
          await c.query(
            `INSERT INTO weekly_points (child_id, family_id, week, points, facts_improved, facts_mastered, sessions)
             VALUES ($1,$2,$3,$4,$5,$6,1)
             ON CONFLICT (child_id, week) DO UPDATE SET points = weekly_points.points + EXCLUDED.points,
               facts_improved = weekly_points.facts_improved + EXCLUDED.facts_improved,
               facts_mastered = weekly_points.facts_mastered + EXCLUDED.facts_mastered,
               sessions = weekly_points.sessions + 1`,
            [s.childId, familyId, weekOf(s.startedAt), r.points, r.improved, r.mastered]);
          for (const m of r.newlyMastered) {
            await c.query(
              `INSERT INTO rewards (child_id, family_id, kind, code, reason) VALUES ($1,$2,'sticker',$3,'Learned a new fact')
               ON CONFLICT DO NOTHING`, [s.childId, familyId, `fact-${m.a}x${m.b}`]);
          }
          if (it.deviceId) await c.query('UPDATE devices SET last_sync_at = now() WHERE id = $1', [it.deviceId]);
          stats.saved++;
        }
        await c.query('UPDATE families SET last_active_at = now() WHERE id = $1', [familyId]);
      });
      for (const it of items) await stores.deleteQueued(it.key);
    } catch (e) {
      log.error?.('flush failed for a family; items stay queued', e.message);
    }
  }
  return stats;
}

// ---- Weekly rollup: leagues, boards, rewards. Runs Monday 00:20 UTC.
export async function weeklyRollup({ db, stores, now = new Date() }) {
  const thisWeek = weekOf(now);
  const week = weekOf(new Date(Date.parse(thisWeek) - 86400_000)); // the week that just ended

  return db.withSystem(async c => {
    const already = await c.query('SELECT 1 FROM leagues WHERE week = $1 LIMIT 1', [week]);
    if (already.rowCount) return { week, skipped: true };

    // Only children whose parent turned on public leagues (and cloud sync), in the 6-10 bands.
    const rows = (await c.query(
      `SELECT wp.child_id, wp.family_id, wp.points, ch.avatar_id, ch.game_name_code, ch.age_band, f.country,
              coalesce(t.tier, 1) AS tier
         FROM weekly_points wp
         JOIN children ch ON ch.id = wp.child_id
         JOIN families f ON f.id = wp.family_id
         LEFT JOIN child_tiers t ON t.child_id = wp.child_id
        WHERE wp.week = $1 AND wp.points > 0
          AND ch.age_band = ANY($2)
          AND EXISTS (SELECT 1 FROM consent_state cs WHERE cs.family_id = wp.family_id AND cs.child_id IS NULL
                       AND cs.purpose = 'cloud_sync' AND cs.granted)
          AND EXISTS (SELECT 1 FROM consent_state cs WHERE cs.family_id = wp.family_id
                       AND (cs.child_id = wp.child_id OR cs.child_id IS NULL)
                       AND cs.purpose = 'public_leagues' AND cs.granted
                       AND NOT EXISTS (SELECT 1 FROM consent_state x WHERE x.family_id = wp.family_id AND x.child_id = wp.child_id
                                        AND x.purpose = 'public_leagues' AND NOT x.granted))`,
      [week, [...LEAGUE_BANDS]])).rows;

    const out = { week, children: rows.length, leagues: 0, promoted: 0 };
    const boardsIndex = {};
    for (const band of LEAGUE_BANDS) {
      const bandRows = rows.filter(r => r.age_band === band);
      const scopes = [{ scope: 'global', country: null, rows: bandRows }];
      for (const cc of [...new Set(bandRows.map(r => r.country))]) scopes.push({ scope: 'country', country: cc, rows: bandRows.filter(r => r.country === cc) });

      for (const sc of scopes) {
        const boardKey = `${week}/${sc.scope}-${sc.country || 'all'}-${band}.json`;
        await stores.putBoard(boardKey, { week, scope: sc.scope, country: sc.country, band, entries: buildBoard(sc.rows, week) });
        boardsIndex[`${sc.scope}-${sc.country || 'all'}-${band}`] = boardKey;
        if (sc.scope !== 'global') continue; // leagues are global per band; boards exist per country too

        for (const lg of buildLeagues(sc.rows, { week })) {
          const id = (await c.query(
            `INSERT INTO leagues (week, scope, country, age_band, tier) VALUES ($1,'global',NULL,$2,$3) RETURNING id`,
            [week, band, lg.tier])).rows[0].id;
          out.leagues++;
          for (const m of lg.members) {
            await c.query(
              `INSERT INTO league_members (league_id, child_id, family_id, points, rank, outcome) VALUES ($1,$2,$3,$4,$5,$6)`,
              [id, m.child_id, m.family_id, m.points, m.rank, m.outcome]);
            await stores.putBoard(`${week}/league-of/${m.family_id}/${m.child_id}.json`, leagueView(lg, m.child_id));
            if (m.outcome === 'promoted') {
              out.promoted++;
              const next = lg.tier + 1;
              await c.query(
                `INSERT INTO child_tiers (child_id, family_id, tier) VALUES ($1,$2,$3)
                 ON CONFLICT (child_id) DO UPDATE SET tier = GREATEST(child_tiers.tier, EXCLUDED.tier), updated_at = now()`,
                [m.child_id, m.family_id, next]);
              if (TIER_PAINT[next]) await c.query(
                `INSERT INTO rewards (child_id, family_id, kind, code, reason) VALUES ($1,$2,'paint',$3,'Moved up a bridge') ON CONFLICT DO NOTHING`,
                [m.child_id, m.family_id, TIER_PAINT[next]]);
            }
          }
        }
      }
    }

    // Personal best: everyone who beat their own last week gets a badge, ranked or not.
    const pb = await c.query(
      `INSERT INTO rewards (child_id, family_id, kind, code, reason)
       SELECT cur.child_id, cur.family_id, 'badge', 'best-' || to_char($1::date, 'IYYY-"w"IW'), 'Beat last week'
         FROM weekly_points cur JOIN weekly_points prev ON prev.child_id = cur.child_id AND prev.week = $1::date - 7
        WHERE cur.week = $1 AND cur.points > prev.points
       ON CONFLICT DO NOTHING`, [week]);
    out.personalBests = pb.rowCount;
    await stores.putBoard(`${week}/index.json`, boardsIndex);
    await stores.putBoard('latest.json', { week });
    await stores.deleteBoardsBefore(weekOf(new Date(Date.parse(week) - RETENTION.leagueWeeks * 7 * 86400_000)));
    return out;
  });
}

// ---- Retention: the written policy, enforced daily at 03:10 UTC.
export async function enforceRetention({ db, stores, now = new Date() }) {
  const out = {};
  const families = await db.withSystem(async c => {
    out.sessionsTrimmed = (await c.query(
      `DELETE FROM sessions WHERE started_at < $1::timestamptz - make_interval(days => $2)`, [now, RETENTION.sessionDetailDays])).rowCount;
    out.weeklyPoints = (await c.query(`DELETE FROM weekly_points WHERE week < ($1::date - make_interval(weeks => $2))::date`, [now, RETENTION.weeklyPointsWeeks])).rowCount;
    out.leagues = (await c.query(`DELETE FROM leagues WHERE week < ($1::date - make_interval(weeks => $2))::date`, [now, RETENTION.leagueWeeks])).rowCount;
    out.audit = (await c.query(`DELETE FROM audit_log WHERE at < $1::timestamptz - make_interval(days => $2)`, [now, RETENTION.auditDays])).rowCount;
    out.complaints = (await c.query(
      `DELETE FROM complaints WHERE status = 'resolved' AND resolved_at < $1::timestamptz - make_interval(days => $2)`, [now, RETENTION.resolvedComplaintDays])).rowCount;
    return (await c.query(
      `SELECT id, owner_user_id FROM families WHERE last_active_at < $1::timestamptz - make_interval(days => $2)`, [now, RETENTION.inactiveFamilyDays])).rows;
  });
  out.inactiveFamilies = [];
  for (const f of families) { await eraseFamily({ db, stores, familyId: f.id, reason: 'inactive' }); out.inactiveFamilies.push(f.owner_user_id); }
  return out;
}

// ---- Erasure: one path for "delete my account", Clerk user.deleted and inactivity.
export async function eraseFamily({ db, stores, familyId, reason }) {
  const { devices, children } = await db.withSystem(async c => {
    const d = (await c.query('SELECT id FROM devices WHERE family_id = $1', [familyId])).rows.map(r => r.id);
    const kids = (await c.query('SELECT id FROM children WHERE family_id = $1', [familyId])).rows.map(r => r.id);
    await c.query('DELETE FROM families WHERE id = $1', [familyId]); // cascades to every child table
    await c.query('DELETE FROM audit_log WHERE family_id = $1', [familyId]);
    await c.query(`INSERT INTO audit_log (family_id, actor, action, detail) VALUES (NULL, 'system', 'family.erased', $1)`,
      [JSON.stringify({ ref: createHash('sha256').update(familyId).digest('hex').slice(0, 16), reason })]);
    return { devices: d, children: kids };
  });
  for (const d of devices) await stores.revoke(d);
  await stores.purgeFamily(familyId);
  await stores.purgeChildren(children);
  return { erased: true, devices: devices.length, children: children.length };
}
