import { assertSameOrigin } from "../auth.js";
import { parseCookies, serializeCookie } from "../cookies.js";
import { base64urlEncode } from "../encoding.js";
import { exchangeCode, resolveGithubAccess } from "../github.js";
import { HttpError, htmlPage, noContent, redirect } from "../http.js";
import { upsertDevUser, upsertUser } from "../queries.js";
import { SESSION_COOKIE, SESSION_MAX_AGE, STATE_COOKIE, STATE_MAX_AGE, signValue, verifyValue } from "../session.js";
import { safeNext } from "../validate.js";

const LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

const secureCookies = (env) => !String(env.APP_URL ?? "").startsWith("http://");

const cookie = (env, name, value, { maxAge, path = "/" }) =>
  serializeCookie(name, value, { maxAge, path, httpOnly: true, secure: secureCookies(env), sameSite: "Lax" });

const nowSeconds = (now) => Math.floor(now.getTime() / 1000);

const callbackUrl = (env) => `${env.APP_URL}/auth/github/callback`;

const sessionCookie = async (env, userId, now) =>
  cookie(env, SESSION_COOKIE, await signValue({ uid: userId, exp: nowSeconds(now) + SESSION_MAX_AGE }, env.SESSION_SECRET), {
    maxAge: SESSION_MAX_AGE,
  });

const clearStateCookie = (env) => cookie(env, STATE_COOKIE, "", { maxAge: 0, path: "/auth" });

export const startGithubLogin = async ({ env, url, now }) => {
  if (!env.GITHUB_CLIENT_ID) throw new HttpError(500, "internal", "GitHub login is not configured");
  const state = base64urlEncode(crypto.getRandomValues(new Uint8Array(24)));
  const next = safeNext(url.searchParams.get("next") ?? undefined);
  const signed = await signValue({ state, next, exp: nowSeconds(now) + STATE_MAX_AGE }, env.SESSION_SECRET);
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.search = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: callbackUrl(env), scope: "read:org", state }).toString();
  return redirect(authorize.href, [cookie(env, STATE_COOKIE, signed, { maxAge: STATE_MAX_AGE, path: "/auth" })]);
};

const loginFailed = () => htmlPage(400, "Login failed", "The GitHub login expired or was interrupted. Please try again.");

const githubAccess = (token, env) => resolveGithubAccess(token, env).catch(() => null);

export const finishGithubLogin = async ({ request, env, url, now }) => {
  const saved = await verifyValue(parseCookies(request.headers.get("cookie"))[STATE_COOKIE], env.SESSION_SECRET, nowSeconds(now));
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!saved || !state || saved.state !== state || !code) return loginFailed();
  const token = await exchangeCode({ code, redirectUri: callbackUrl(env), env });
  const access = token ? await githubAccess(token, env) : null;
  if (!access) return loginFailed();
  if (!access.allowed) {
    const page = htmlPage(403, "Not allowed", "This GitHub account is not allowed to join this leaderboard.");
    page.headers.append("set-cookie", clearStateCookie(env));
    return page;
  }
  const user = await upsertUser(env.DB, access.profile, now.toISOString());
  return redirect(safeNext(saved.next), [await sessionCookie(env, user.id, now), clearStateCookie(env)]);
};

const devLoginEnabled = (env) => {
  if (env.DEV_LOGIN !== "1") return false;
  try {
    const appUrl = new URL(env.APP_URL);
    return appUrl.protocol === "http:" && appUrl.hostname === "localhost";
  } catch {
    return false;
  }
};

export const devLogin = async ({ env, url, now }) => {
  if (!devLoginEnabled(env)) throw new HttpError(404, "not_found", "Not found");
  const login = url.searchParams.get("login") ?? "";
  if (!LOGIN_PATTERN.test(login)) throw new HttpError(400, "invalid_request", "login: invalid GitHub login");
  const user = await upsertDevUser(env.DB, login, now.toISOString());
  return redirect(safeNext(url.searchParams.get("next") ?? undefined), [await sessionCookie(env, user.id, now)]);
};

export const logout = ({ request, env }) => {
  assertSameOrigin(request);
  return noContent(new Headers({ "set-cookie": cookie(env, SESSION_COOKIE, "", { maxAge: 0 }) }));
};
