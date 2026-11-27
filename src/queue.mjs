import { boardRef } from './leagues.mjs';
import { BLOBS_REGION } from './policy.mjs';

// Sync queue and published boards live in Netlify Blobs, so syncing a round never
// wakes the database. Store names carry the deploy context so previews and
// production never share data. Every store is opened in the same region: a call
// without it would read Netlify's default region (Ohio) and see nothing.
export function blobStores(getStore, contextName = 'production', region = BLOBS_REGION) {
  const suffix = contextName === 'production' ? 'prod' : contextName.replace(/[^a-z0-9-]/gi, '-').slice(0, 20);
  const queue = getStore({ name: `sync-queue-${suffix}`, consistency: 'strong', region });
  const boards = getStore({ name: `boards-${suffix}`, region });
  const revoked = getStore({ name: `revoked-devices-${suffix}`, consistency: 'strong', region });
  return {
    async enqueue(familyId, deviceId, session) {
      await queue.setJSON(`${familyId}/${session.id}`, { familyId, deviceId, session, queuedAt: new Date().toISOString() });
    },
    async listQueued(prefix = '') {
      const { blobs } = await queue.list({ prefix });
      return blobs.map(b => b.key);
    },
    getQueued: key => queue.get(key, { type: 'json' }),
    deleteQueued: key => queue.delete(key),
    putBoard: (key, value) => boards.setJSON(key, value),
    getBoard: key => boards.get(key, { type: 'json' }),
    async deleteBoardsBefore(week) {
      const { blobs } = await boards.list();
      for (const b of blobs) { const w = b.key.split('/')[0]; if (/^\d{4}-\d{2}-\d{2}$/.test(w) && w < week) await boards.delete(b.key); }
    },
    revoke: deviceId => revoked.set(deviceId, '1'),
    async isRevoked(deviceId) { return (await revoked.get(deviceId)) !== null; },
    // Removes erased children from already-published boards and league views.
    async purgeChildren(childIds) {
      if (!childIds.length) return;
      const { blobs } = await boards.list();
      for (const b of blobs) {
        const [week, rest] = [b.key.split('/')[0], b.key.slice(b.key.indexOf('/') + 1)];
        if (rest.startsWith('league-of/') && childIds.some(id => rest.endsWith(`/${id}.json`))) { await boards.delete(b.key); continue; }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || rest === 'index.json') continue;
        const board = await boards.get(b.key, { type: 'json' });
        if (!board?.entries) continue;
        const refs = new Set(childIds.map(id => boardRef(week, id)));
        const kept = board.entries.filter(e => !refs.has(e.ref));
        if (kept.length !== board.entries.length) {
          await boards.setJSON(b.key, { ...board, entries: kept.map((e, i) => ({ ...e, rank: i + 1 })) });
        }
      }
    },
    async purgeFamily(familyId) {
      const { blobs } = await queue.list({ prefix: `${familyId}/` });
      for (const b of blobs) await queue.delete(b.key);
    },
  };
}

// In-memory twin of the Blobs API for tests and local scripts.
export function memoryStoreFactory() {
  const stores = new Map();
  return ({ name }) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      async setJSON(k, v) { m.set(k, JSON.stringify(v)); return { modified: true }; },
      async set(k, v) { m.set(k, String(v)); return { modified: true }; },
      async get(k, o) { if (!m.has(k)) return null; const v = m.get(k); return o?.type === 'json' ? JSON.parse(v) : v; },
      async delete(k) { m.delete(k); },
      async list({ prefix = '' } = {}) { return { blobs: [...m.keys()].filter(k => k.startsWith(prefix)).sort().map(key => ({ key, etag: '' })) }; },
    };
  };
}
