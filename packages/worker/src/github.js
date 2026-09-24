import { grantsAccess, isAdmin, isAllowed, loginAllowed, needsOrgLookup, rulesAllow } from "./access.js";
import { loadRules } from "./access-store.js";
import { HttpError } from "./http.js";
import { isGithubLogin } from "./validate.js";

const API = "https://api.github.com";

const githubFetch = (path, init) =>
  fetch(`${API}${path}`, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
    headers: { accept: "application/vnd.github+json", "user-agent": "leaderborder", ...init.headers },
  });

const githubGet = async (path, token) => {
  const response = await githubFetch(path, { headers: { authorization: `Bearer ${token}` } });
  if (response.status === 401) throw new HttpError(401, "unauthorized", "GitHub token rejected");
  if (!response.ok) throw new HttpError(500, "internal", `GitHub responded ${response.status}`);
  return response.json();
};

const checkAppToken = async (token, env) => {
  const response = await githubFetch(`/applications/${env.GITHUB_CLIENT_ID}/token`, {
    method: "POST",
    headers: { authorization: `Basic ${btoa(`${env.GITHUB_CLIENT_ID}:${env.GITHUB_CLIENT_SECRET}`)}`, "content-type": "application/json" },
    body: JSON.stringify({ access_token: token }),
  });
  if (response.status === 404) throw new HttpError(401, "unauthorized", "GitHub token rejected");
  if (!response.ok) throw new HttpError(500, "internal", `GitHub responded ${response.status}`);
  return response.json();
};

const avatarUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "avatars.githubusercontent.com" ? url.href : null;
  } catch {
    return null;
  }
};

const toProfile = (user) => {
  if (!Number.isSafeInteger(user?.id) || !isGithubLogin(user.login)) {
    throw new HttpError(500, "internal", "GitHub returned an unexpected user");
  }
  return { githubId: user.id, login: user.login, name: user.name || user.login, avatarUrl: avatarUrl(user.avatar_url) };
};

export const getGithubUser = async (token, env) => toProfile((await checkAppToken(token, env)).user);

export const getGithubOrgs = async (token) => {
  const orgs = [];
  for (let page = 1; page <= 100; page++) {
    const batch = await githubGet(`/user/orgs?per_page=100${page === 1 ? "" : `&page=${page}`}`, token);
    orgs.push(...batch.map((org) => org.login));
    if (batch.length < 100) return orgs;
  }
  throw new HttpError(503, "unavailable", "GitHub organization lookup exceeded its limit");
};

const allowedWithoutOrgs = ({ githubId, login }, env, rules) =>
  isAdmin(githubId, env) || rulesAllow({ login, orgs: [] }, rules) || loginAllowed(login, env) || isAllowed({ login, orgs: [] }, env);

export const resolveGithubAccess = async (token, env, rules) => {
  const current = rules ?? (await loadRules(env.DB));
  const profile = await getGithubUser(token, env);
  const orgs = needsOrgLookup(env, current) && !allowedWithoutOrgs(profile, env, current) ? await getGithubOrgs(token) : null;
  return { profile, orgs, allowed: grantsAccess({ githubId: profile.githubId, login: profile.login, orgs: orgs ?? [] }, env, current) };
};

export const exchangeCode = async ({ code, verifier, redirectUri, env }) => {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
    headers: { accept: "application/json", "content-type": "application/json", "user-agent": "leaderborder" },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, code_verifier: verifier, redirect_uri: redirectUri }),
  });
  if (!response.ok) return null;
  const data = await response.json();
  return typeof data.access_token === "string" ? data.access_token : null;
};
