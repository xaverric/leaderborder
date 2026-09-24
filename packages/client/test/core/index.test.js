import { test } from "node:test";
import assert from "node:assert/strict";
import * as core from "../../src/core/index.js";

const CONTRACT_FUNCTIONS = [
  "getConfig",
  "loadState",
  "saveState",
  "tokscaleBin",
  "runTokscale",
  "readGraph",
  "toUsageRows",
  "syncWindow",
  "summarize",
  "chunk",
  "createApi",
  "githubDeviceFlow",
  "login",
  "logout",
  "sync",
  "cursorStatus",
  "cursorLogin",
];

test("index exports every Contract 5 function", () => {
  CONTRACT_FUNCTIONS.forEach((name) => assert.equal(typeof core[name], "function", name));
});

test("index exports keychain and LeaderborderError", () => {
  ["getToken", "setToken", "deleteToken"].forEach((name) => assert.equal(typeof core.keychain[name], "function", name));
  assert.ok(new core.LeaderborderError("network", "x") instanceof Error);
});
