# Platform status (22 Nov 2026)

## Done
- Code: Clerk auth for parents, Neon database with row-level security, offline-first sync through Netlify Blobs, game history, family/league/country/world boards, consent receipts, export, erasure, complaints, retention jobs. 45 tests pass.
- Neon: production project "Times Table Adventure" (cool-scene-57379591) and new "Times Table Adventure Staging" (young-breeze-19131365), both London. Migrations 0001-0004 applied to both; RLS isolation checked on staging.
- Netlify: new project timestableadventure-staging (0e68ede6-b9d5-4949-ba1a-339cd426c9b0). Env vars set on staging and production: APP_ENV, DATABASE_URL, DEVICE_TOKEN_SECRET, HEALTH_KEY, CLERK_AUTHORIZED_PARTIES, plus CLERK_PUBLISHABLE_KEY on staging. Production live site not redeployed.
- Clerk dev instance (app_3MTXFz7TjDaolRLWdBgGn9plwmU): email code + passkeys + Google/Apple; passwords, usernames, names and Discord off; disposable emails blocked; organisations on (5 members); legal consent link; waitlist sign-up.
- Pipeline: CI, CodeQL, Staging, Release to production (approval + preflight + migration rehearsal + post-release checks + fix forward), Production watch, Dependabot.

- GitHub: code pushed to main; CI green (tests, build, browser + accessibility, audit, gitleaks). `production` environment created with KFD as required reviewer and admin bypass off. 8 repository variables set.
- Clerk: staging webhook created (user.deleted, organization.created, organizationMembership.created/deleted). Passkeys switched off again so Clerk stays on the free plan.

## Waiting on KFD (secrets: must be pasted by a person)
1. Netlify staging env vars: CLERK_SECRET_KEY (Clerk > API keys) and CLERK_WEBHOOK_SIGNING_SECRET (Clerk > Webhooks > endpoint > Signing secret).
2. GitHub repository secrets: NETLIFY_AUTH_TOKEN, NEON_API_KEY. Environment `staging`: STAGING_DATABASE_URL_OWNER, STAGING_HEALTH_KEY. Environment `production`: PROD_DATABASE_URL_OWNER, PROD_HEALTH_KEY.
3. A custom domain for the Clerk production instance.
4. First staging deploy (blocked from this session's network).
5. Legal review of docs/COMPLIANCE.md gaps (US consent method, Egypt licence, DPIA).
