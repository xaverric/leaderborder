import { createMockApi } from "./mock-data.js";

const STORAGE_KEY = "lb_mock";
const MODES = ["1", "anon", "fail"];

const readStorage = () => {
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
};

const writeStorage = (value) => {
  try {
    if (value) sessionStorage.setItem(STORAGE_KEY, value);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    return;
  }
};

const resolveMockMode = () => {
  if (!["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) return "";
  const param = new URLSearchParams(location.search).get("mock");
  if (param === "0") writeStorage("");
  else if (MODES.includes(param)) writeStorage(param);
  return MODES.includes(param) ? param : param === "0" ? "" : readStorage();
};

const mode = resolveMockMode();

export const mockMode = () => mode;

export const isMock = () => mode !== "";

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let mockApi = null;

const getMock = () => {
  if (!mockApi) {
    mockApi = createMockApi({ now: new Date() });
    if (mode === "anon") mockApi.signOut();
  }
  return mockApi;
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const mockRequest = async (method, path) => {
  await wait(260 + Math.random() * 280);
  if (mode === "fail") throw new ApiError(500, "internal", "The mock backend is set to fail.");
  const { status, body } = getMock().handle(method, path);
  if (status >= 400) throw new ApiError(status, body.error.code, body.error.message);
  return body;
};

const networkRequest = async (method, path) => {
  let response;
  try {
    response = await fetch(path, { method, credentials: "same-origin", headers: { accept: "application/json" } });
  } catch {
    throw new ApiError(0, "network", "Could not reach leaderborder. Check your connection and try again.");
  }
  if (response.status === 204) return null;
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, body?.error?.code ?? "internal", body?.error?.message ?? `The server answered ${response.status}.`);
  }
  return body;
};

const request = (method, path) => (isMock() ? mockRequest(method, path) : networkRequest(method, path));

export const api = {
  get: (path) => request("GET", path),
  post: (path) => request("POST", path),
  del: (path) => request("DELETE", path),
};

export const signInHref = (next) => (isMock() ? `/app.html?mock=1${next.includes("#") ? next.slice(next.indexOf("#")) : ""}` : `/auth/github?next=${encodeURIComponent(next)}`);
