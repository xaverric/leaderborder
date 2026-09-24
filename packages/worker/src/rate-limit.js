import { isLocalApp } from "./cookies.js";
import { HttpError } from "./http.js";

export const enforceLimit = async (limiter, key, env) => {
  if (!limiter) {
    if (env && !isLocalApp(env)) throw new HttpError(503, "unavailable", "Rate limiter unavailable");
    return;
  }
  if (!(await limiter.limit({ key })).success) {
    throw new HttpError(429, "rate_limited", "Too many requests, retry later", { "retry-after": "60" });
  }
};

export const limitRequest = async (request, env, pathname) => {
  const auth = pathname.startsWith("/auth/") || pathname === "/api/devices";
  if (!auth && !pathname.startsWith("/api/")) return;
  await enforceLimit(auth ? env.AUTH_LIMITER : env.API_LIMITER, request.headers.get("cf-connecting-ip") || "local", env);
};
