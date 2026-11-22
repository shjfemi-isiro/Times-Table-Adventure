export class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const BASE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
};

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...headers } });
}

export function errorResponse(err, log = console) {
  if (err instanceof HttpError) {
    return json({ error: err.code, message: err.message, ...(err.extra || {}) }, err.status);
  }
  log.error?.('unhandled', err);
  return json({ error: 'internal', message: 'Something went wrong. Please try again.' }, 500);
}

// Reads a JSON body with a hard size cap so a large request cannot cost compute.
export async function readJson(req, maxBytes = 64 * 1024) {
  const type = req.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new HttpError(415, 'unsupported_media_type', 'Send JSON.');
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new HttpError(413, 'too_large', 'Request is too large.');
  const text = await req.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new HttpError(413, 'too_large', 'Request is too large.');
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'bad_json', 'Body is not valid JSON.'); }
}

export function parseOrThrow(schema, value) {
  const r = schema.safeParse(value);
  if (!r.success) {
    const issues = r.error.issues.slice(0, 5).map(i => ({ path: i.path.join('.'), message: i.message }));
    throw new HttpError(422, 'invalid', 'Some details are not right.', { issues });
  }
  return r.data;
}
