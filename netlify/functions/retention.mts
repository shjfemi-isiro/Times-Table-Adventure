import type { Config, Context } from '@netlify/functions';
import { enforceRetention } from '../../src/jobs.mjs';
import { runtime } from '../../src/runtime.mjs';

// Daily 03:10 UTC: apply the written retention policy (docs/COMPLIANCE.md).
export default async (_req: Request, context: Context) => {
  const rt = runtime(context);
  const out = await enforceRetention({ db: rt.db, stores: rt.stores });
  for (const userId of out.inactiveFamilies) await rt.clerk?.users.deleteUser(userId).catch(() => {});
  console.log('retention', JSON.stringify({ ...out, inactiveFamilies: out.inactiveFamilies.length }));
};

export const config: Config = { schedule: '10 3 * * *' };
