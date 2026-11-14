import { test } from "node:test";
import assert from "node:assert/strict";
import { createRendererHandler, RENDERER_URL } from "../../src/app/renderer-protocol.js";

test("serves the popup and its assets with their content types", async () => {
  const handler = createRendererHandler(async (file) => Buffer.from(file));
  for (const [file, type] of [["index.html", "text/html"], ["app.js", "text/javascript"], ["styles.css", "text/css"], ["tokens.css", "text/css"]]) {
    const response = await handler(new Request(new URL(file, RENDERER_URL)));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), file);
    assert.equal(response.headers.get("content-type"), `${type}; charset=utf-8`);
  }
});

test("rejects other origins, paths and methods without reading files", async () => {
  const handler = createRendererHandler(() => assert.fail("unexpected file read"));
  for (const url of [
    "https://app/index.html",
    "leaderborder://other/index.html",
    "leaderborder://app/../main.js",
    "leaderborder://app/%2e%2e%2fmain.js",
    "leaderborder://app/index.html?file=../main.js",
    "leaderborder://app/preload.cjs",
  ]) assert.equal((await handler(new Request(url))).status, 404);
  assert.equal((await handler(new Request(RENDERER_URL, { method: "POST" }))).status, 404);
});
