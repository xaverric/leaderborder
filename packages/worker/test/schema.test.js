import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("schema", () => {
  it("creates all tables", async () => {
    const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
    const names = results.map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(["users", "devices", "api_tokens", "usage_daily"]));
  });

  it("enforces foreign keys on usage_daily", async () => {
    const insert = env.DB.prepare(
      "INSERT INTO usage_daily (device_id, day, client, model, input, output, cache_read, cache_write, reasoning, cost_usd, messages, updated_at) VALUES ('missing', '2026-09-01', 'claude', 'm', 0, 0, 0, 0, 0, 0, 0, '2026-09-01T00:00:00Z')",
    );
    await expect(insert.run()).rejects.toThrow(/FOREIGN KEY/);
  });
});
