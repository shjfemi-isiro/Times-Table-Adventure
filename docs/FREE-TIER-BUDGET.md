# Staying on free plans

**Netlify Free:** 300 credits a month for the whole team, hard limit (projects pause when reached).
Rates checked 22 Nov 2026: production deploy 15 credits; bandwidth 20 per GB; web requests 2 per 10,000; compute 10 per GB-hour.
Staging is its own project, so its production deploys cost 15 credits too.

**Neon Free:** per project 100 CU-hours a month and 0.5 GB to 1 GB storage, scale to zero after 5 minutes. The database is on Neon directly, so it spends no Netlify credits.

## Model (`npm run budget -- <families>`)

Assumptions: 1.6 players per family; 12 play days a month; one sync per play day; 4 releases and 4 staging deploys a month; 350 KB first load.

| Families | Netlify credits | Headroom | Neon CU-hours (prod) |
|---|---|---|---|
| 300 | about 144 | about 156 | about 1.6 |
| 1,000 | about 201 | about 99 | about 1.6 |
| 2,000 | about 283 | about 17 | about 1.6 |

Deploys are the biggest cost: 8 a month is 120 credits. Bandwidth grows with families.

## Guards in place

- `scripts/deploy-guard.mjs` stops a deploy when the month's cap is reached (default 6 per project).
- Sync never wakes the database; leaderboards are served from Blobs.
- The staging Neon compute is capped at 0.5 CU.
- No Netlify Database package is installed, so Netlify will not provision a second database.

## When you outgrow it

Above about 2,000 active families, either cut releases to 2 a month or move to a paid Netlify plan. Check current prices first.
