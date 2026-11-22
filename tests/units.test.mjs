import { describe, it, expect } from 'vitest';
import { suggestGameNames, renderGameName, isGameNameCode, ADJECTIVES, ANIMALS } from '../src/gamenames.mjs';
import { scoreSession, weekOf, SCORING } from '../src/scoring.mjs';
import { buildLeagues, buildBoard, leagueView, stripRefs } from '../src/leagues.mjs';
import { issueDeviceToken, verifyDeviceToken, requireRecentSignIn } from '../src/auth.mjs';
import { childCreateSchema, syncSchema } from '../src/validate.mjs';
import { rulesFor, canJoinLeagues } from '../src/policy.mjs';

describe('game names', () => {
  it('only uses curated words and is reproducible', () => {
    const a = suggestGameNames(3, 42), b = suggestGameNames(3, 42);
    expect(a).toEqual(b);
    for (const s of a) {
      expect(isGameNameCode(s.code)).toBe(true);
      const [adj, animal, num] = s.name.split(' ');
      expect(ADJECTIVES).toContain(adj); expect(ANIMALS).toContain(animal); expect(num).toMatch(/^\d{2}$/);
    }
  });
  it('rejects codes outside the lists', () => {
    expect(isGameNameCode('99-0-10')).toBe(false);
    expect(isGameNameCode('1-1-1')).toBe(false);
    expect(renderGameName('nope')).toBe('Bridge Driver');
  });
  it('word lists contain no duplicates', () => {
    expect(new Set(ADJECTIVES).size).toBe(ADJECTIVES.length);
    expect(new Set(ANIMALS).size).toBe(ANIMALS.length);
  });
});

const sess = (items, band = 'masters') => ({ id: 'x', childId: 'c', startedAt: '2026-11-16T10:00:00Z', endedAt: '2026-11-16T10:05:00Z', bridge: 'london', ageBand: band, stars: 3, items });

describe('learning points', () => {
  it('rewards learning a fact, not just answering', () => {
    const p = new Map();
    const r = scoreSession(p, sess([{ a: 7, b: 8, ok: true, firstTry: true, ms: 2500, help: 0 }]));
    expect(r.points).toBe(SCORING.firstTryCorrect + SCORING.boxUp);
    expect(p.get('7x8').box).toBe(1);
  });
  it('awards mastery once', () => {
    const p = new Map([['7x8', { a: 7, b: 8, box: 3, streak: 3, seen: 3, correct: 3, best_ms: 2600, mastered_at: null }]]);
    const r1 = scoreSession(p, sess([{ a: 7, b: 8, ok: true, firstTry: true, ms: 2000, help: 0 }]));
    expect(r1.mastered).toBe(1);
    expect(r1.points).toBe(1 + 2 + 1 + 10);
    const r2 = scoreSession(p, sess([{ a: 7, b: 8, ok: true, firstTry: true, ms: 2000, help: 0 }]));
    expect(r2.mastered).toBe(0);
  });
  it('ignores inhumanly fast taps and flags tap-spam', () => {
    const items = Array.from({ length: 10 }, () => ({ a: 2, b: 2, ok: true, firstTry: true, ms: 120, help: 0 }));
    const r = scoreSession(new Map(), sess(items));
    expect(r.flagged).toBe(true); expect(r.points).toBe(0);
  });
  it('respects the daily cap', () => {
    const r = scoreSession(new Map(), sess([{ a: 3, b: 4, ok: true, firstTry: true, ms: 2000, help: 0 }]), { pointsToday: SCORING.dailyCap - 1, sessionsToday: 1 });
    expect(r.points).toBe(1);
  });
  it('a wrong answer drops the fact back without negative points', () => {
    const p = new Map([['6x7', { a: 6, b: 7, box: 3, streak: 2, seen: 4, correct: 4, best_ms: 3000, mastered_at: null }]]);
    const r = scoreSession(p, sess([{ a: 6, b: 7, ok: false, firstTry: true, ms: 4000, help: 0 }]));
    expect(r.points).toBe(0); expect(p.get('6x7').box).toBe(1);
  });
  it('weeks start on Monday UTC', () => {
    expect(weekOf('2026-11-22T23:00:00Z')).toBe('2026-11-16');
    expect(weekOf('2026-11-23T00:00:01Z')).toBe('2026-11-23');
  });
});

