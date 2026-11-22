import type { Config, Context } from '@netlify/functions';
import { verifyWebhook } from '@clerk/backend/webhooks';
import { handleClerkEvent } from '../../src/webhook.mjs';
import { runtime } from '../../src/runtime.mjs';

export default async (req: Request, context: Context) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  let evt;
  try {
    evt = await verifyWebhook(req, { signingSecret: Netlify.env.get('CLERK_WEBHOOK_SIGNING_SECRET') });
  } catch {
    return new Response('Invalid signature', { status: 400 });
  }
  const rt = runtime(context);
  const out = await handleClerkEvent(evt, rt);
  return Response.json(out, { headers: { 'cache-control': 'no-store' } });
};

export const config: Config = { path: '/api/clerk-webhook', method: 'POST' };
