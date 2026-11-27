import type { Config, Context } from '@netlify/functions';
import { flushQueue, reconcileRevocations } from '../../src/jobs.mjs';
import { runtime } from '../../src/runtime.mjs';

// Wakes the database twice a day to save queued rounds: 06:15 and 18:15 UTC
// (06:15/18:15 in London in winter, 07:15/19:15 in summer).
export default async (_req: Request, context: Context) => {
  const rt = runtime(context);
  const removals = await reconcileRevocations({ db: rt.db, stores: rt.stores });
  const stats = await flushQueue({ db: rt.db, stores: rt.stores });
  console.log('flush', JSON.stringify({ ...stats, removals }));
};

export const config: Config = { schedule: '15 6,18 * * *' };
