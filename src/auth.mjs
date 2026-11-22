import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { HttpError } from './http.mjs';
import { REVERIFY_MAX_MINUTES } from './policy.mjs';

// ---- Play-device tokens ---------------------------------------------------------
// A paired family tablet gets a signed token so it can sync without the parent's
// Clerk session, and without touching the database on every sync.
// Format: ttd1.<base64url(json)>.<base64url(hmac)>
const b64 = buf => Buffer.from(buf).toString('base64url');

export function issueDeviceToken(secret, { familyId, deviceId, issuedAt = Date.now() }) {
  if (!secret || secret.length < 32) throw new Error('DEVICE_TOKEN_SECRET must be at least 32 characters');
  const body = b64(JSON.stringify({ v: 1, f: familyId, d: deviceId, iat: Math.floor(issuedAt / 1000) }));
  const sig = b64(createHmac('sha256', secret).update(`ttd1.${body}`).digest());
  return `ttd1.${body}.${sig}`;
}

export function verifyDeviceToken(secret, token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts[0] !== 'ttd1') return null;
  const expected = createHmac('sha256', secret).update(`ttd1.${parts[1]}`).digest();
  const given = Buffer.from(parts[2], 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (p.v !== 1 || !p.f || !p.d) return null;
    return { familyId: p.f, deviceId: p.d, issuedAt: p.iat * 1000 };
  } catch { return null; }
}

export function newDeviceId() { return randomUUID(); }

// ---- Parents (Clerk) -------------------------------------------------------------
/**
 * @param {object} deps
 * @param {(req: Request) => Promise<object|null>} deps.verifySession  returns Clerk auth or null
 * @param {object} deps.db
 * @param {string} deps.deviceSecret
 * @param {object} deps.revocations  { isRevoked(deviceId) }
 */
export function createAuthenticator({ verifySession, db, deviceSecret, revocations }) {
  async function familyForUser(userId) {
    return db.withSystem(async c => {
      const r = await c.query(
        `SELECT f.id, f.country, f.rules, m.role
           FROM family_members m JOIN families f ON f.id = m.family_id
          WHERE m.user_id = $1 ORDER BY (m.role = 'owner') DESC LIMIT 1`, [userId]);
      return r.rows[0] || null;
    });
  }

  return {
    async parent(req, { needFamily = true } = {}) {
      const auth = await verifySession(req);
      if (!auth?.userId) throw new HttpError(401, 'signed_out', 'Please sign in as a grown-up.');
      if (auth.actor) {
        // Clerk impersonation (support) can look, never change consent or delete.
        auth.impersonated = true;
      }
      const fam = await familyForUser(auth.userId);
      if (needFamily && !fam) throw new HttpError(409, 'no_family', 'Finish setting up your family first.');
      return { kind: 'parent', userId: auth.userId, family: fam, familyId: fam?.id, fva: auth.factorVerificationAge, impersonated: !!auth.impersonated };
    },

    async device(req) {
      const h = req.headers.get('authorization') || '';
      const token = h.startsWith('Device ') ? h.slice(7) : null;
      if (!token) return null;
      const d = verifyDeviceToken(deviceSecret, token);
      if (!d) throw new HttpError(401, 'bad_device', 'This device needs pairing again.');
      if (await revocations.isRevoked(d.deviceId)) throw new HttpError(401, 'device_revoked', 'This device was removed by a grown-up.');
      return { kind: 'device', familyId: d.familyId, deviceId: d.deviceId };
    },

    async parentOrDevice(req) {
      return (await this.device(req)) || this.parent(req);
    },
  };
}

// Clerk reverification: sensitive actions need a sign-in within the last few minutes.
// The response shape is the one Clerk's useReverification() hook understands.
export function requireRecentSignIn(who) {
  const minutes = who.fva?.[0];
  if (who.impersonated) throw new HttpError(403, 'impersonation_blocked', 'Support sessions cannot do this.');
  if (minutes == null || minutes < 0 || minutes > REVERIFY_MAX_MINUTES) {
    throw new HttpError(403, 'reverification_required', 'Please confirm it is you.', {
      clerk_error: { type: 'forbidden', reason: 'reverification-error', metadata: { reverification: { level: 'first_factor', afterMinutes: REVERIFY_MAX_MINUTES } } },
    });
  }
}

// Real Clerk verification, used by the deployed functions.
export function clerkSessionVerifier(clerk, { authorizedParties }) {
  return async req => {
    const state = await clerk.authenticateRequest(req, { authorizedParties, acceptsToken: 'session_token' });
    if (!state.isAuthenticated) return null;
    return state.toAuth();
  };
}
