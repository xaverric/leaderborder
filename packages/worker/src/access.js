export const parseList = (value) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

export const needsOrgs = (env) => parseList(env.ALLOWED_GITHUB_ORGS).length > 0;

export const loginAllowed = (login, env) => parseList(env.ALLOWED_GITHUB_LOGINS).includes(login.toLowerCase());

export const isAllowed = ({ login, orgs }, env) => {
  const allowedOrgs = parseList(env.ALLOWED_GITHUB_ORGS);
  const allowedLogins = parseList(env.ALLOWED_GITHUB_LOGINS);
  if (allowedOrgs.length === 0 && allowedLogins.length === 0) return true;
  return loginAllowed(login, env) || orgs.some((org) => allowedOrgs.includes(org.toLowerCase()));
};
