import { describe, expect, it } from "vitest";
import { dailySeries, filterOptions, peakHour, sumHours, summarizeWindow, windowByClientModel, windowRange } from "../../public/js/lib/activity.js";

const hours = (buckets = {}) => Array.from({ length: 24 }, (_, hour) => buckets[hour] ?? [0, 0, 0]);

const usage = [
  { day: "2026-09-23", client: "claude", model: "claude-opus-5", tokens: 1000, tokensNoCache: 100, costUsd: 2, messages: 10, genMs: 60000 },
  { day: "2026-09-24", client: "claude", model: "claude-opus-5", tokens: 3000, tokensNoCache: 300, costUsd: 6, messages: 20, genMs: 120000 },
  { day: "2026-09-24", client: "claude", model: "claude-haiku-4-5", tokens: 1000, tokensNoCache: 100, costUsd: 1, messages: 4, genMs: 30000 },
  { day: "2026-09-24", client: "codex", model: "gpt-5", tokens: 2000, tokensNoCache: 200, costUsd: 3, messages: 6, genMs: 20000 },
  { day: "2026-09-24", client: "cursor", model: "auto", tokens: 4000, tokensNoCache: 400, costUsd: 0, messages: 5, genMs: null },
];

const activity = {
  days: [
    { day: "2026-09-23", activeMs: 100000, longestMs: 80000, sessions: 1, maxConcurrent: 1 },
    { day: "2026-09-24", activeMs: 400000, longestMs: 200000, sessions: 3, maxConcurrent: 2 },
  ],
  clients: [
    { day: "2026-09-23", client: "claude", prompts: 2, hours: hours({ 9: [1000, 10, 2] }) },
    { day: "2026-09-24", client: "claude", prompts: 4, hours: hours({ 9: [2000, 14, 3], 14: [2000, 10, 1] }) },
    { day: "2026-09-24", client: "codex", prompts: 1, hours: hours({ 14: [2000, 6, 1] }) },
  ],
};

const detail = { usage, activity };

describe("windowRange", () => {
  it("ends at the selected day", () => {
    expect(windowRange({ end: "2026-09-24", span: 1 })).toEqual({ start: "2026-09-24", end: "2026-09-24" });
    expect(windowRange({ end: "2026-09-24", span: 7 })).toEqual({ start: "2026-09-18", end: "2026-09-24" });
  });
});

describe("summarizeWindow", () => {
  it("summarizes one day across all tools", () => {
    const summary = summarizeWindow(detail, { end: "2026-09-24", span: 1, client: "", model: "" });
    expect(summary).toMatchObject({
      tokens: 10000,
      tokensNoCache: 1000,
      costUsd: 10,
      messages: 35,
      activeDays: 1,
      modelMs: 170000,
      modelCoverage: 0.6,
      prompts: 5,
      tokensPerPrompt: 1200,
      messagesPerPrompt: 6,
      modelMsPerPrompt: 34000,
      costPerPrompt: 2,
      activeMs: 400000,
      outsideModelMs: 230000,
      longestMs: 200000,
      sessions: 3,
      maxConcurrent: 2,
      hasActivity: true,
    });
    expect(summary.hours[9]).toEqual([2000, 14, 3]);
    expect(summary.hours[14]).toEqual([4000, 16, 2]);
  });

  it("sums a window and takes the longest stretch and peak parallel sessions", () => {
    const summary = summarizeWindow(detail, { end: "2026-09-24", span: 7, client: "", model: "" });
    expect(summary).toMatchObject({ tokens: 11000, activeDays: 2, prompts: 7, activeMs: 500000, longestMs: 200000, sessions: 4, maxConcurrent: 2 });
  });

  it("filters tokens and prompts by tool but hides session metrics", () => {
    const summary = summarizeWindow(detail, { end: "2026-09-24", span: 1, client: "claude", model: "" });
    expect(summary).toMatchObject({ tokens: 4000, modelMs: 150000, modelCoverage: 1, prompts: 4, tokensPerPrompt: 1000, activeMs: null, outsideModelMs: null, sessions: null });
    expect(summary.hours[14]).toEqual([2000, 10, 1]);
  });

  it("hides prompts while a model is selected", () => {
    const summary = summarizeWindow(detail, { end: "2026-09-24", span: 1, client: "claude", model: "claude-haiku-4-5" });
    expect(summary).toMatchObject({ tokens: 1000, modelMs: 30000, prompts: null, tokensPerPrompt: null, activeMs: null });
  });

  it("reports missing timing as null rather than zero", () => {
    const summary = summarizeWindow({ usage: usage.filter((row) => row.client === "cursor") }, { end: "2026-09-24", span: 1, client: "", model: "" });
    expect(summary).toMatchObject({ tokens: 4000, modelMs: null, modelCoverage: null, prompts: null, activeMs: null, hours: null, hasActivity: false });
  });
});

describe("dailySeries", () => {
  it("adds up days for the selected tool and model", () => {
    expect(dailySeries(detail, { client: "", model: "" })).toEqual([
      { day: "2026-09-23", tokens: 1000, tokensNoCache: 100, costUsd: 2, genMs: 60000, prompts: 2 },
      { day: "2026-09-24", tokens: 10000, tokensNoCache: 1000, costUsd: 10, genMs: 170000, prompts: 5 },
    ]);
    expect(dailySeries(detail, { client: "codex", model: "" })).toEqual([{ day: "2026-09-24", tokens: 2000, tokensNoCache: 200, costUsd: 3, genMs: 20000, prompts: 1 }]);
    expect(dailySeries(detail, { client: "", model: "gpt-5" }).map((d) => d.prompts)).toEqual([0]);
  });
});

describe("windowByClientModel", () => {
  it("aggregates the window by tool and model", () => {
    const rows = windowByClientModel(detail, { end: "2026-09-24", span: 7, client: "claude", model: "" }, "tokens");
    expect(rows).toEqual([
      { client: "claude", model: "claude-opus-5", tokens: 4000, tokensNoCache: 400, costUsd: 8, genMs: 180000 },
      { client: "claude", model: "claude-haiku-4-5", tokens: 1000, tokensNoCache: 100, costUsd: 1, genMs: 30000 },
    ]);
  });

  it("returns prompts per tool", () => {
    expect(windowByClientModel(detail, { end: "2026-09-24", span: 1, client: "", model: "" }, "prompts")).toEqual([
      { client: "claude", model: "", prompts: 4 },
      { client: "codex", model: "", prompts: 1 },
    ]);
  });
});

describe("filterOptions", () => {
  it("orders tools and models by tokens and narrows models to the selected tool", () => {
    expect(filterOptions(usage, { client: "" })).toEqual({
      clients: [
        { value: "claude", slot: 1 },
        { value: "cursor", slot: 3 },
        { value: "codex", slot: 2 },
      ],
      models: ["auto", "claude-opus-5", "gpt-5", "claude-haiku-4-5"],
    });
    expect(filterOptions(usage, { client: "claude" }).models).toEqual(["claude-opus-5", "claude-haiku-4-5"]);
  });
});

describe("hours helpers", () => {
  it("sums buckets and finds the busiest hour", () => {
    const total = sumHours(activity.clients);
    expect(total[9]).toEqual([3000, 24, 5]);
    expect(peakHour(total)).toBe(14);
    expect(peakHour(total, 2)).toBe(9);
    expect(peakHour(hours())).toBeNull();
  });
});
