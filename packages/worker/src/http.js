export const MAX_BODY_BYTES = 512 * 1024;

export const CONTENT_SECURITY_POLICY = "default-src 'none'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; img-src 'self' data: https://avatars.githubusercontent.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'";

export const STRICT_TRANSPORT_SECURITY = "max-age=31536000; includeSubDomains";

export const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "content-security-policy": CONTENT_SECURITY_POLICY,
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
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

export const redirect = (location, cookies = [], status = 302) => {
  const headers = new Headers({ location });
  cookies.forEach((cookie) => headers.append("set-cookie", cookie));
  return new Response(null, { status, headers: withNoStore(headers) });
};

const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const htmlPage = (status, title, message) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} - leaderborder</title><link rel="stylesheet" href="/css/base.css"></head><body><main class="page-message"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p><a href="/">Back to leaderborder</a></p></main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );

const isJsonType = (value) => /^application\/json\s*(;|$)/i.test(value ?? "");

export const readJsonBody = async (request) => {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) throw new HttpError(413, "invalid_request", "Body too large");
  if (!isJsonType(request.headers.get("content-type"))) throw new HttpError(400, "invalid_request", "Content-Type must be application/json");
  const reader = request.body?.getReader();
  const chunks = [];
  let size = 0;
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) {
          await reader.cancel();
          throw new HttpError(413, "invalid_request", "Body too large");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    throw new HttpError(400, "invalid_request", "Invalid JSON body");
  }
};

export const withSecurityHeaders = (response, request) => {
  const secured = new Response(response.body, response);
  Object.entries(SECURITY_HEADERS).forEach(([name, value]) => secured.headers.set(name, value));
  if (request && new URL(request.url).protocol === "https:") secured.headers.set("strict-transport-security", STRICT_TRANSPORT_SECURITY);
  return secured;
};

export const toErrorResponse = (error) => {
  if (error instanceof HttpError) return errorResponse(error.status, error.code, error.message, error.headers);
  console.error("Unhandled worker error", error?.name ?? "Error", error?.message ?? "");
  return errorResponse(500, "internal", "Internal error");
};
