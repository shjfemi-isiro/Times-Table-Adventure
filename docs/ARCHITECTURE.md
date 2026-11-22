# Architecture

## Data flow

1. A child plays on a phone or tablet. Each finished round is saved on the device first (`client/sync-client.mjs`).
2. If a grown-up has paired the device and switched on backup, rounds go to `POST /api/sync` in batches of up to 20. The function checks a signed device token (no database call) and writes each round to a Netlify Blobs queue.
3. `flush-sync` runs at 06:15 and 18:15 UTC. It wakes Neon once, re-scores every answer on the server (a modified app cannot award itself points), updates fact progress and weekly points, and empties the queue.
4. `weekly-leagues` runs Monday 00:20 UTC. It builds leagues and boards and writes them to Blobs. Leaderboard reads are served from Blobs, never the database.
5. Grown-ups use `/parents/` (Clerk sign-in). Those calls do use the database, but they are rare.

Result: a normal play day touches the database zero times; it wakes about twice a day.

## Security layers

| Layer | Control |
|---|---|
| Edge | Netlify code-based rate limits: API 120/min/IP, sync 20/min/IP (the two Free-plan rules) |
| Pages | CSP with hashed inline scripts, no `unsafe-inline` scripts, `frame-ancestors 'none'`, HSTS, Permissions-Policy off for camera/mic/location, COOP/CORP |
| Auth | Clerk session JWT verified with `authorizedParties`; device tokens HMAC-signed and revocable; Clerk reverification (sign-in in last 10 minutes) for league consent and account deletion; impersonated support sessions cannot change consent or delete |
| Input | zod schemas, strict objects (unknown fields rejected), body size caps, curated game names only |
| Database | Each request runs as `tta_app` with `app.family_id` set; row-level security on every family table; consent receipts append-only by trigger; jobs run as owner |
| Secrets | Netlify env vars; secrets scanning in builds; gitleaks and CodeQL in CI; Dependabot |
| Release | Staging must pass first, manual approval, migration rehearsal on a copy of production, post-release checks, fix forward |

## Clerk features used

| Feature | Use |
|---|---|
| Email code, passkeys, Google, Apple | Grown-up sign-in. Passwords, usernames and names are switched off (data minimisation) |
| Reverification (`fva` claim) | Required for public leagues consent and account deletion |
| Webhooks (`user.deleted`, `organization*`) | Erasure cascade; co-parents and carers via organisations |
| Organisations | One per family, up to 5 members, for co-parents |
| Waitlist mode | On staging, so only approved testers can sign up |
| Legal consent at sign-up | Links the privacy notice |
| Disposable email blocking, user lockout, enumeration protection | Abuse protection |
| Public metadata | `familyId` and policy version written after set-up |
| Impersonation | Support can view, never change consent or delete |
| Bot protection | Turn on in the production instance (did not apply on the development instance) |
| Billing (not wired) | Possible family unlock later; Apple and Google in-app purchase rules apply in the mobile apps |

## Leaderboards

- **Family board:** private. May show first names. Built live from the database for the grown-up.
- **League (weekly):** about 20 children in the same age band and tier, ranked by learning points. The top quarter moves up a bridge (Tower, Golden Gate, London, Third Mainland, 6th October) and unlocks a paint. Nobody is demoted. A child sees the top ten and their own place, never anyone below them.
- **Country and world boards:** top 50 per age band, built weekly.
- **Who appears:** ages 6 to 10 only, and only when a grown-up turned on backup and leagues (after re-verifying).
- **What appears:** generated game name, avatar and points. No ids, first names or exact locations.
- **Learning points:** 1 for right first time, 2 when a fact moves up a box, 1 for getting faster, 10 when a fact is mastered. Answers under 300 ms are ignored. Capped at 80 a day (also a gentle screen-time limit). Everyone who beats last week gets a "personal best" badge, ranked or not.
- **Erasure:** deleting a child or withdrawing consent removes them from boards already published.
