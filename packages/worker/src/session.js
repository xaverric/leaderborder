import { base64urlDecode, base64urlEncode, fromUtf8, utf8 } from "./encoding.js";

export const SESSION_COOKIE = "lb_session";
export const STATE_COOKIE = "lb_oauth_state";
export const SESSION_MAX_AGE = 2592000;
export const STATE_MAX_AGE = 600;

const hmacKey = (secret) =>
  crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

export const signValue = async (payload, secret) => {
  if (!secret) throw new Error("missing secret");
  const body = base64urlEncode(utf8(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), utf8(body));
  return `${body}.${base64urlEncode(signature)}`;
};

const parsePayload = (bytes) => {
  try {
    const value = JSON.parse(fromUtf8(bytes));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
};

export const verifyValue = async (value, secret, nowSec) => {
  if (!secret || typeof value !== "string") return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const signature = base64urlDecode(sig);
  const bytes = base64urlDecode(body);
  if (!body || !signature || !bytes) return null;
  const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), signature, utf8(body));
  if (!valid) return null;
  const payload = parsePayload(bytes);
  if (!payload || !Number.isFinite(payload.exp) || payload.exp <= nowSec) return null;
  return payload;
};
