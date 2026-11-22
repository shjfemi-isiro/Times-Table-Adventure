import type { Config, Context } from '@netlify/functions';
import { flushQueue, weeklyRollup } from '../../src/jobs.mjs';
import { runtime } from '../../src/runtime.mjs';

// Monday 00:20 UTC: save the last rounds, then close the week's leagues.
export default async (_req: Request, context: Context) => {
  const rt = runtime(context);
  await flushQueue({ db: rt.db, stores: rt.stores });
  const out = await weeklyRollup({ db: rt.db, stores: rt.stores });
  console.log('leagues', JSON.stringify(out));
};

export const config: Config = { schedule: '20 0 * * 1' };
