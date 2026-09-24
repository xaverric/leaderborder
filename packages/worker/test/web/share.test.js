import { describe, expect, it } from "vitest";
import { clientLabel, clientSlot, shareSegments } from "../../public/js/lib/share.js";

describe("clientSlot", () => {
  it("assigns fixed slots to known clients", () => {
    expect(clientSlot("claude")).toBe(1);
    expect(clientSlot("codex")).toBe(2);
    expect(clientSlot("cursor")).toBe(3);
    expect(clientSlot("gemini")).toBe(4);
    expect(clientSlot("opencode")).toBe(5);
  });

  it("folds unknown clients into other", () => {
    expect(clientSlot("amp")).toBe("other");
  });
});

describe("clientLabel", () => {
  it("names known clients and keeps unknown ids", () => {
    expect(clientLabel("claude")).toBe("Claude Code");
    expect(clientLabel("copilot")).toBe("GitHub Copilot CLI");
    expect(clientLabel("zed")).toBe("zed");
    expect(clientLabel("other")).toBe("Other");
  });
});

describe("shareSegments", () => {
  it("sorts by value and computes fractions", () => {
    expect(shareSegments({ codex: 30, claude: 60, amp: 10 })).toEqual([
      { client: "claude", value: 60, fraction: 0.6, slot: 1 },
      { client: "codex", value: 30, fraction: 0.3, slot: 2 },
      { client: "amp", value: 10, fraction: 0.1, slot: "other" },
    ]);
  });

  it("drops zero values and returns [] for an empty total", () => {
    expect(shareSegments({ claude: 0 })).toEqual([]);
    expect(shareSegments({})).toEqual([]);
    expect(shareSegments(undefined)).toEqual([]);
  });

  it("folds the tail into other when a limit is given", () => {
    const segments = shareSegments({ claude: 50, codex: 25, cursor: 15, gemini: 10 }, { limit: 2 });
    expect(segments).toEqual([
      { client: "claude", value: 50, fraction: 0.5, slot: 1 },
      { client: "codex", value: 25, fraction: 0.25, slot: 2 },
      { client: "other", value: 25, fraction: 0.25, slot: "other" },
    ]);
  });
});
