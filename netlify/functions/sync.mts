import type { Config, Context } from '@netlify/functions';
import { createApp } from '../../src/app.mjs';
import { runtime } from '../../src/runtime.mjs';

// Separate function so syncing gets its own, tighter rate limit (rule two of two).
export default async (req: Request, context: Context) => createApp(runtime(context))(req);

export const config: Config = {
  path: '/api/sync',
  method: 'POST',
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
