const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;

export const githubProfileUrl = (login) =>
  typeof login === "string" && LOGIN.test(login) && !login.endsWith("-") ? `https://github.com/${login}` : null;
