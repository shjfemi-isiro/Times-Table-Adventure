#!/usr/bin/env node
// Free-plan budget model. Netlify Free: 300 credits/month, hard stop (projects pause).
// Neon Free: 100 CU-hours per project per month, scale to zero after 5 minutes idle.
// Rates (Netlify credit pricing, checked 22 Nov 2026): production deploy 15 credits,
// bandwidth 20 credits/GB, web requests 2 credits per 10k, compute 10 credits per GB-hour.
// Usage: node scripts/budget.mjs [families]
const families = Number(process.argv[2] || 300);
const a = {
  playersPerFamily: 1.6, playDaysPerMonth: 12, roundsPerPlayDay: 3,
  syncsPerPlayDay: 1,              // the game batches rounds, one POST per play day
  firstLoadMB: 0.35,               // game page + fonts, compressed
  repeatLoadMB: 0.03,              // revalidation only
  appOpensPerMonth: 14, releasesPerMonth: 4, stagingDeploysPerMonth: 4,
  parentApiCallsPerMonth: 25,      // grown-up area, history, boards
  fnMs: 120, fnGB: 1,              // average invocation time, default 1 GB memory
  neonWakesPerDay: 2.3,            // two flushes plus a few parent visits
  neonMinutesPerWake: 5.5, neonCU: 0.25,
};
const players = families * a.playersPerFamily;
const apiCalls = players * (a.playDaysPerMonth * a.syncsPerPlayDay + 4) + families * a.parentApiCallsPerMonth + 30 * 3;
const pageReqs = families * a.appOpensPerMonth * 6;
const gb = (families * (a.firstLoadMB * a.releasesPerMonth + a.repeatLoadMB * a.appOpensPerMonth) + apiCalls * 0.002) / 1024;
const credits = {
  productionDeploys: a.releasesPerMonth * 15,
  stagingDeploys: a.stagingDeploysPerMonth * 15,   // staging is its own project; its production deploys count too
  bandwidth: gb * 20,
  requests: ((apiCalls + pageReqs) / 10_000) * 2,
  compute: (apiCalls * a.fnMs / 3_600_000) * a.fnGB * 10,
};
const total = Object.values(credits).reduce((x, y) => x + y, 0);
const neonCUh = 30 * a.neonWakesPerDay * (a.neonMinutesPerWake / 60) * a.neonCU;
const r = n => Math.round(n * 10) / 10;
console.log(JSON.stringify({ families, players: Math.round(players), netlifyCredits: Object.fromEntries(Object.entries(credits).map(([k, v]) => [k, r(v)])), netlifyTotal: r(total), netlifyHeadroom: r(300 - total), neonProdCUHours: r(neonCUh), neonLimit: 100 }, null, 2));
if (total > 300) process.exitCode = 1;
