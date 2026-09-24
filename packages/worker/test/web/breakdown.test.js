import { describe, expect, it } from "vitest";
import { groupByClient } from "../../public/js/lib/breakdown.js";

describe("groupByClient", () => {
  const rows = [
    { client: "codex", model: "gpt-5.2", tokens: 30, tokensNoCache: 3, costUsd: 1 },
    { client: "claude", model: "claude-opus-5", tokens: 60, tokensNoCache: 6, costUsd: 4 },
    { client: "claude", model: "claude-sonnet-5", tokens: 20, tokensNoCache: 2, costUsd: 1 },
    { client: "codex", model: "gpt-5.2-codex", tokens: 0, tokensNoCache: 0, costUsd: 0 },
  ];

  it("groups, sorts and computes model fractions", () => {
    expect(groupByClient(rows, "tokens")).toEqual([
      {
        client: "claude",
        slot: 1,
        total: 80,
        models: [
          { model: "claude-opus-5", value: 60, fraction: 0.75 },
          { model: "claude-sonnet-5", value: 20, fraction: 0.25 },
        ],
      },
      { client: "codex", slot: 2, total: 30, models: [{ model: "gpt-5.2", value: 30, fraction: 1 }] },
    ]);
  });

  it("uses the requested key", () => {
    expect(groupByClient(rows, "costUsd").map((g) => g.total)).toEqual([5, 1]);
  });
});
