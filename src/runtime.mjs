// Wires real dependencies for the deployed functions. Created once per instance.
import { createClerkClient } from '@clerk/backend';
import { getStore } from '@netlify/blobs';
import { env, requireEnv, APP_VERSION } from './env.mjs';
import { createDb, getPool } from './db.mjs';
import { blobStores } from './queue.mjs';
import { createAuthenticator, clerkSessionVerifier } from './auth.mjs';
import { HttpError } from './http.mjs';

let cached;
export function runtime(context) {
  if (cached) return cached;
  const db = createDb(getPool(requireEnv('DATABASE_URL')));
  const stores = blobStores(getStore, context?.deploy?.context || env('CONTEXT', 'production'));
  // Health checks and static data keep working even before Clerk keys are added.
  const secretKey = env('CLERK_SECRET_KEY');
  const clerk = secretKey ? createClerkClient({ secretKey, publishableKey: requireEnv('CLERK_PUBLISHABLE_KEY') }) : null;
  const authorizedParties = String(env('CLERK_AUTHORIZED_PARTIES', env('URL', ''))).split(',').map(s => s.trim()).filter(Boolean);
  const deviceSecret = requireEnv('DEVICE_TOKEN_SECRET');
  const verifySession = clerk ? clerkSessionVerifier(clerk, { authorizedParties }) : async () => {
    throw new HttpError(503, 'auth_not_configured', 'Grown-up sign-in is not switched on yet.');
  };
  const auth = createAuthenticator({ verifySession, db, deviceSecret, revocations: stores });
  cached = { db, stores, clerk, auth, deviceSecret, appEnv: env('APP_ENV', 'production'), version: APP_VERSION, healthKey: env('HEALTH_KEY') };
  return cached;
}
