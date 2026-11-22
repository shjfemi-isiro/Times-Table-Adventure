// Rules that depend on where the family lives. Country is chosen by the parent in
// onboarding; Netlify's geo header only pre-selects it.
export const POLICY_VERSION = '2026-11-22';

const RULES_BY_COUNTRY = { GB: 'uk', US: 'us', NG: 'ng', EG: 'eg' };
const EU = new Set(['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE','IS','LI','NO']);

export function rulesFor(country) {
  const c = String(country || '').toUpperCase();
  return RULES_BY_COUNTRY[c] || (EU.has(c) ? 'eu' : 'other');
}

// Purposes a parent can switch on. Core play needs no account and stays on the device.
export const PURPOSES = ['core', 'cloud_sync', 'family_board', 'public_leagues', 'product_emails'];

// Public leagues are never offered to the 3-5 band, and need a freshly re-verified
// parent session (Clerk reverification) as a deliberate second step.
export const LEAGUE_BANDS = new Set(['builders', 'masters']);
export const STRONG_CONSENT = new Set(['public_leagues']);
export const REVERIFY_MAX_MINUTES = 10;

// Written retention policy (COPPA 2025 rule, UK GDPR storage limitation).
export const RETENTION = {
  sessionDetailDays: 365,        // per-answer detail; totals live on in fact_progress
  weeklyPointsWeeks: 104,
  leagueWeeks: 12,
  inactiveFamilyDays: 730,       // then the whole family is erased
  auditDays: 730,
  resolvedComplaintDays: 1095,
  queueMaxAgeDays: 14,           // unsynced items older than this are dropped
};

export const COMPLAINT_ACK_DAYS = 30;

export function canJoinLeagues(child, consentState) {
  return LEAGUE_BANDS.has(child.age_band) && consentState?.public_leagues === true && consentState?.cloud_sync === true;
}
