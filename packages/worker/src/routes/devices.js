import { resolveGithubAccess } from "../github.js";
import { HttpError, json } from "../http.js";
import { getDevice, registerDevice, toUser, upsertUser } from "../queries.js";
import { createDeviceToken, hashToken } from "../tokens.js";
import { validateDeviceBody } from "../validate.js";

export const postDevice = async ({ env, body, now }) => {
  const invalid = validateDeviceBody(body);
  if (invalid) throw new HttpError(400, "invalid_request", invalid);
  const { profile, allowed } = await resolveGithubAccess(body.githubToken, env);
  if (!allowed) throw new HttpError(403, "forbidden", "GitHub account is not allowed");
  const nowIso = now.toISOString();
  const user = await upsertUser(env.DB, profile, nowIso);
  const deviceId = body.deviceId.toLowerCase();
  const existing = await getDevice(env.DB, deviceId);
  if (existing && existing.user_id !== user.id) throw new HttpError(403, "forbidden", "Device belongs to another user");
  const token = createDeviceToken();
  await registerDevice(env.DB, { deviceId, userId: user.id, name: body.deviceName.trim(), tokenHash: await hashToken(token), nowIso });
  return json({ token, deviceId, user: toUser(user) }, { status: 201 });
};
