import { requireBearer } from "../auth.js";
import { HttpError, json } from "../http.js";
import { upsertUsage, usageCardinality } from "../queries.js";
import { enforceLimit } from "../rate-limit.js";
import { validateUsageBody } from "../validate.js";

export const MAX_PAIRS_PER_DEVICE = 300;
export const MAX_ROWS_PER_DEVICE = 200000;

const pairKey = (row) => `${row.client}\u0000${row.model}`;

export const putUsage = async ({ request, env, body, now }) => {
  const auth = await requireBearer(request, env, now);
  await enforceLimit(env.USAGE_LIMITER, auth.device_id, env);
  await enforceLimit(env.USAGE_LIMITER, `user:${auth.id}`, env);
  const invalid = validateUsageBody(body, now);
  if (invalid) throw new HttpError(400, "invalid_request", invalid);
  if (body.deviceId.toLowerCase() !== auth.device_id) throw new HttpError(403, "forbidden", "Token does not belong to this device");
  const existing = await usageCardinality(env.DB, auth.device_id);
  const pairs = new Set([...existing.pairs, ...body.rows.map(pairKey)]);
  if (pairs.size > MAX_PAIRS_PER_DEVICE) {
    throw new HttpError(400, "invalid_request", `rows: more than ${MAX_PAIRS_PER_DEVICE} distinct client and model combinations for this device`);
  }
  if (existing.total + body.rows.length > MAX_ROWS_PER_DEVICE) throw new HttpError(400, "invalid_request", "rows: device storage quota exceeded");
  const results = await upsertUsage(env.DB, { deviceId: auth.device_id, tokenId: auth.token_id, rows: body.rows, nowIso: now.toISOString() });
  if (results[0].meta.changes !== 1) throw new HttpError(401, "unauthorized", "Device token revoked");
  return json({ upserted: body.rows.length });
};
