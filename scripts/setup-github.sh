#!/usr/bin/env bash
# Sets GitHub Actions secrets and variables for the pipeline. Needs `gh auth login`.
# Values are read from your shell so nothing secret is stored in this file.
set -euo pipefail
REPO="${REPO:-shjfemi-isiro/Times-Table-Adventure}"
need() { [ -n "${!1:-}" ] || { echo "Set $1 first"; exit 1; }; }
for v in NETLIFY_AUTH_TOKEN NEON_API_KEY STAGING_DATABASE_URL_OWNER PROD_DATABASE_URL_OWNER STAGING_HEALTH_KEY PROD_HEALTH_KEY; do need "$v"; done

gh secret set NETLIFY_AUTH_TOKEN --repo "$REPO" --body "$NETLIFY_AUTH_TOKEN"
gh secret set NEON_API_KEY --repo "$REPO" --body "$NEON_API_KEY"
gh secret set STAGING_DATABASE_URL_OWNER --repo "$REPO" --env staging --body "$STAGING_DATABASE_URL_OWNER"
gh secret set STAGING_HEALTH_KEY --repo "$REPO" --env staging --body "$STAGING_HEALTH_KEY"
gh secret set PROD_DATABASE_URL_OWNER --repo "$REPO" --env production --body "$PROD_DATABASE_URL_OWNER"
gh secret set PROD_HEALTH_KEY --repo "$REPO" --env production --body "$PROD_HEALTH_KEY"

gh variable set NETLIFY_STAGING_SITE_ID --repo "$REPO" --body 0e68ede6-b9d5-4949-ba1a-339cd426c9b0
gh variable set NETLIFY_PROD_SITE_ID --repo "$REPO" --body 4ae52c0b-bf33-46d1-aad4-a34c40e55728
gh variable set STAGING_URL --repo "$REPO" --body https://timestableadventure-staging.netlify.app
gh variable set PROD_URL --repo "$REPO" --body https://timestableadventure.netlify.app
gh variable set NEON_PROD_PROJECT_ID --repo "$REPO" --body cool-scene-57379591
gh variable set EXPECT_MIGRATION --repo "$REPO" --body 0004_row_security
gh variable set STAGING_MONTHLY_CAP --repo "$REPO" --body 6
gh variable set PROD_MONTHLY_CAP --repo "$REPO" --body 6
echo "Done. Now add yourself as a required reviewer on the production environment."
