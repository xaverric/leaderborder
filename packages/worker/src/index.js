import { hasBearerFormat } from "./auth.js";
import { isLocalApp } from "./cookies.js";
import { HttpError, errorResponse, readJsonBody, redirect, toErrorResponse, withSecurityHeaders } from "./http.js";
import { createRouter } from "./router.js";
import { limitRequest } from "./rate-limit.js";
import { deleteAdminRule, getAdminOverview, postAdminRule, postApproveRequest, postBlockUser, postDenyRequest, postUnblockUser, putAdminSettings } from "./routes/admin.js";
import { isAppPath, serveApp } from "./routes/app.js";
import { getConfig } from "./routes/config.js";
import { postDevice } from "./routes/devices.js";
import { getLeaderboard } from "./routes/leaderboard.js";
import { deleteMe, deleteMyDevice, getMe } from "./routes/me.js";
import { getPublicStats } from "./routes/stats.js";
import { putUsage } from "./routes/usage.js";
import { getUserDetail } from "./routes/users.js";
import { devLogin, finishGithubLogin, logout, startGithubLogin } from "./routes/web-auth.js";

const routes = [
  { method: "GET", path: "/api/config", handler: getConfig },
  { method: "POST", path: "/api/devices", handler: postDevice, body: true },
  { method: "PUT", path: "/api/usage", handler: putUsage, body: true, bearer: true },
  { method: "GET", path: "/api/me", handler: getMe },
  { method: "DELETE", path: "/api/me", handler: deleteMe },
  { method: "DELETE", path: "/api/me/devices/:id", handler: deleteMyDevice },
  { method: "GET", path: "/api/leaderboard", handler: getLeaderboard },
  { method: "GET", path: "/api/users/:login", handler: getUserDetail },
  { method: "GET", path: "/api/public/stats", handler: getPublicStats },
  { method: "GET", path: "/api/admin/overview", handler: getAdminOverview },
  { method: "POST", path: "/api/admin/rules", handler: postAdminRule, body: true },
  { method: "DELETE", path: "/api/admin/rules/:id", handler: deleteAdminRule },
  { method: "POST", path: "/api/admin/requests/:login/approve", handler: postApproveRequest },
  { method: "POST", path: "/api/admin/requests/:login/deny", handler: postDenyRequest },
  { method: "POST", path: "/api/admin/users/:login/block", handler: postBlockUser },
  { method: "POST", path: "/api/admin/users/:login/unblock", handler: postUnblockUser },
  { method: "PUT", path: "/api/admin/settings", handler: putAdminSettings, body: true },
  { method: "GET", path: "/auth/github", handler: startGithubLogin },
  { method: "GET", path: "/auth/github/callback", handler: finishGithubLogin },
  { method: "GET", path: "/auth/dev", handler: devLogin },
  { method: "POST", path: "/auth/logout", handler: logout },
];

const match = createRouter(routes);

const isWorkerPath = (pathname) => /^\/(api|auth)(\/|$)/.test(pathname);

const httpsUrl = (url) => {
  const secure = new URL(url);
  secure.protocol = "https:";
  return secure.href;
};

const handle = async (request, env, ctx) => {
  const url = new URL(request.url);
  if (url.protocol === "http:" && !isLocalApp(env)) return redirect(httpsUrl(url), [], 301);
  await limitRequest(request, env, url.pathname);
  if (isAppPath(url.pathname)) return serveApp(request, env);
  const found = match(request.method, url.pathname);
  if (found.status === 404) return isWorkerPath(url.pathname) ? errorResponse(404, "not_found", "Not found") : env.ASSETS.fetch(request);
  if (found.status === 405) return errorResponse(405, "invalid_request", "Method not allowed", { allow: found.allow });
  if (found.route.bearer && !hasBearerFormat(request)) throw new HttpError(401, "unauthorized", "Authentication required");
  const body = found.route.body ? await readJsonBody(request) : undefined;
  return found.route.handler({ request, env, url, params: found.params, body, now: new Date(), ctx });
};

export default {
  async fetch(request, env, ctx) {
    const response = await handle(request, env, ctx).catch(toErrorResponse);
    const secured = withSecurityHeaders(response, request);
    return request.method === "HEAD" ? new Response(null, secured) : secured;
  },
};
