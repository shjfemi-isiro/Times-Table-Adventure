import pg from 'pg';

// One pool per function instance (module scope), never per request.
let shared;
export function getPool(connectionString) {
  if (!shared) {
    shared = new pg.Pool({
      connectionString,
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000, // allows for Neon waking from scale-to-zero
      statement_timeout: 10_000,
    });
  }
  return shared;
}

export function createDb(pool) {
  async function tx(fn, setup) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (setup) await setup(client);
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      throw e;
    } finally {
      client.release();
    }
  }
  return {
    // Request work: least-privilege role plus row-level security scoped to one family.
    withFamily(familyId, fn) {
      if (!familyId) throw new Error('withFamily needs a family id');
      return tx(fn, async c => {
        await c.query('SET LOCAL ROLE tta_app');
        await c.query("SELECT set_config('app.family_id', $1, true)", [familyId]);
      });
    },
    // Scheduled jobs, auth lookups and erasure: owner role, explicit WHERE clauses.
    withSystem(fn) { return tx(fn); },
    async end() { await pool.end(); },
  };
}
