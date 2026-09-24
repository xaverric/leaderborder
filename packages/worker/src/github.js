import { isAllowed, loginAllowed, needsOrgs } from "./access.js";
import { HttpError } from "./http.js";

const API = "https://api.github.com";

const githubGet = async (path, token) => {
  const response = await fetch(`${API}${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "leaderborder" },
  });
  if (response.status === 401) throw new HttpError(401, "unauthorized", "GitHub token rejected");
  if (!response.ok) throw new HttpError(500, "internal", `GitHub responded ${response.status}`);
  return response.json();
};

const toProfile = (user) => ({
  githubId: user.id,
  login: user.login,
  name: user.name || user.login,
  avatarUrl: user.avatar_url ?? null,
});

export const getGithubUser = async (token) => toProfile(await githubGet("/user", token));

export const getGithubOrgs = async (token) => (await githubGet("/user/orgs?per_page=100", token)).map((org) => org.login);

export const resolveGithubAccess = async (token, env) => {
  const profile = await getGithubUser(token);
  const orgs = needsOrgs(env) && !loginAllowed(profile.login, env) ? await getGithubOrgs(token) : [];
  return { profile, allowed: isAllowed({ login: profile.login, orgs }, env) };
};

export const exchangeCode = async ({ code, redirectUri, env }) => {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "user-agent": "leaderborder" },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: redirectUri }),
  });
  if (!response.ok) return null;
  const data = await response.json();
  return typeof data.access_token === "string" ? data.access_token : null;
};
