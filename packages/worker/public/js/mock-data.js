import { addDays, dayRange, isoDay } from "./lib/dates.js";
import { metricKey } from "./lib/period.js";
import { filtersFromSearch } from "./lib/query.js";

const MODELS = {
  claude: [
    ["claude-opus-5", 0.55],
    ["claude-sonnet-5", 0.35],
    ["claude-haiku-4-5", 0.1],
  ],
  codex: [
    ["gpt-5.2-codex", 0.7],
    ["gpt-5.2", 0.3],
  ],
  cursor: [
    ["cursor-auto", 0.6],
    ["claude-sonnet-5", 0.4],
  ],
  gemini: [
    ["gemini-3-pro", 0.65],
    ["gemini-3-flash", 0.35],
  ],
};

const PRICE_PER_MTOK = {
  "claude-opus-5": [5, 25, 0.5, 6.25],
  "claude-sonnet-5": [3, 15, 0.3, 3.75],
  "claude-haiku-4-5": [1, 5, 0.1, 1.25],
  "gpt-5.2-codex": [1.25, 10, 0.125, 0],
  "gpt-5.2": [1.25, 10, 0.125, 0],
  "cursor-auto": [1.25, 6, 0.25, 0],
  "gemini-3-pro": [2, 12, 0.2, 0],
  "gemini-3-flash": [0.3, 2.5, 0.03, 0],
};

const PLAYERS = [
  { login: "ada", name: "Ada Lovelace", hue: "#2f5fd0", scale: 1.0, active: 0.86, joined: 400, mix: { claude: 0.62, codex: 0.18, cursor: 0.12, gemini: 0.08 } },
  { login: "linus", name: "Linus Brandt", hue: "#3c4a63", scale: 1.35, active: 0.78, joined: 400, mix: { codex: 0.55, claude: 0.35, gemini: 0.1 } },
  { login: "grace", name: "Grace Novak", hue: "#2b7a8c", scale: 0.8, active: 0.92, joined: 260, mix: { claude: 0.8, cursor: 0.2 } },
  { login: "ken", name: "Ken Arai", hue: "#5a6478", scale: 0.55, active: 0.7, joined: 400, mix: { cursor: 0.6, claude: 0.25, gemini: 0.15 } },
  { login: "margaret", name: null, hue: "#5b57b8", scale: 0.35, active: 0.6, joined: 120, mix: { gemini: 0.5, codex: 0.3, claude: 0.2 } },
  { login: "dennis", name: "Dennis Ruiz", hue: "#1f2a44", scale: 0.2, active: 0.5, joined: 45, mix: { claude: 0.5, codex: 0.5 } },
];

const HISTORY_DAYS = 400;

const mulberry32 = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const avatarFor = ({ login, name, hue }) => {
  const initials = (name ?? login)
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${hue}"/><text x="32" y="41" font-family="Geist, sans-serif" font-size="26" font-weight="600" text-anchor="middle" fill="#f5f7fb">${initials}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

const costOf = (model, row) => {
  const [input, output, cacheRead, cacheWrite] = PRICE_PER_MTOK[model] ?? [1, 5, 0.1, 0];
  return (row.input * input + row.output * output + row.cacheRead * cacheRead + row.cacheWrite * cacheWrite) / 1e6;
};

const generateRows = (today) => {
  const random = mulberry32(20260924);
  const rows = [];
  for (const [index, player] of PLAYERS.entries()) {
    for (const day of dayRange(today, Math.min(HISTORY_DAYS, player.joined))) {
      const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
      const weekend = weekday === 0 || weekday === 6;
      if (random() > player.active * (weekend ? 0.35 : 1)) continue;
      const burst = random() < 0.08 ? 2.6 : 1;
      const dayTokens = player.scale * burst * (2.5e7 + random() * 2.2e8) * (1 + index * 0.02);
      for (const [client, share] of Object.entries(player.mix)) {
        if (random() < 0.15) continue;
        for (const [model, modelShare] of MODELS[client]) {
          const tokens = Math.round(dayTokens * share * modelShare * (0.6 + random() * 0.8));
          if (tokens < 1000) continue;
          const cacheRead = Math.round(tokens * (0.72 + random() * 0.14));
          const input = Math.round(tokens * 0.07);
          const output = Math.round(tokens * 0.035);
          const cacheWrite = Math.max(0, tokens - cacheRead - input - output);
          const row = { login: player.login, day, client, model, input, output, cacheRead, cacheWrite, reasoning: Math.round(output * 0.3) };
          rows.push({
            ...row,
            tokens: input + output + cacheRead + cacheWrite,
            tokensNoCache: input + output,
            costUsd: Math.round(costOf(model, row) * 100) / 100,
            messages: Math.max(1, Math.round(tokens / 180000)),
          });
        }
      }
    }
  }
  return rows;
};

const periodRange = (period, today, firstDay) => {
  if (period === "day") return { start: today, end: today };
  if (period === "week") return { start: addDays(today, -6), end: today };
  if (period === "month") return { start: `${today.slice(0, 8)}01`, end: today };
  return { start: firstDay, end: today };
};

const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);

