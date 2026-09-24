import { accessPolicy } from "./access.js";
import { cookieName, parseCookies } from "./cookies.js";
import { HttpError } from "./http.js";
import { findTokenAuth } from "./queries.js";
import { SESSION_COOKIE, findSessionUser, verifyValue } from "./session.js";
import { hashToken, isDeviceTokenFormat } from "./tokens.js";

const unauthorized = () => new HttpError(401, "unauthorized", "Authentication required");

export const sessionUser = async (request, env, now) => {
  const cookie = parseCookies(request.headers.get("cookie"))[cookieName(SESSION_COOKIE, env)];
  const payload = await verifyValue(cookie, env.SESSION_SECRET, Math.floor(now.getTime() / 1000), "session");
  return findSessionUser(env, payload, Math.floor(now.getTime() / 1000));
};

const bearerToken = (request) => request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];

export const hasBearerFormat = (request) => isDeviceTokenFormat(bearerToken(request));

export const bearerAuth = async (request, env, now) => {
  const token = bearerToken(request);
  if (!isDeviceTokenFormat(token)) return null;
  const auth = await findTokenAuth(env.DB, await hashToken(token), now.toISOString());
  return auth?.access_policy === accessPolicy(env) ? auth : null;
};

export const requireCookieUser = async (request, env, now) => {
  const user = await sessionUser(request, env, now);
  if (!user) throw unauthorized();
  return user;
};

export const requireBearer = async (request, env, now) => {
  const auth = await bearerAuth(request, env, now);
  if (!auth) throw unauthorized();
  return auth;
};

export const requireAnyUser = async (request, env, now) => {
  const user = bearerToken(request) ? await bearerAuth(request, env, now) : await sessionUser(request, env, now);
  if (!user) throw unauthorized();
  return user;
};

export const assertSameOrigin = (request) => {
  const origin = request.headers.get("origin");
  const sameOrigin = origin === new URL(request.url).origin || (!origin && request.headers.get("sec-fetch-site") === "same-origin");
  if (!sameOrigin) throw new HttpError(403, "forbidden", "Cross-origin request rejected");
};
