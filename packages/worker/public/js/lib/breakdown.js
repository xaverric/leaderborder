import { clientSlot } from "./share.js";

export const groupByClient = (rows = [], key = "tokens") => {
  const groups = new Map();
  for (const row of rows) {
    const value = Number(row[key]) || 0;
    if (value <= 0) continue;
    const group = groups.get(row.client) ?? { client: row.client, slot: clientSlot(row.client), total: 0, models: [] };
    group.total += value;
    group.models.push({ model: row.model, value });
    groups.set(row.client, group);
  }
  return [...groups.values()]
    .sort((a, b) => b.total - a.total)
    .map((group) => ({
      ...group,
      models: group.models
        .sort((a, b) => b.value - a.value)
        .map((m) => ({ ...m, fraction: m.value / group.total })),
    }));
};
