const LOGIN = /^[A-Za-z0-9-]{1,39}$/;

const NOT_FOUND = { name: "not_found" };

const decode = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
};

const matchSegments = (segments) => {
  if (segments.length === 0) return { name: "leaderboard" };
  if (segments.length === 1 && segments[0] === "devices") return { name: "devices" };
  if (segments.length === 2 && segments[0] === "u") {
    const login = decode(segments[1]);
    return LOGIN.test(login) ? { name: "user", login } : NOT_FOUND;
  }
  return NOT_FOUND;
};

const split = (path) => path.split("/").filter(Boolean);

export const routeMode = (pathname) => (pathname === "/app" || pathname.startsWith("/app/") ? "path" : "hash");

export const parseRoute = (pathname, hash = "") => {
  if (routeMode(pathname) === "path") return matchSegments(split(pathname).slice(1));
  const raw = hash.replace(/^#/, "");
  if (raw.startsWith("/u/") && split(raw).length < 2) return NOT_FOUND;
  return matchSegments(split(raw));
};

const suffix = (route) => {
  if (route.name === "user") return `/u/${encodeURIComponent(route.login)}`;
  if (route.name === "devices") return "/devices";
  return "";
};

export const routeHref = (route, mode) => (mode === "path" ? `/app${suffix(route)}` : `#${suffix(route) || "/"}`);
