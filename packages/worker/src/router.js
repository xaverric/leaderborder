const compile = (path) => {
  const keys = [];
  const source = path.replace(/:([A-Za-z]+)/g, (_, key) => {
    keys.push(key);
    return "([^/]+)";
  });
  return { pattern: new RegExp(`^${source}$`), keys };
};

const decodeParams = (values) => {
  try {
    return values.map(decodeURIComponent);
  } catch {
    return null;
  }
};

const methodMatches = (routeMethod, method) => routeMethod === method || (method === "HEAD" && routeMethod === "GET");

export const createRouter = (routes) => {
  const compiled = routes.map((route) => ({ ...route, ...compile(route.path) }));
  return (method, pathname) => {
    const candidates = compiled.filter((route) => route.pattern.test(pathname));
    if (candidates.length === 0) return { status: 404 };
    const route = candidates.find((candidate) => methodMatches(candidate.method, method));
    if (!route) return { status: 405, allow: [...new Set(candidates.map((candidate) => candidate.method))].join(", ") };
    const values = decodeParams(pathname.match(route.pattern).slice(1));
    if (!values) return { status: 404 };
    return { route, params: Object.fromEntries(route.keys.map((key, i) => [key, values[i]])) };
  };
};
