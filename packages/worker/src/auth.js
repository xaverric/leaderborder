import { parseCookies } from "./cookies.js";
import { HttpError } from "./http.js";
import { findTokenAuth, getUserById } from "./queries.js";
import { SESSION_COOKIE, verifyValue } from "./session.js";
import { hashToken, isDeviceTokenFormat } from "./tokens.js";

const unauthorized = () => new HttpError(401, "unauthorized", "Authentication required");

export const sessionUser = async (request, env, now) => {
  const cookie = parseCookies(request.headers.get("cookie"))[SESSION_COOKIE];
  const payload = await verifyValue(cookie, env.SESSION_SECRET, Math.floor(now.getTime() / 1000));
  return Number.isSafeInteger(payload?.uid) ? getUserById(env.DB, payload.uid) : null;
};

const bearerToken = (request) => request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];

export const bearerAuth = async (request, env) => {
  const token = bearerToken(request);
  if (!isDeviceTokenFormat(token)) return null;
  return findTokenAuth(env.DB, await hashToken(token));
};

export const requireCookieUser = async (request, env, now) => {
  const user = await sessionUser(request, env, now);
  if (!user) throw unauthorized();
  return user;
};

export const requireBearer = async (request, env) => {
  const auth = await bearerAuth(request, env);
  if (!auth) throw unauthorized();
  return auth;
};

export const requireAnyUser = async (request, env, now) => {
  const user = bearerToken(request) ? await bearerAuth(request, env) : await sessionUser(request, env, now);
  if (!user) throw unauthorized();
  return user;
};

export const assertSameOrigin = (request) => {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, "forbidden", "Cross-origin request rejected");
};
