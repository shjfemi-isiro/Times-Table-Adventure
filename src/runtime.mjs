// Wires real dependencies for the deployed functions.
// The database pool and Clerk client are created once per function instance.
// Blobs stores are created per invocation: Netlify injects a short-lived Blobs token
// into each invocation, so a store reused across invocations fails with
// "Failed to decode token: Token expired".
import { createClerkClient } from '@clerk/backend';
import { getStore } from '@netlify/blobs';
import { env, requireEnv, APP_VERSION } from './env.mjs';
import { createDb, getPool } from './db.mjs';
import { blobStores } from './queue.mjs';
import { createAuthenticator, clerkSessionVerifier } from './auth.mjs';
import { HttpError } from './http.mjs';

let base;
function shared() {
  if (base) return base;
  const db = createDb(getPool(requireEnv('DATABASE_URL')));
  // Health checks and static data keep working even before Clerk keys are added.
  const secretKey = env('CLERK_SECRET_KEY');
  const clerk = secretKey ? createClerkClient({ secretKey, publishableKey: requireEnv('CLERK_PUBLISHABLE_KEY') }) : null;
  const authorizedParties = String(env('CLERK_AUTHORIZED_PARTIES', env('URL', ''))).split(',').map(s => s.trim()).filter(Boolean);
  const verifySession = clerk ? clerkSessionVerifier(clerk, { authorizedParties }) : async () => {
    throw new HttpError(503, 'auth_not_configured', 'Grown-up sign-in is not switched on yet.');
  };
  base = { db, clerk, verifySession, deviceSecret: requireEnv('DEVICE_TOKEN_SECRET'), appEnv: env('APP_ENV', 'production'), version: APP_VERSION, healthKey: env('HEALTH_KEY') };
  return base;
}

// Call once per invocation.
export function runtime(context) {
  const b = shared();
  const stores = blobStores(getStore, context?.deploy?.context || env('CONTEXT', 'production'));
  const auth = createAuthenticator({ verifySession: b.verifySession, db: b.db, deviceSecret: b.deviceSecret, revocations: stores });
  return { ...b, stores, auth };
}
