// Learning points. The server recomputes everything from raw answers, so a modified
// app cannot award itself points. Points reward knowing more facts, not raw speed.
export const SCORING = {
  firstTryCorrect: 1,
  boxUp: 2,
  mastered: 10,
  gotFaster: 1,
  fasterRatio: 0.85,
  minHumanMs: 300,       // answers faster than this are ignored (taps, bots)
  dailyCap: 80,          // also a gentle screen-time limit
  sessionsPerDayCap: 30,
};

export const BAND_RULES = {
  little:   { boxes: 5, masteryBox: 3, fluentMs: null },
  builders: { boxes: 5, masteryBox: 3, fluentMs: 6000 },
  masters:  { boxes: 6, masteryBox: 4, fluentMs: 3000 },
};

const key = (a, b) => `${a}x${b}`;

/**
 * Applies one session to a child's fact progress.
 * @param {Map<string, object>} progress  existing rows keyed "AxB" (mutated)
 * @param {object} session  validated session
 * @param {{pointsToday:number, sessionsToday:number}} today
 */
export function scoreSession(progress, session, today = { pointsToday: 0, sessionsToday: 0 }) {
  const rules = BAND_RULES[session.ageBand];
  let points = 0, improved = 0, mastered = 0, ignored = 0;
  const changed = new Set();
  const newlyMastered = [];
  const at = session.endedAt;

  for (const it of session.items) {
    if (it.ms < SCORING.minHumanMs) { ignored++; continue; }
    const k = key(it.a, it.b);
    const st = progress.get(k) || { a: it.a, b: it.b, box: 0, streak: 0, seen: 0, correct: 0, best_ms: null, mastered_at: null };
    st.seen++;
    if (it.ok) {
      st.correct++; st.streak++;
      if (it.firstTry) points += SCORING.firstTryCorrect;
      const limit = rules.fluentMs == null ? Infinity : rules.fluentMs * (st.box < 2 ? 2 : 1);
      if (it.firstTry && it.ms <= limit && it.help <= 1) {
        if (st.box < rules.boxes - 1) { st.box++; points += SCORING.boxUp; improved++; }
      } else {
        st.box = Math.max(st.box, 1);
      }
      if (it.firstTry && it.help <= 1 && st.best_ms != null && it.ms < st.best_ms * SCORING.fasterRatio) points += SCORING.gotFaster;
      if (it.firstTry && it.help <= 1) st.best_ms = st.best_ms == null ? it.ms : Math.min(st.best_ms, it.ms);
      if (!st.mastered_at && st.box >= rules.masteryBox) {
        st.mastered_at = at; points += SCORING.mastered; mastered++; newlyMastered.push({ a: it.a, b: it.b });
      }
    } else {
      st.streak = 0;
      st.box = Math.min(st.box, 1);
    }
    progress.set(k, st);
    changed.add(k);
  }

  const flagged = ignored > session.items.length / 2;
  if (flagged || today.sessionsToday >= SCORING.sessionsPerDayCap) points = 0;
  points = Math.max(0, Math.min(points, SCORING.dailyCap - today.pointsToday));
  return {
    points, improved, mastered, flagged, newlyMastered,
    answered: session.items.length,
    firstTryCorrect: session.items.filter(i => i.ok && i.firstTry).length,
    changed: [...changed].map(k => progress.get(k)),
  };
}

// Monday (UTC) of the ISO week containing the date, as YYYY-MM-DD.
export function weekOf(date) {
  const d = new Date(date);
  const day = (d.getUTCDay() + 6) % 7;
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return m.toISOString().slice(0, 10);
}
