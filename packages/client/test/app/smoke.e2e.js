import { test, expect, _electron as electron } from "@playwright/test";
import electronPath from "electron";
import { fileURLToPath } from "node:url";

const CLIENT_DIR = fileURLToPath(new URL("../..", import.meta.url));

const launch = async (extraEnv = {}) => {
  const app = await electron.launch({
    executablePath: electronPath,
    args: [CLIENT_DIR],
    env: { ...process.env, LEADERBORDER_FAKE_CORE: "1", ...extraEnv },
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
  return { app, page };
};

test("popover renders the signed-out state", async () => {
  const { app, page } = await launch();
  try {
    const screen = page.locator('[data-screen="signed-out"]');
    await expect(screen).toBeVisible();
    await expect(screen.getByRole("heading", { level: 1 })).toHaveText("Put your token burn on the board.");
    await expect(screen.getByRole("button", { name: "Sign in with GitHub" })).toBeEnabled();
    await expect(page.locator('[data-screen="account"]')).toBeHidden();
    const security = await page.evaluate(() => ({
      node: typeof globalThis.require,
      process: typeof globalThis.process,
      api: Object.keys(globalThis.leaderborder).sort(),
    }));
    expect(security.node).toBe("undefined");
    expect(security.process).toBe("undefined");
    expect(security.api).toContain("login");
  } finally {
    await app.close();
  }
});

test("device login shows the code and lands on the account view", async () => {
  const { app, page } = await launch();
  try {
    await page.getByRole("button", { name: "Sign in with GitHub" }).click();
    await expect(page.locator('[data-field="user-code"]')).toHaveText("FAKE-1234");
    await expect(page.locator('[data-screen="account"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-field="today-tokens"]')).toHaveText("1.3M", { timeout: 10_000 });
    await expect(page.locator('[data-field="rank-label"]')).toHaveText("#3");
    await expect(page.getByRole("button", { name: "Open leaderboard" })).toBeVisible();
  } finally {
    await app.close();
  }
});

test("signed-in fake core renders the account view", async () => {
  const { app, page } = await launch({ LEADERBORDER_FAKE_SIGNED_IN: "1" });
  try {
    await expect(page.locator('[data-screen="account"]')).toBeVisible();
    await expect(page.locator('[data-field="week-tokens"]')).toHaveText("18.9M");
    await expect(page.locator('[data-field="top-model"]')).toHaveText("claude-opus-5");
    await page.getByRole("button", { name: "Connect Cursor" }).click();
    await expect(page.locator('[data-show="cursor-hint"] code')).toHaveText("npx leaderborder cursor-login");
  } finally {
    await app.close();
  }
});
