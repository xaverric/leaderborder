import { errorResponse, readJsonBody, toErrorResponse, withSecurityHeaders } from "./http.js";
import { createRouter } from "./router.js";
import { isAppPath, serveApp } from "./routes/app.js";
import { getConfig } from "./routes/config.js";
import { postDevice } from "./routes/devices.js";
import { getLeaderboard } from "./routes/leaderboard.js";
import { deleteMyDevice, getMe } from "./routes/me.js";
import { getPublicStats } from "./routes/stats.js";
import { putUsage } from "./routes/usage.js";
import { getUserDetail } from "./routes/users.js";
import { devLogin, finishGithubLogin, logout, startGithubLogin } from "./routes/web-auth.js";

const routes = [
  { method: "GET", path: "/api/config", handler: getConfig },
  { method: "POST", path: "/api/devices", handler: postDevice, body: true },
  { method: "PUT", path: "/api/usage", handler: putUsage, body: true },
  { method: "GET", path: "/api/me", handler: getMe },
  { method: "DELETE", path: "/api/me/devices/:id", handler: deleteMyDevice },
  { method: "GET", path: "/api/leaderboard", handler: getLeaderboard },
  { method: "GET", path: "/api/users/:login", handler: getUserDetail },
  { method: "GET", path: "/api/public/stats", handler: getPublicStats },
  { method: "GET", path: "/auth/github", handler: startGithubLogin },
  { method: "GET", path: "/auth/github/callback", handler: finishGithubLogin },
  { method: "GET", path: "/auth/dev", handler: devLogin },
  { method: "POST", path: "/auth/logout", handler: logout },
];

const match = createRouter(routes);

const isWorkerPath = (pathname) => /^\/(api|auth)(\/|$)/.test(pathname);

const handle = async (request, env) => {
  const url = new URL(request.url);
  if (isAppPath(url.pathname)) return serveApp(request, env);
  const found = match(request.method, url.pathname);
  if (found.status === 404) return isWorkerPath(url.pathname) ? errorResponse(404, "not_found", "Not found") : env.ASSETS.fetch(request);
  if (found.status === 405) return errorResponse(405, "invalid_request", "Method not allowed", { allow: found.allow });
  const body = found.route.body ? await readJsonBody(request) : undefined;
  return found.route.handler({ request, env, url, params: found.params, body, now: new Date() });
};

export default {
  async fetch(request, env) {
    const response = await handle(request, env).catch(toErrorResponse);
    return withSecurityHeaders(response);
  },
};
