import { isAdmin } from "../access.js";
import { addRule, adminOverview, approveRequest, deleteRule, denyRequest, setBlocked, setPublicAccess, toRule } from "../access-store.js";
import { assertSameOrigin, requireCookieUser } from "../auth.js";
import { HttpError, json, noContent } from "../http.js";
import { getUserByLogin } from "../queries.js";
import { isGithubLogin } from "../validate.js";

const RULE_KINDS = new Set(["login", "org"]);

const requireAdmin = async (context) => {
  const user = await requireCookieUser(context.request, context.env, context.now);
  if (!isAdmin(user.github_id, context.env)) throw new HttpError(403, "forbidden", "Admin only");
  return user;
};

const requireAdminChange = async (context) => {
  const user = await requireAdmin(context);
  assertSameOrigin(context.request);
  return user;
};

const loginParam = (value) => {
  if (!isGithubLogin(value)) throw new HttpError(400, "invalid_request", "login: invalid GitHub login");
  return value;
};

const notFound = (what) => new HttpError(404, "not_found", `${what} not found`);

export const getAdminOverview = async (context) => {
  await requireAdmin(context);
  return json(await adminOverview(context.env.DB, context.env));
};

export const postAdminRule = async (context) => {
  const admin = await requireAdminChange(context);
  const { kind, value } = context.body ?? {};
  if (!RULE_KINDS.has(kind)) throw new HttpError(400, "invalid_request", "kind: must be login or org");
  if (!isGithubLogin(value)) throw new HttpError(400, "invalid_request", "value: invalid GitHub login or organization");
  const rule = await addRule(context.env.DB, { kind, value, nowIso: context.now.toISOString(), createdBy: admin.login });
  return json(toRule(rule), { status: 201 });
};

export const deleteAdminRule = async (context) => {
  await requireAdminChange(context);
  const id = Number(context.params.id);
  if (!Number.isSafeInteger(id) || !(await deleteRule(context.env.DB, id))) throw notFound("Rule");
  return noContent();
};

export const postApproveRequest = async (context) => {
  const admin = await requireAdminChange(context);
  const approved = await approveRequest(context.env.DB, { login: loginParam(context.params.login), nowIso: context.now.toISOString(), createdBy: admin.login });
  if (!approved) throw notFound("Request");
  return noContent();
};

export const postDenyRequest = async (context) => {
  await requireAdminChange(context);
  if (!(await denyRequest(context.env.DB, loginParam(context.params.login)))) throw notFound("Request");
  return noContent();
};

const blockHandler = (blocked) => async (context) => {
  await requireAdminChange(context);
  const login = loginParam(context.params.login);
  const target = await getUserByLogin(context.env.DB, login);
  if (!target) throw notFound("User");
  if (blocked && isAdmin(target.github_id, context.env)) throw new HttpError(400, "invalid_request", "The admin cannot be blocked");
  if (!(await setBlocked(context.env.DB, { login, blocked, nowIso: context.now.toISOString() }))) throw notFound("User");
  return noContent();
};

export const postBlockUser = blockHandler(true);

export const postUnblockUser = blockHandler(false);

export const putAdminSettings = async (context) => {
  await requireAdminChange(context);
  const { publicAccess } = context.body ?? {};
  if (typeof publicAccess !== "boolean") throw new HttpError(400, "invalid_request", "publicAccess: must be a boolean");
  await setPublicAccess(context.env.DB, publicAccess);
  return json({ publicAccess });
};