const round2 = (n) => Math.round(n * 100) / 100;

const totalsOf = (rows) => ({
  tokens: sum(rows, "tokens"),
  tokensNoCache: sum(rows, "tokensNoCache"),
  costUsd: round2(sum(rows, "costUsd")),
});

const groupBy = (rows, keyOf) => {
  const map = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    map.set(key, [...(map.get(key) ?? []), row]);
  }
  return map;
};

const dailySeries = (rows, days, today, pick) => {
  const byDay = groupBy(rows, (row) => row.day);
  return dayRange(today, days)
    .filter((day) => byDay.has(day))
    .map((day) => ({ day, ...pick(byDay.get(day)) }));
};

const error = (status, code, message) => ({ status, body: { error: { code, message } } });

const userOf = (player) => ({ login: player.login, name: player.name, avatarUrl: avatarFor(player) });

const initialDevices = (now) => [
  { id: "7d3f1c2a-5b6e-4f80-9a1b-2c3d4e5f6a70", name: "Ada's MacBook Pro", createdAt: new Date(now - 180 * 864e5).toISOString(), lastSyncAt: new Date(now - 12 * 6e4).toISOString() },
  { id: "0b8e2f4d-1c3a-4e5b-8f6d-7a9b0c1d2e3f", name: "Studio Mac mini", createdAt: new Date(now - 60 * 864e5).toISOString(), lastSyncAt: new Date(now - 3 * 864e5).toISOString() },
  { id: "c1a2b3c4-d5e6-4f70-8a9b-0c1d2e3f4a5b", name: "Travel MacBook Air", createdAt: new Date(now - 5 * 864e5).toISOString(), lastSyncAt: null },
];

export const MOCK_LOGIN = "ada";

