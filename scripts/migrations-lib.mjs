import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export const MIGRATIONS_DIR = new URL('../db/migrations/', import.meta.url).pathname;
const NAME = /^(\d{4,14})_([a-z0-9_-]+)\.sql$/;
const DESTRUCTIVE = /\b(DROP\s+(TABLE|COLUMN|SCHEMA|VIEW|INDEX|TYPE|FUNCTION)|ALTER\s+TABLE\s+\S+\s+RENAME|ALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE|TRUNCATE|DELETE\s+FROM)\b/i;

export function loadMigrations(dir = MIGRATIONS_DIR) {
  return readdirSync(dir).filter(f => f.endsWith('.sql')).sort().map(file => {
    const sql = readFileSync(join(dir, file), 'utf8');
    return { name: file.replace(/\.sql$/, ''), file, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  });
}

// Expand/contract: destructive statements are allowed only in a migration that
// declares "-- contract:" and only after the code that stopped using it has shipped.
export function lintMigrations(list) {
  const problems = [];
  for (const m of list) {
    if (!NAME.test(m.file)) problems.push(`${m.file}: name must be <number>_<slug>.sql`);
    const body = m.sql.replace(/--.*$/gm, '').replace(/\$\$[\s\S]*?\$\$/g, '');
    if (DESTRUCTIVE.test(body) && !/^--\s*contract:/m.test(m.sql)) {
      problems.push(`${m.file}: destructive statement without a "-- contract:" note (use expand/contract)`);
    }
    if (/\bCREATE\s+INDEX\b(?!\s+CONCURRENTLY)/i.test(body) && /^--\s*large-table/m.test(m.sql)) {
      problems.push(`${m.file}: large-table migration must use CREATE INDEX CONCURRENTLY`);
    }
  }
  const nums = list.map(m => m.file.split('_')[0]);
  if (new Set(nums).size !== nums.length) problems.push('duplicate migration numbers');
  return problems;
}

export async function migrationStatus(client, list) {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = new Map((await client.query('SELECT name, checksum FROM schema_migrations')).rows.map(r => [r.name, r.checksum]));
  const drift = [], pending = [];
  for (const m of list) {
    if (!applied.has(m.name)) pending.push(m);
    else if (applied.get(m.name) !== m.checksum) drift.push(m.name);
  }
  const removed = [...applied.keys()].filter(n => !list.some(m => m.name === n));
  const latestApplied = [...applied.keys()].sort().at(-1);
  const outOfOrder = pending.filter(m => latestApplied && m.name < latestApplied).map(m => m.name);
  return { applied: applied.size, pending, drift, removed, outOfOrder };
}

export async function applyMigrations(client, list, log = console.log) {
  const st = await migrationStatus(client, list);
  if (st.drift.length || st.removed.length || st.outOfOrder.length) {
    throw new Error(`Refusing to migrate: drift=${st.drift} removed=${st.removed} outOfOrder=${st.outOfOrder}`);
  }
  for (const m of st.pending) {
    await client.query('BEGIN');
    try {
      await client.query(m.sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1,$2)', [m.name, m.checksum]);
      await client.query('COMMIT');
      log(`applied ${m.name}`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw new Error(`${m.name} failed: ${e.message}`);
    }
  }
  return st.pending.map(m => m.name);
}
