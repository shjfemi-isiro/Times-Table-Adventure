// Drop-in sync for the game. Rounds are saved on the device first (works offline),
// then sent in small batches when a grown-up has paired the device and turned on
// backup. Nothing is sent otherwise.
export function createSyncClient({ storage = globalThis.localStorage, fetchImpl = globalThis.fetch, endpoint = '/api/sync', maxQueue = 200 } = {}) {
  const KEY = 'tta.queue.v1', TOKEN = 'tta.deviceToken';
  const read = () => { try { return JSON.parse(storage.getItem(KEY) || '[]'); } catch { return []; } };
  const write = q => { try { storage.setItem(KEY, JSON.stringify(q.slice(-maxQueue))); } catch {} };
  const token = () => { try { return storage.getItem(TOKEN); } catch { return null; } };

  return {
    // Call once per finished round.
    record(round) {
      const q = read();
      q.push({ ...round, id: round.id || crypto.randomUUID() });
      write(q);
    },
    pending: () => read().length,
    paired: () => !!token(),
    async flush() {
      const t = token();
      if (!t) return { sent: 0, reason: 'not_paired' };
      let sent = 0;
      for (;;) {
        const q = read();
        if (!q.length) break;
        const batch = q.slice(0, 20);
        let res;
        try {
          res = await fetchImpl(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Device ${t}` }, body: JSON.stringify({ sessions: batch }) });
        } catch { return { sent, reason: 'offline' }; }
        if (res.status === 401) { try { storage.removeItem(TOKEN); } catch {} return { sent, reason: 'unpaired' }; }
        if (res.status === 429) return { sent, reason: 'later' };
        if (!res.ok && res.status !== 422) return { sent, reason: `http_${res.status}` };
        // 202: accepted. 422: a bad round would block the queue forever, so drop the batch.
        const done = new Set(batch.map(b => b.id));
        write(read().filter(r => !done.has(r.id)));
        sent += batch.length;
      }
      return { sent };
    },
  };
}
