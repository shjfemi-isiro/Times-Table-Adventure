import pg from 'pg';
import { NetlifyDB } from '@netlify/database-dev';
import { createDb } from '../src/db.mjs';
import { blobStores, memoryStoreFactory } from '../src/queue.mjs';
import { createAuthenticator } from '../src/auth.mjs';
import { createApp } from '../src/app.mjs';
import { loadMigrations, applyMigrations } from '../scripts/migrations-lib.mjs';

export const SECRET = 'test-device-secret-that-is-long-enough-123';

export async function startStack() {
  const local = new NetlifyDB();
  const url = await local.start();
  const owner = new pg.Client({ connectionString: url });
  await owner.connect();
  await applyMigrations(owner, loadMigrations(), () => {});
  await owner.end();
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const db = createDb(pool);
  const stores = blobStores(memoryStoreFactory(), 'test');
  // Stand-in for Clerk: x-test-user is the Clerk user id, x-test-fva the minutes since sign-in.
  const verifySession = async req => {
    const userId = req.headers.get('x-test-user');
    if (!userId) return null;
    const fva = req.headers.get('x-test-fva');
    return { userId, factorVerificationAge: fva == null ? [60, -1] : [Number(fva), -1], actor: req.headers.get('x-test-actor') ? { sub: 'support' } : null };
  };
  const auth = createAuthenticator({ verifySession, db, deviceSecret: SECRET, revocations: stores });
  const clerkCalls = [];
  const clerk = { users: {
    updateUserMetadata: async (...a) => { clerkCalls.push(['meta', ...a]); },
    deleteUser: async id => { clerkCalls.push(['delete', id]); },
  } };
  const app = createApp({ db, auth, stores, clerk, deviceSecret: SECRET, appEnv: 'test', version: 'test', healthKey: 'hk', log: { error() {}, warn() {}, info() {} } });
  return { url, db, stores, app, clerkCalls, async stop() { await pool.end(); await local.stop(); } };
}

export function call(app, method, path, { user, fva, body, device, actor } = {}) {
  const headers = {};
  if (user) headers['x-test-user'] = user;
  if (fva != null) headers['x-test-fva'] = String(fva);
  if (actor) headers['x-test-actor'] = '1';
  if (device) headers.authorization = `Device ${device}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return app(new Request(`https://app.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }))
    .then(async r => ({ status: r.status, headers: r.headers, body: await r.json() }));
}
