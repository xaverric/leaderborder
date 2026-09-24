import { githubScope } from "../access.js";
import { json } from "../http.js";

const BUILD_PATTERN = /^[0-9a-f]{7,40}$/;

export const getConfig = ({ env }) =>
  json({
    githubClientId: env.GITHUB_CLIENT_ID ?? "",
    githubScope: githubScope(env),
    apiVersion: 1,
    build: BUILD_PATTERN.test(env.GIT_SHA ?? "") ? env.GIT_SHA : null,
  });
