export const parseList = (value) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

export const needsOrgs = (env) => parseList(env.ALLOWED_GITHUB_ORGS).length > 0;

export const isPublic = (env) => env.PUBLIC_ACCESS === "1";

export const accessPolicy = (env) => {
  const orgs = [...new Set(parseList(env.ALLOWED_GITHUB_ORGS))].sort();
  const logins = [...new Set(parseList(env.ALLOWED_GITHUB_LOGINS))].sort();
  if (orgs.length || logins.length) return JSON.stringify({ orgs, logins });
  return isPublic(env) ? "public" : "";
};

export const loginAllowed = (login, env) => parseList(env.ALLOWED_GITHUB_LOGINS).includes(login.toLowerCase());

export const isAllowed = ({ login, orgs }, env) => {
  const allowedOrgs = parseList(env.ALLOWED_GITHUB_ORGS);
  const allowedLogins = parseList(env.ALLOWED_GITHUB_LOGINS);
  if (allowedOrgs.length === 0 && allowedLogins.length === 0) return isPublic(env);
  return loginAllowed(login, env) || orgs.some((org) => allowedOrgs.includes(org.toLowerCase()));
};


const GITHUB_ID = /^[1-9][0-9]{0,15}$/;

export const adminIds = (env) =>
  (env.ADMIN_GITHUB_IDS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => GITHUB_ID.test(item))
    .map(Number);

export const isAdmin = (githubId, env) => Number.isSafeInteger(githubId) && adminIds(env).includes(githubId);

export const EMPTY_RULES = Object.freeze({ public: false, logins: [], orgs: [] });

export const rulesAllow = ({ login, orgs = [] }, rules) =>
  rules.public || rules.logins.includes(login.toLowerCase()) || orgs.some((org) => rules.orgs.includes(org.toLowerCase()));

export const grantsAccess = (user, env, rules = EMPTY_RULES) =>
  isAdmin(user.githubId, env) || rulesAllow(user, rules) || isAllowed({ login: user.login, orgs: user.orgs ?? [] }, env);

export const needsOrgLookup = (env, rules = EMPTY_RULES) => needsOrgs(env) || rules.orgs.length > 0;

export const parseOrgs = (text) => {
  try {
    const value = JSON.parse(text ?? "[]");
    return Array.isArray(value) ? value.filter((org) => typeof org === "string") : [];
  } catch {
    return [];
  }
};

export const githubScope = (env, rules = EMPTY_RULES) => (needsOrgLookup(env, rules) ? "read:org" : "");
