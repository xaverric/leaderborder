const SLOTS = { claude: 1, codex: 2, cursor: 3, gemini: 4, opencode: 5 };

const LABELS = {
  claude: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
  copilot: "GitHub Copilot CLI",
  amp: "Amp",
  other: "Other",
};

export const clientSlot = (client) => SLOTS[client] ?? "other";

export const clientLabel = (client) => LABELS[client] ?? client;

export const shareSegments = (byClient = {}, { limit = Infinity } = {}) => {
  const entries = Object.entries(byClient ?? {})
    .map(([client, value]) => [client, Number(value) || 0])
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (!total) return [];
  const head = entries.slice(0, limit);
  const tail = entries.slice(limit);
  const segments = head.map(([client, value]) => ({ client, value, fraction: value / total, slot: clientSlot(client) }));
  if (!tail.length) return segments;
  const rest = tail.reduce((sum, [, value]) => sum + value, 0);
  return [...segments, { client: "other", value: rest, fraction: rest / total, slot: "other" }];
};
