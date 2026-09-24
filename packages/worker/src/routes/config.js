import { json } from "../http.js";

export const getConfig = ({ env }) => json({ githubClientId: env.GITHUB_CLIENT_ID ?? "", apiVersion: 1 });
