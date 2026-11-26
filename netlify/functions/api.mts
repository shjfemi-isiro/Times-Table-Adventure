import type { Config, Context } from '@netlify/functions';
import { createApp } from '../../src/app.mjs';
import { runtime } from '../../src/runtime.mjs';

// The app is built per invocation (cheap) so it gets this invocation's Blobs token.
export default async (req: Request, context: Context) => {
  const app = createApp({ ...runtime(context), geoCountry: () => context.geo?.country?.code ?? null });
  return app(req);
};

export const config: Config = {
  path: '/api/*',
  excludedPath: ['/api/sync', '/api/clerk-webhook'],
  // Free plan allows two code-based rate limit rules per project; this is one.
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
