# Platform status (22 Nov 2026)

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
- All Netlify env vars and GitHub secrets/variables in place. STAGING_MONTHLY_CAP raised to 8 for November (8 staging deploys used = 120 credits). Changes that only touch tests, checks or docs are now checked without a paid deploy.

## Still open
1. Live release: run "Release to production" (needs KFD's approval in GitHub). Live site needs Clerk production keys first, and those need a custom domain.
2. Legal review of docs/COMPLIANCE.md gaps (US consent method, Egypt licence, DPIA).
3. Design review agent was stopped before finishing; restart if wanted.
