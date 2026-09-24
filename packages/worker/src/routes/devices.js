import { accessPolicy } from "../access.js";
import { clearAccessRequest, recordAccessRequest, saveUserOrgs } from "../access-store.js";
import { resolveGithubAccess } from "../github.js";
import { HttpError, json } from "../http.js";
import { countActiveDevices, getDevice, registerDevice, toUser, upsertUser } from "../queries.js";
import { enforceLimit } from "../rate-limit.js";
import { createDeviceToken, hashToken } from "../tokens.js";
import { validateDeviceBody } from "../validate.js";

export const MAX_DEVICES_PER_USER = 10;
export const TOKEN_TTL_MS = 90 * 86400000;

export const postDevice = async ({ env, body, now }) => {
  const invalid = validateDeviceBody(body);
  if (invalid) throw new HttpError(400, "invalid_request", invalid);
  const { profile, orgs, allowed } = await resolveGithubAccess(body.githubToken, env);
  if (!allowed) {
    await recordAccessRequest(env.DB, profile, now.toISOString());
    throw new HttpError(403, "forbidden", "GitHub account is not on the leaderboard yet, access requested from the admin");
  }
  await enforceLimit(env.AUTH_LIMITER, `github:${profile.githubId}`, env);
  const nowIso = now.toISOString();
  const user = await upsertUser(env.DB, profile, nowIso);
  if (user.blocked_at) throw new HttpError(403, "forbidden", "GitHub account is blocked");
  if (orgs) await saveUserOrgs(env.DB, user.id, orgs);
  await clearAccessRequest(env.DB, profile.githubId);
  const deviceId = body.deviceId.toLowerCase();
  const existing = await getDevice(env.DB, deviceId);
  if (existing && existing.user_id !== user.id) throw new HttpError(403, "forbidden", "Device belongs to another user");
  if ((!existing || existing.revoked_at) && (await countActiveDevices(env.DB, user.id)) >= MAX_DEVICES_PER_USER) {
    throw new HttpError(403, "forbidden", `Too many devices, revoke one first (limit ${MAX_DEVICES_PER_USER})`);
  }
  const token = createDeviceToken();
  const [, , inserted] = await registerDevice(env.DB, {
    deviceId, userId: user.id, name: body.deviceName.trim(), tokenHash: await hashToken(token), nowIso, accessPolicy: accessPolicy(env),
    expiresAt: new Date(now.getTime() + TOKEN_TTL_MS).toISOString(),
  });
  if (inserted.meta.changes !== 1) throw new HttpError(403, "forbidden", "Device belongs to another user");
  return json({ token, deviceId, user: toUser(user) }, { status: 201 });
};
