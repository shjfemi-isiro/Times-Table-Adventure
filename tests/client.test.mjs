import { describe, it, expect } from 'vitest';
import { createSyncClient } from '../client/sync-client.mjs';

const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const round = { childId: crypto.randomUUID(), startedAt: '2026-11-22T10:00:00Z', endedAt: '2026-11-22T10:03:00Z', bridge: 'tower', ageBand: 'masters', stars: 2, items: [{ a: 2, b: 3, ok: true, firstTry: true, ms: 1500, help: 0 }] };

describe('game sync client', () => {
  it('keeps rounds on the device until a grown-up pairs it', async () => {
    const storage = mem(); let calls = 0;
    const c = createSyncClient({ storage, fetchImpl: async () => { calls++; return { ok: true, status: 202 }; } });
    c.record(round); c.record(round);
    expect((await c.flush()).reason).toBe('not_paired');
    expect(calls).toBe(0); expect(c.pending()).toBe(2);
    storage.setItem('tta.deviceToken', 'ttd1.x.y');
    expect((await c.flush()).sent).toBe(2);
    expect(c.pending()).toBe(0);
  });
  it('sends in batches of 20 and stops when offline', async () => {
    const storage = mem(); storage.setItem('tta.deviceToken', 't');
    const sizes = [];
    const c = createSyncClient({ storage, fetchImpl: async (_u, o) => { sizes.push(JSON.parse(o.body).sessions.length); return { ok: true, status: 202 }; } });
    for (let i = 0; i < 45; i++) c.record(round);
    await c.flush();
    expect(sizes).toEqual([20, 20, 5]);
    const off = createSyncClient({ storage, fetchImpl: async () => { throw new Error('offline'); } });
    off.record(round);
    expect((await off.flush()).reason).toBe('offline');
    expect(off.pending()).toBe(1);
  });
  it('forgets the token when the device was removed', async () => {
    const storage = mem(); storage.setItem('tta.deviceToken', 't');
    const c = createSyncClient({ storage, fetchImpl: async () => ({ ok: false, status: 401 }) });
    c.record(round);
    expect((await c.flush()).reason).toBe('unpaired');
    expect(c.paired()).toBe(false); expect(c.pending()).toBe(1);
  });
});
