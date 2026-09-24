import { githubScope } from "../access.js";
import { loadRules } from "../access-store.js";
import { json } from "../http.js";

const BUILD_PATTERN = /^[0-9a-f]{7,40}$/;

export const getConfig = async ({ env }) =>
  json({
    githubClientId: env.GITHUB_CLIENT_ID ?? "",
    githubScope: githubScope(env, await loadRules(env.DB)),
    apiVersion: 1,
    build: BUILD_PATTERN.test(env.GIT_SHA ?? "") ? env.GIT_SHA : null,
  });