export const createMockApi = ({ now = new Date() } = {}) => {
  const today = isoDay(now);
  const rows = generateRows(today);
  const firstDay = rows.reduce((min, row) => (row.day < min ? row.day : min), today);
  const players = new Map(PLAYERS.map((p) => [p.login, p]));
  let devices = initialDevices(now.getTime());
  let signedIn = true;

  const leaderboard = (search) => {
    const filters = filtersFromSearch(search);
    const range = periodRange(filters.period, today, firstDay);
    const key = metricKey(filters.metric);
    const matches = (row) => (!filters.client || row.client === filters.client) && (!filters.model || row.model === filters.model);
    const filtered = rows.filter(matches);
    const inRange = filtered.filter((row) => row.day >= range.start && row.day <= range.end);
    const sparkDays = dayRange(range.end, 30);
    const entries = [...groupBy(inRange, (row) => row.login).entries()]
      .map(([login, userRows]) => {
        const player = players.get(login);
        const totals = totalsOf(userRows);
        const byClient = Object.fromEntries(
          [...groupBy(userRows, (row) => row.client).entries()].map(([client, clientRows]) => [client, round2(sum(clientRows, key))]),
        );
        const sparkRows = groupBy(filtered.filter((row) => row.login === login && row.day >= sparkDays[0] && row.day <= range.end), (row) => row.day);
        return {
          login,
          name: player.name,
          avatarUrl: avatarFor(player),
          value: totals[key],
          ...totals,
          byClient,
          sparkline: sparkDays.map((day) => ({ day, value: round2(sum(sparkRows.get(day) ?? [], key)) })),
        };
      })
      .filter((entry) => entry.value > 0)
      .sort((a, b) => b.value - a.value)
      .map((entry, i) => ({ rank: i + 1, ...entry }));
    return {
      status: 200,
      body: {
        period: filters.period,
        metric: filters.metric,
        range,
        entries,
        filters: {
          clients: [...new Set(rows.map((row) => row.client))].sort(),
          models: [...new Set(rows.map((row) => row.model))].sort(),
        },
      },
    };
  };

  const me = () => {
    if (!signedIn) return error(401, "unauthorized", "Sign in to continue.");
    const board = leaderboard("?period=week&metric=tokens").body;
    const mine = board.entries.find((entry) => entry.login === MOCK_LOGIN);
    return {
      status: 200,
      body: {
        user: userOf(players.get(MOCK_LOGIN)),
        rank: mine ? { period: "week", metric: "tokens", position: mine.rank, of: board.entries.length, value: mine.value } : null,
        devices: devices.map((device) => ({ ...device })),
      },
    };
  };

  const userDetail = (login) => {
    const player = players.get(login);
    if (!player) return error(404, "not_found", `No player called ${login}.`);
    const userRows = rows.filter((row) => row.login === login);
    const pairs = groupBy(userRows, (row) => `${row.client}\u0000${row.model}`);
    return {
      status: 200,
      body: {
        user: userOf(player),
        totals: {
          ...totalsOf(userRows),
          messages: sum(userRows, "messages"),
          activeDays: new Set(userRows.map((row) => row.day)).size,
        },
        daily: dailySeries(userRows, 365, today, totalsOf),
        byClientModel: [...pairs.values()].map((pairRows) => ({ client: pairRows[0].client, model: pairRows[0].model, ...totalsOf(pairRows) })),
        devices:
          login === MOCK_LOGIN
            ? devices.map(({ name, lastSyncAt }) => ({ name, lastSyncAt }))
            : [{ name: `${(player.name ?? player.login).split(" ")[0]}'s MacBook`, lastSyncAt: new Date(now.getTime() - 40 * 6e4).toISOString() }],
      },
    };
  };

  const publicStats = () => {
    const week = rows.filter((row) => row.day >= addDays(today, -6));
    const top = (keyOf, name) =>
      [...groupBy(week, keyOf).entries()]
        .map(([id, groupRows]) => ({ [name]: id, tokens: sum(groupRows, "tokens") }))
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, 5);
    return {
      status: 200,
      body: {
        tokensAllTime: sum(rows, "tokens"),
        tokensThisWeek: sum(week, "tokens"),
        costThisWeekUsd: round2(sum(week, "costUsd")),
        players: players.size,
        activeThisWeek: new Set(week.map((row) => row.login)).size,
        topModels: top((row) => row.model, "model"),
        topClients: top((row) => row.client, "client"),
        daily: dailySeries(rows, 90, today, (dayRows) => ({ tokens: sum(dayRows, "tokens") })),
        updatedAt: now.toISOString(),
      },
    };
  };

  const handle = (method, pathWithQuery) => {
    const url = new URL(pathWithQuery, "https://mock.invalid");
    const { pathname, search } = url;
    if (method === "GET" && pathname === "/api/public/stats") return publicStats();
    if (method === "GET" && pathname === "/api/config") return { status: 200, body: { githubClientId: "mock-client-id", apiVersion: 1 } };
    if (method === "POST" && pathname === "/auth/logout") {
      signedIn = false;
      return { status: 204, body: null };
    }
    if (method === "GET" && pathname === "/api/me") return me();
    if (!signedIn) return error(401, "unauthorized", "Sign in to continue.");
    if (method === "GET" && pathname === "/api/leaderboard") return leaderboard(search);
    const userMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
    if (method === "GET" && userMatch) return userDetail(decodeURIComponent(userMatch[1]));
    const deviceMatch = pathname.match(/^\/api\/me\/devices\/([^/]+)$/);
    if (method === "DELETE" && deviceMatch) {
      const id = decodeURIComponent(deviceMatch[1]);
      if (!devices.some((device) => device.id === id)) return error(404, "not_found", "That device is already gone.");
      devices = devices.filter((device) => device.id !== id);
      return { status: 204, body: null };
    }
    return error(404, "not_found", `No mock for ${method} ${pathname}.`);
  };

  return { handle, signOut: () => (signedIn = false) };
};
