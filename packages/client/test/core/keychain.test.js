import { test } from "node:test";
import assert from "node:assert/strict";
import { createKeychain } from "../../src/core/keychain.js";

const token = `lb_${"A1b2_-".repeat(7)}x`;

const recorder = (results = []) => {
  const calls = [];
  const queue = [...results];
  const exec = async (args, options = {}) => {
    calls.push({ args, input: options.input });
    return queue.shift() ?? { code: 0, stdout: "", stderr: "" };
  };
  return { exec, calls };
};

test("getToken reads the leaderborder device-token item", async () => {
  const { exec, calls } = recorder([{ code: 0, stdout: `${token}\n`, stderr: "" }]);
  assert.equal(await createKeychain({ exec }).getToken(), token);
  assert.deepEqual(calls[0].args, ["find-generic-password", "-s", "leaderborder", "-a", "device-token", "-w"]);
});

test("getToken returns null when the item is missing", async () => {
  const { exec } = recorder([{ code: 44, stdout: "", stderr: "could not be found" }]);
  assert.equal(await createKeychain({ exec }).getToken(), null);
});

test("setToken writes through security -i stdin and never argv", async () => {
  const { exec, calls } = recorder();
  await createKeychain({ exec }).setToken(token);
  assert.deepEqual(calls[0].args, ["-i"]);
  assert.equal(calls[0].input, `add-generic-password -U -s leaderborder -a device-token -w ${token}\n`);
  calls.forEach((call) => assert.ok(!call.args.some((arg) => arg.includes(token))));
});

test("setToken rejects tokens that do not match the device token format", async () => {
  const { exec, calls } = recorder();
  const keychain = createKeychain({ exec });
  await assert.rejects(keychain.setToken("lb_short"), /device token/);
  await assert.rejects(keychain.setToken(`lb_${"a".repeat(42)} -x`), /device token/);
  assert.equal(calls.length, 0);
});

test("setToken throws when security fails without leaking the token", async () => {
  const { exec } = recorder([{ code: 1, stdout: "", stderr: "denied" }]);
  await assert.rejects(createKeychain({ exec }).setToken(token), (error) => /denied/.test(error.message) && !error.message.includes(token));
});

test("deleteToken deletes through security -i", async () => {
  const { exec, calls } = recorder();
  await createKeychain({ exec }).deleteToken();
  assert.deepEqual(calls[0], { args: ["-i"], input: "delete-generic-password -s leaderborder -a device-token\n" });
});

test("deleteToken tolerates a missing item", async () => {
  const { exec } = recorder([{ code: 44, stdout: "", stderr: "not found" }]);
  await createKeychain({ exec }).deleteToken();
});

test("deleteToken throws on other failures", async () => {
  const { exec } = recorder([{ code: 1, stdout: "", stderr: "locked" }]);
  await assert.rejects(createKeychain({ exec }).deleteToken(), /locked/);
});
