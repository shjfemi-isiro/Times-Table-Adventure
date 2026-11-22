# Times Table Adventure: platform

Backend, security and release pipeline for the Bridge Crossing times-table game.

| Piece | Where | Notes |
|---|---|---|
| Game and grown-ups' area | Netlify (static, `public/`) | Strict CSP, security headers, `noindex` outside production |
| API | Netlify Functions (`netlify/functions/`) | One router plus a separate sync function, two rate-limit rules |
| Sign-in | Clerk (parents only) | Email code or passkey, Google or Apple; children never get accounts |
| Database | Neon Postgres, London (`aws-eu-west-2`) | Row-level security per family; does not spend Netlify credits |
| Sync queue and boards | Netlify Blobs | Syncing a round never wakes the database |
| Jobs | Netlify scheduled functions | Flush twice a day, weekly leagues, daily retention |

## Environments

| | Staging | Production |
|---|---|---|
| Netlify project | `timestableadventure-staging` | `timestableadventure` |
| URL | https://timestableadventure-staging.netlify.app | https://timestableadventure.netlify.app |
| Neon project | Times Table Adventure Staging (`young-breeze-19131365`), max 0.5 CU | Times Table Adventure (`cool-scene-57379591`) |
| Clerk | Development instance, waitlist mode | Production instance (needs a custom domain) |
| Schema | Migrations 0001 to 0004 applied | Migrations 0001 to 0004 applied |

## Commands

```bash
npm ci
npm test                 # 45 tests: unit + API against a real local Postgres engine
npm run lint:migrations  # expand/contract safety
npm run build            # dist/ with _headers (CSP from inline-script hashes)
npm run budget -- 1000   # free-plan credit model for 1,000 families
DATABASE_URL_OWNER=... node scripts/migrate.mjs status|check|apply
BASE_URL=... npm run smoke | check:headers | e2e
```

## Release flow

`pull request -> CI` then `merge to main -> Staging (migrate, deploy, smoke, headers, browser + accessibility)` then
`Release to production` (manual, needs approval) `-> preflight on production -> migrate -> deploy -> check production -> fix forward if it fails`.

See `docs/RUNBOOK.md` for the steps, `docs/ARCHITECTURE.md` for the design, `docs/COMPLIANCE.md` for the
privacy controls and retention policy, `docs/FREE-TIER-BUDGET.md` for staying on free plans.
