// Rules that depend on where the family lives. Country is chosen by the parent in
// onboarding; Netlify's geo header only pre-selects it.
export const POLICY_VERSION = '2026-11-27';

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

// Where data lives. The database is Neon in London (aws-eu-west-2). Netlify Blobs
// (sync queue, published boards, device removals) can't be in London, so it uses
// Frankfurt. Netlify Functions run in Ohio on the Free plan (region choice is Pro).
export const BLOBS_REGION = 'eu-central-1';

// Product limits, used by the API and shown in its messages.
export const LIMITS = {
  playersPerFamily: 6,
  devicesPerFamily: 5,
  openComplaints: 5,
  clockSkewMinutes: 10,          // rounds dated further ahead than this are refused
  syncBodyBytes: 96 * 1024,
  complaintBodyBytes: 8 * 1024,
  historyPageMax: 50,
  historyPageDefault: 20,
};

// Data protection regulator by the family's rules (shown with complaints).
const REGULATORS = {
  uk: "the Information Commissioner's Office (ICO)",
  ng: 'the Nigeria Data Protection Commission (NDPC)',
  eg: 'the Personal Data Protection Centre (PDPC)',
  us: 'the Federal Trade Commission (FTC)',
  eu: 'the data protection authority in your country',
};
export function regulatorFor(rules) {
  return REGULATORS[rules] || 'the data protection regulator where you live';
}

export function canJoinLeagues(child, consentState) {
  return LEAGUE_BANDS.has(child.age_band) && consentState?.public_leagues === true && consentState?.cloud_sync === true;
}
