# Platform status (27 Nov 2026)

## Done
- Code: Clerk auth for parents, Neon database with row-level security, offline-first sync through Netlify Blobs, game history, family/league/country/world boards, consent receipts, export, erasure, complaints, retention jobs. 45 tests pass.
- Neon: production project "Times Table Adventure" (cool-scene-57379591) and new "Times Table Adventure Staging" (young-breeze-19131365), both London. Migrations 0001-0004 applied to both; RLS isolation checked on staging.
- Netlify: new project timestableadventure-staging (0e68ede6-b9d5-4949-ba1a-339cd426c9b0). Env vars set on staging and production: APP_ENV, DATABASE_URL, DEVICE_TOKEN_SECRET, HEALTH_KEY, CLERK_AUTHORIZED_PARTIES, plus CLERK_PUBLISHABLE_KEY on staging. Production live site not redeployed.
- Clerk dev instance (app_3MTXFz7TjDaolRLWdBgGn9plwmU): email code + passkeys + Google/Apple; passwords, usernames, names and Discord off; disposable emails blocked; organisations on (5 members); legal consent link; waitlist sign-up.
- Pipeline: CI, CodeQL, Staging, Release to production (approval + preflight + migration rehearsal + post-release checks + fix forward), Production watch, Dependabot.

- GitHub: code pushed to main; CI green (tests, build, browser + accessibility, audit, gitleaks). `production` environment created with KFD as required reviewer and admin bypass off. 8 repository variables set.
- Clerk: staging webhook created (user.deleted, organization.created, organizationMembership.created/deleted). Passkeys switched off again so Clerk stays on the free plan.

## Staging live (26 Nov 2026)
- https://timestableadventure-staging.netlify.app : staging database migrated, smoke, security headers, browser and accessibility checks all green (Staging run 15, commit a74e218).
- Grown-ups page shows Clerk sign-in (Apple, Google, email code, waitlist). Clerk v6 needs its UI bundle loaded first; CSP allows Clerk's *.protect.clerk.com anti-bot service.
- "Powered by Netlify" badge turned off on staging and production (it linked children to an outside site).
- All Netlify env vars and GitHub secrets/variables in place. STAGING_MONTHLY_CAP raised to 10 for November (10 staging deploys used = 150 credits). Changes that only touch tests, checks or docs are now checked without a paid deploy.

## End-to-end QA on staging (26-27 Nov 2026)
QA accounts (Clerk dev instance, sign in with code 424242): qa-parent-a+clerk_test@example.com (family with Zara, 8-10, and a 3-5 player) and qa-parent-b+clerk_test@example.com (empty family, used for cross-family checks).

Passed on live staging:
- Sign-in by email code; consent receipts; pairing a play device; rounds upload (202), resending is ignored, rounds dated in the future are refused.
- Save job (flush-sync, "Run now") moves rounds into history: points 6 and 10 for real rounds, 0 for a round answered faster than a person can (anti-cheat).
- Parent page shows history, facts, family board and paired devices; export downloads the whole family record.
- Removed device can no longer upload (401). Device tokens can't open parent pages (401). Requests carrying only the sign-in cookie are refused (401).
- Parent B sees none of A's child: history, facts, league, family board, export all empty; can't remove A's devices (404).

Security and reliability issues found and fixed:
- c41e35f (deployed): storage tokens expired between requests (500s on sync/history/leagues); API accepted the sign-in cookie alone (cross-site request risk); a league view could be read by guessing a child id; extra family checks on every child/device query.
- 69e0127 (deployed): removing a device silently threw away rounds it had already uploaded but not yet saved. Now kept; anything queued after removal is still dropped. Parent history says "Not counted (answers too fast)" for flagged rounds and how many facts are being practised.

## Review of hardcoded text and functions (27 Nov 2026, deployed in 592d0dc/d8b100f, Staging run green)
- Data location: Netlify Blobs defaulted to Ohio (US) while the parents' page said "our servers in London". Blobs now opened in Frankfurt (eu-central-1). Functions still run in Ohio (changing region is a Pro feature). Parent page and privacy notice now say exactly this; policy version 2026-11-27. Device removals are re-applied from the database at every save run (restored 1 on the switch).
- Functions: non-numeric `limit`/`n` caused 500s; malformed %-escapes crashed routing; unknown board names checked late; family board week came from the database clock. All fixed with tests (49 pass).
- Hardcoded values moved to policy.LIMITS (players 6, devices 5, open complaints 5, clock skew 10 min, body sizes, page sizes).
- Complaints: category picker (was always "privacy"); regulator shown for the family's country (was always the ICO); acknowledgement days from policy.
- Parents' page: "Tower Bridge" not "tower", "Amira" not "amira", suggested country always in the list, errors shown instead of silent failures.
- Game: answer box was green even when wrong; now neutral while typing, green when right, red when wrong. "Try again!" (the game moves on) replaced with the fact, e.g. "Not quite! 3 × 11 = 33".
- CI had been failing since c41e35f: the browser check treated Clerk's placeholder-key start-up error as a page error. Fixed; CI green.

Waiting for the next deploy (December, or with approval), on branch next-deploy:
- Clerk telemetry switched off in the server SDK and the grown-ups' page (seen in function logs; children's product).
- Database connections use sslmode=verify-full (pg warned that "require" will weaken in pg 9).

Gaps found (not bugs in the backend):
- The game at / does not use the sync client yet, so real play stays on the device. QA rounds were sent through the API as a paired tablet would.
- Game: answer box stays green after a wrong answer; suggested country can be wrong (showed US for a UK user).

## Still open
1. Live release: run "Release to production" (needs KFD's approval in GitHub). Live site needs Clerk production keys first, and those need a custom domain.
2. Legal review of docs/COMPLIANCE.md gaps (US consent method, Egypt licence, DPIA).
3. Design review agent was stopped before finishing; restart if wanted.
4. Wire client/sync-client.mjs into the game so real play backs up.
5. Deploy branch next-deploy (Clerk telemetry off, strict database TLS). November staging cap of 10 is used.
6. Legal: rounds pass through Netlify in the US and sign-in data sits with Clerk in the US; check the transfer basis (e.g. UK Extension to the EU-US Data Privacy Framework) in the DPIA.
