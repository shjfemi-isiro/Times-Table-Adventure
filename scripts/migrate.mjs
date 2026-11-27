#!/usr/bin/env node
// Usage: DATABASE_URL_OWNER=... node scripts/migrate.mjs [status|check|apply]
//   status  print applied/pending
//   check   fail on drift, removed or out-of-order migrations (pre-publish gate)
//   apply   apply pending migrations, one transaction each
import pg from 'pg';
import { strictSsl } from '../src/db.mjs';
import { loadMigrations, migrationStatus, applyMigrations, lintMigrations } from './migrations-lib.mjs';

const mode = process.argv[2] || 'status';
const url = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;
if (!url) { console.error('Set DATABASE_URL_OWNER (direct, unpooled connection as the owner role).'); process.exit(2); }

const list = loadMigrations();
const lint = lintMigrations(list);
if (lint.length) { console.error(lint.join('\n')); process.exit(1); }

const client = new pg.Client({ connectionString: strictSsl(url), connectionTimeoutMillis: 20_000 });
await client.connect();
try {
  const st = await migrationStatus(client, list);
  const summary = { applied: st.applied, pending: st.pending.map(m => m.name), drift: st.drift, removed: st.removed, outOfOrder: st.outOfOrder };
  if (mode === 'status') console.log(JSON.stringify(summary, null, 2));
  else if (mode === 'check') {
    console.log(JSON.stringify(summary, null, 2));
    if (st.drift.length || st.removed.length || st.outOfOrder.length) { console.error('Migration check failed.'); process.exit(1); }
  } else if (mode === 'apply') {
    const done = await applyMigrations(client, list);
    console.log(done.length ? `Applied: ${done.join(', ')}` : 'Up to date.');
  } else { console.error(`Unknown mode ${mode}`); process.exit(2); }
} finally { await client.end(); }
