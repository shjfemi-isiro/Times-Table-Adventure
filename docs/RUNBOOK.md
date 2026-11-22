# Runbook

## One-time set-up

1. **GitHub:** push this folder to `shjfemi-isiro/Times-Table-Adventure`. Create the `staging` and `production` environments; add yourself as a required reviewer on `production`.
2. **GitHub secrets and variables:** run `scripts/setup-github.sh` (needs `gh` signed in), or add them by hand. The list is in that script.
3. **Clerk (staging):** in the Times Table Adventure app, development instance:
   - Copy the secret key into Netlify staging as `CLERK_SECRET_KEY`.
   - Add a webhook endpoint `https://timestableadventure-staging.netlify.app/api/clerk-webhook` with events `user.deleted`, `organization.created`, `organizationMembership.created` and `organizationMembership.deleted`.
   - Put its signing secret in `CLERK_WEBHOOK_SIGNING_SECRET`.
4. **Clerk (production):**
   - Buy or choose a domain.
   - Create the production instance on it.
   - Add the DNS records Clerk lists.
   - Set the `pk_live` and `sk_live` keys and the webhook secret on the Netlify production project.
   - Switch on bot protection.
5. **First staging deploy:** merge to `main` (Staging workflow), or run `npx netlify-cli deploy --build --prod --site 0e68ede6-b9d5-4949-ba1a-339cd426c9b0` from this folder.

## Releasing

1. Merge to `main` and wait for **Staging** to go green.
2. In Actions, run **Release to production** with the commit or `main`, then approve the `production` environment.
3. The workflow then runs these steps:
   1. Checks the deploy cap.
   2. Confirms the production environment variables are present.
   3. Checks for migration drift.
   4. Rehearses migrations on a throwaway Neon branch copied from production.
   5. Applies migrations.
   6. Deploys.
   7. Runs smoke, header, browser and accessibility checks against production.
4. If those checks fail, it redeploys the `prod-good` tag (fix forward) and opens an issue.

## Database changes

- Only add things in one release (new table, nullable column, new index). Code that uses them ships in the same or a later release.
- Removing or renaming needs two releases. First stop using it. Then add a migration that starts with `-- contract: <why it is safe>`.
- Never edit a migration that has been applied; `migrate check` fails on drift.

## Incidents

| Symptom | First step |
|---|---|
| Site paused | Netlify credits exhausted. Check team usage, stop deploys until the 1st, consider the paid plan |
| Rounds not appearing in history | Check `flush-sync` logs in Netlify; queued rounds wait up to 14 days |
| Sign-in broken | Check Clerk status; check `CLERK_AUTHORIZED_PARTIES` matches the site URL |
| Suspected data exposure | Rotate `DEVICE_TOKEN_SECRET` (signs every device out) and the Neon password; record in the audit; UK: tell the ICO within 72 hours if reportable |

## Rights requests by email

Ask the parent to use **Download everything** or **Delete account** in the grown-ups' area. Those are the audited paths. Acknowledge complaints within 30 days.
