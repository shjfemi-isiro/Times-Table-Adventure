#!/usr/bin/env node
// Free plan guard: refuses a production deploy once this month's cap is reached, so
// releases can never pause the site by spending all 300 credits.
// Usage (CI): NETLIFY_AUTH_TOKEN=... SITE_ID=... CAP=6 node scripts/deploy-guard.mjs
const { NETLIFY_AUTH_TOKEN: token, SITE_ID: site } = process.env;
const cap = Number(process.env.CAP || 6);
if (!token || !site) { console.error('Set NETLIFY_AUTH_TOKEN and SITE_ID'); process.exit(2); }
const start = new Date(); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
let page = 1, count = 0;
for (;;) {
  const r = await fetch(`https://api.netlify.com/api/v1/sites/${site}/deploys?production=true&per_page=100&page=${page}`, { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) { console.error(`Netlify API ${r.status}`); process.exit(2); }
  const list = await r.json();
  const thisMonth = list.filter(d => d.state === 'ready' && d.context === 'production' && Date.parse(d.created_at) >= start.getTime());
  count += thisMonth.length;
  if (list.length < 100 || thisMonth.length < list.length) break;
  page++;
}
const credits = count * 15;
console.log(`Production deploys this month: ${count} (about ${credits} credits). Cap: ${cap}.`);
if (process.env.GITHUB_OUTPUT) (await import('node:fs')).appendFileSync(process.env.GITHUB_OUTPUT, `count=${count}\n`);
if (count >= cap) { console.error('Monthly production deploy cap reached. Batch changes into the next month, or raise CAP after checking credit usage.'); process.exit(1); }
