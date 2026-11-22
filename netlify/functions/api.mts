import type { Config, Context } from '@netlify/functions';
import { createApp } from '../../src/app.mjs';
import { runtime } from '../../src/runtime.mjs';

let handle: ((req: Request) => Promise<Response>) | undefined;

export default async (req: Request, context: Context) => {
  if (!handle) {
    const rt = runtime(context);
    handle = createApp({ ...rt, geoCountry: () => context.geo?.country?.code ?? null });
  }
  return handle(req);
};

export const config: Config = {
  path: '/api/*',
  excludedPath: ['/api/sync', '/api/clerk-webhook'],
  // Free plan allows two code-based rate limit rules per project; this is one.
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
