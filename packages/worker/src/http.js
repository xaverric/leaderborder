export const MAX_BODY_BYTES = 512 * 1024;

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
};

export class HttpError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export const json = (data, { status = 200, headers = {} } = {}) =>
  Response.json(data, { status, headers: { "cache-control": "no-store", ...headers } });

export const errorResponse = (status, code, message, headers = {}) => json({ error: { code, message } }, { status, headers });

const withNoStore = (headers) => {
  headers.set("cache-control", "no-store");
  return headers;
};

export const noContent = (headers = new Headers()) => new Response(null, { status: 204, headers: withNoStore(headers) });

export const redirect = (location, cookies = []) => {
  const headers = new Headers({ location });
  cookies.forEach((cookie) => headers.append("set-cookie", cookie));
  return new Response(null, { status: 302, headers: withNoStore(headers) });
};

const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const htmlPage = (status, title, message) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} - leaderborder</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p><a href="/">Back to leaderborder</a></p></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );

const isJsonType = (value) => /^application\/json\s*(;|$)/i.test(value ?? "");

export const readJsonBody = async (request) => {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) throw new HttpError(413, "invalid_request", "Body too large");
  if (!isJsonType(request.headers.get("content-type"))) throw new HttpError(400, "invalid_request", "Content-Type must be application/json");
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > MAX_BODY_BYTES) throw new HttpError(413, "invalid_request", "Body too large");
  try {
    return JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    throw new HttpError(400, "invalid_request", "Invalid JSON body");
  }
};

export const withSecurityHeaders = (response) => {
  const secured = new Response(response.body, response);
  Object.entries(SECURITY_HEADERS).forEach(([name, value]) => secured.headers.set(name, value));
  return secured;
};

export const toErrorResponse = (error) => {
  if (error instanceof HttpError) return errorResponse(error.status, error.code, error.message, error.headers);
  console.error(error);
  return errorResponse(500, "internal", "Internal error");
};
