// Reads configuration from Netlify's runtime when present, else process.env (tests, scripts).
export function env(name, fallback) {
  const v = globalThis.Netlify?.env?.get?.(name) ?? process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

export function requireEnv(name) {
  const v = env(name);
  if (v === undefined) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const APP_VERSION = env('COMMIT_REF', 'dev').slice(0, 12);
