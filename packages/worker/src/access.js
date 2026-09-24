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

export const githubScope = (env) => (needsOrgs(env) ? "read:org" : "");
