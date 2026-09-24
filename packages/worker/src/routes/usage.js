import { requireBearer } from "../auth.js";
import { HttpError, json } from "../http.js";
import { upsertUsage } from "../queries.js";
import { validateUsageBody } from "../validate.js";

const withinLimit = async (limiter, key) => !limiter || (await limiter.limit({ key })).success;

export const putUsage = async ({ request, env, body, now }) => {
  const auth = await requireBearer(request, env);
  if (!(await withinLimit(env.USAGE_LIMITER, auth.token_hash))) throw new HttpError(429, "rate_limited", "Too many uploads, retry later");
  const invalid = validateUsageBody(body, now);
  if (invalid) throw new HttpError(400, "invalid_request", invalid);
  if (body.deviceId.toLowerCase() !== auth.device_id) throw new HttpError(403, "forbidden", "Token does not belong to this device");
  await upsertUsage(env.DB, { deviceId: auth.device_id, tokenId: auth.token_id, rows: body.rows, nowIso: now.toISOString() });
  return json({ upserted: body.rows.length });
};
