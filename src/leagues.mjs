import { createHash } from 'node:crypto';
import { renderGameName } from './gamenames.mjs';

export const LEAGUE_SIZE = 20;
export const PROMOTE_SHARE = 0.25;
export const BOARD_SIZE = 50;
export const TIER_NAMES = ['Tower', 'Golden Gate', 'London', 'Third Mainland', '6th October'];
// Promotion unlocks a paint for the toy car. Cosmetic only, never money.
export const TIER_PAINT = { 2: 'galaxy', 3: 'rainbow', 4: 'chrome', 5: 'aurora' };

const stableOrder = (id, week) => createHash('sha256').update(`${week}:${id}`).digest('hex');

// Public entry: generated name, avatar and points only. No ids, no first names.
export function publicEntry(row, rank, week) {
  const e = { rank, name: renderGameName(row.game_name_code), avatar: row.avatar_id, points: row.points };
  // Opaque reference, stored but stripped before serving, so an erased child can be
  // removed from boards that were already published.
  if (week) e.ref = boardRef(week, row.child_id);
  return e;
}

export function boardRef(week, childId) {
  return createHash('sha256').update(`ref:${week}:${childId}`).digest('hex').slice(0, 16);
}

export function stripRefs(board) {
  if (!board) return board;
  return { ...board, entries: (board.entries || []).map(({ ref, ...e }) => e) };
}

/**
 * Builds leagues of about 20 for one scope and band. Children are grouped by tier,
 * shuffled with a weekly hash (so groups change each week), ranked by points.
 * Nobody is ever demoted; the top quarter moves up a bridge.
 */
export function buildLeagues(rows, { week }) {
  const byTier = new Map();
  for (const r of rows) {
    const t = r.tier || 1;
    if (!byTier.has(t)) byTier.set(t, []);
    byTier.get(t).push(r);
  }
  const leagues = [];
  for (const [tier, list] of [...byTier.entries()].sort((a, b) => a[0] - b[0])) {
    list.sort((x, y) => stableOrder(x.child_id, week).localeCompare(stableOrder(y.child_id, week)));
    const groups = Math.max(1, Math.round(list.length / LEAGUE_SIZE));
    for (let g = 0; g < groups; g++) {
      const members = list.filter((_, i) => i % groups === g)
        .sort((x, y) => y.points - x.points || x.child_id.localeCompare(y.child_id));
      const promote = members.length >= 4 ? Math.max(1, Math.floor(members.length * PROMOTE_SHARE)) : 0;
      leagues.push({
        tier, week,
        members: members.map((m, i) => ({
          ...m,
          rank: i + 1,
          outcome: i < promote && tier < 5 ? 'promoted' : 'stayed',
        })),
      });
    }
  }
  return leagues;
}

export function buildBoard(rows, week) {
  return [...rows]
    .sort((x, y) => y.points - x.points || x.child_id.localeCompare(y.child_id))
    .slice(0, BOARD_SIZE)
    .map((r, i) => publicEntry(r, i + 1, week));
}

// What a child sees for their own league: the top ten, plus their own place if lower.
// Places below the child are not shown, so nobody is shown as last.
export function leagueView(league, childId) {
  const me = league.members.find(m => m.child_id === childId);
  const top = league.members.filter(m => m.rank <= 10);
  const rows = me && me.rank > 10 ? [...top, me] : top;
  return {
    tier: league.tier,
    tierName: TIER_NAMES[league.tier - 1],
    size: league.members.length,
    entries: rows.map(m => ({ ...publicEntry(m, m.rank, league.week), you: m.child_id === childId, outcome: m.outcome })),
  };
}