describe('leagues', () => {
  const rows = Array.from({ length: 45 }, (_, i) => ({ child_id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`, family_id: 'f', points: i * 3, tier: i < 40 ? 1 : 2, avatar_id: 'fox', game_name_code: '1-1-11' }));
  it('groups by tier into leagues of about 20 and never demotes', () => {
    const lgs = buildLeagues(rows, { week: '2026-11-16' });
    expect(lgs.filter(l => l.tier === 1).length).toBe(2);
    for (const l of lgs) {
      expect(l.members.every(m => ['promoted', 'stayed'].includes(m.outcome))).toBe(true);
      expect(l.members[0].rank).toBe(1);
    }
    const promoted = lgs.flatMap(l => l.members).filter(m => m.outcome === 'promoted');
    expect(promoted.length).toBeGreaterThan(0);
  });
  it('public boards carry no ids or first names once refs are stripped', () => {
    const board = stripRefs({ entries: buildBoard(rows, '2026-11-16') });
    expect(board.entries.length).toBe(45);
    for (const e of board.entries) expect(Object.keys(e).sort()).toEqual(['avatar', 'name', 'points', 'rank']);
  });
  it('a child sees the top ten and their own place, never anyone below', () => {
    const lg = buildLeagues(rows.slice(0, 20), { week: '2026-11-16' })[0];
    const low = lg.members.at(-1);
    const v = leagueView(lg, low.child_id);
    expect(v.entries.length).toBe(11);
    expect(v.entries.at(-1).you).toBe(true);
  });
});

describe('device tokens', () => {
  const secret = 'x'.repeat(40);
  it('round-trips and rejects tampering', () => {
    const t = issueDeviceToken(secret, { familyId: 'f1', deviceId: 'd1' });
    expect(verifyDeviceToken(secret, t)).toMatchObject({ familyId: 'f1', deviceId: 'd1' });
    const forged = t.slice(0, -2) + (t.endsWith('A') ? 'BB' : 'AA');
    expect(verifyDeviceToken(secret, forged)).toBe(null);
    expect(verifyDeviceToken('y'.repeat(40), t)).toBe(null);
  });
  it('refuses short secrets', () => { expect(() => issueDeviceToken('short', { familyId: 'f', deviceId: 'd' })).toThrow(); });
});

describe('reverification', () => {
  it('needs a sign-in within 10 minutes and blocks support sessions', () => {
    expect(() => requireRecentSignIn({ fva: [3, -1] })).not.toThrow();
    expect(() => requireRecentSignIn({ fva: [30, -1] })).toThrow(/confirm/);
    expect(() => requireRecentSignIn({ fva: null })).toThrow();
    expect(() => requireRecentSignIn({ fva: [1, -1], impersonated: true })).toThrow(/Support/);
  });
});

describe('validation', () => {
  it('first names are letters only, any script', () => {
    const base = { avatarId: 'ada', ageBand: 'masters', gameNameCode: '1-2-33', displayMode: 'first_name' };
    expect(childCreateSchema.safeParse({ ...base, firstName: 'Adaeze' }).success).toBe(true);
    expect(childCreateSchema.safeParse({ ...base, firstName: 'محمد' }).success).toBe(true);
    expect(childCreateSchema.safeParse({ ...base, firstName: "O'Neil-Ann" }).success).toBe(true);
    expect(childCreateSchema.safeParse({ ...base, firstName: 'http://x.io' }).success).toBe(false);
    expect(childCreateSchema.safeParse({ ...base, firstName: 'Ada123' }).success).toBe(false);
    expect(childCreateSchema.safeParse({ ...base }).success).toBe(false);
    expect(childCreateSchema.safeParse({ ...base, displayMode: 'avatar', surname: 'X' }).success).toBe(false);
  });
  it('caps sync batches', () => {
    const s = { id: crypto.randomUUID(), childId: crypto.randomUUID(), startedAt: '2026-11-22T10:00:00Z', endedAt: '2026-11-22T10:04:00Z', bridge: 'tower', ageBand: 'masters', stars: 2, items: [{ a: 2, b: 3, ok: true, firstTry: true, ms: 1500 }] };
    expect(syncSchema.safeParse({ sessions: [s] }).success).toBe(true);
    expect(syncSchema.safeParse({ sessions: Array(21).fill(s) }).success).toBe(false);
    expect(syncSchema.safeParse({ sessions: [{ ...s, items: Array(41).fill(s.items[0]) }] }).success).toBe(false);
  });
});

describe('policy', () => {
  it('maps countries to rules', () => {
    expect(rulesFor('gb')).toBe('uk'); expect(rulesFor('NG')).toBe('ng'); expect(rulesFor('EG')).toBe('eg');
    expect(rulesFor('FR')).toBe('eu'); expect(rulesFor('US')).toBe('us'); expect(rulesFor('JP')).toBe('other');
  });
  it('little drivers never join public leagues', () => {
    expect(canJoinLeagues({ age_band: 'little' }, { public_leagues: true, cloud_sync: true })).toBe(false);
    expect(canJoinLeagues({ age_band: 'masters' }, { public_leagues: true, cloud_sync: true })).toBe(true);
    expect(canJoinLeagues({ age_band: 'masters' }, { public_leagues: true })).toBe(false);
  });
});
