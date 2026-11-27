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
- All Netlify env vars and GitHub secrets/variables in place. STAGING_MONTHLY_CAP raised to 9 for November (9 staging deploys used = 135 credits). Changes that only touch tests, checks or docs are now checked without a paid deploy.

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
- Pending deploy: removing a device silently threw away rounds it had already uploaded but not yet saved. Now kept; anything queued after removal is still dropped. Parent history now says "Not counted (answers too fast)" for flagged rounds and shows how many facts are being practised.

Gaps found (not bugs in the backend):
- The game at / does not use the sync client yet, so real play stays on the device. QA rounds were sent through the API as a paired tablet would.
- Game: answer box stays green after a wrong answer; suggested country can be wrong (showed US for a UK user).

## Still open
1. Live release: run "Release to production" (needs KFD's approval in GitHub). Live site needs Clerk production keys first, and those need a custom domain.
2. Legal review of docs/COMPLIANCE.md gaps (US consent method, Egypt licence, DPIA).
3. Design review agent was stopped before finishing; restart if wanted.
4. Wire client/sync-client.mjs into the game so real play backs up.
5. Deploy the device-removal fix to staging (needs one more staging deploy; November cap of 9 is used).
