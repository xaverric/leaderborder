import { api } from "../api.js";
import { formatMetric, formatRange } from "../lib/format.js";
import { METRICS, PERIODS, metricLabel, periodLabel, periodShort } from "../lib/period.js";
import { filtersFromSearch, leaderboardQuery } from "../lib/query.js";
import { clientLabel, clientSlot } from "../lib/share.js";
import { renderLegend, renderShareBar, renderSparkline } from "../ui/charts.js";
import { clear, h, skeleton } from "../ui/dom.js";

const DESKTOP = "(min-width: 48rem)";

const select = ({ name, label, value, options, onchange }) =>
  h(
    "label",
    { class: "field" },
    h("span", { class: "field__label" }, label),
    h(
      "span",
      { class: "select" },
      h(
        "select",
        { name, onchange: (event) => onchange(event.target.value) },
        options.map(([optionValue, text]) => h("option", { value: optionValue, selected: optionValue === value }, text)),
      ),
    ),
  );

const periodControl = (value, onchange) =>
  h(
    "fieldset",
    { class: "segmented" },
    h("legend", { class: "field__label" }, "Period"),
    h(
      "div",
      { class: "segmented__track" },
      PERIODS.map((period) =>
        h(
          "label",
          { class: "segmented__option" },
          h("input", { type: "radio", name: "period", value: period, checked: period === value, onchange: () => onchange(period) }),
          h("span", {}, periodShort(period)),
        ),
      ),
    ),
  );

const summaryText = (filters) =>
  [periodShort(filters.period), metricLabel(filters.metric), filters.client ? clientLabel(filters.client) : null, filters.model || null].filter(Boolean).join(" · ");

const rowSkeleton = () =>
  h("li", { class: "board-row board-row--skeleton", "aria-hidden": "true" }, skeleton("skeleton--rank"), skeleton("skeleton--avatar"), skeleton("skeleton--name"), skeleton("skeleton--bar"), skeleton("skeleton--value"));

const rankCard = (board, me, ctx) => {
  const mine = board.entries.find((entry) => entry.login === me.user.login);
  const range = `${periodLabel(board.period)} · ${formatRange(board.range)}`;
  if (!mine) {
    return h(
      "section",
      { class: "rank-card card", "aria-label": "Your rank" },
      h("p", { class: "rank-card__label" }, "Your rank"),
      h("p", { class: "rank-card__empty" }, "Not on this board yet."),
      h("p", { class: "rank-card__meta muted" }, `No ${metricLabel(board.metric).toLowerCase()} recorded for you in this view. ${range}.`),
    );
  }
  const ahead = board.entries[mine.rank - 2];
  const gap = ahead ? `${formatMetric(board.metric, ahead.value - mine.value)} behind #${ahead.rank}` : "Top of the board";
  return h(
    "section",
    { class: "rank-card card", "aria-label": "Your rank" },
    h("p", { class: "rank-card__label" }, "Your rank"),
    h("p", { class: "rank-card__position" }, h("span", { class: "rank-card__hash" }, "#"), mine.rank, h("span", { class: "rank-card__of" }, ` of ${board.entries.length}`)),
    h(
      "div",
      { class: "rank-card__facts" },
      h("p", {}, h("strong", { class: "tnum" }, formatMetric(board.metric, mine.value)), h("span", { class: "muted" }, ` ${metricLabel(board.metric).toLowerCase()}`)),
      h("p", { class: "muted" }, gap),
      h("p", { class: "muted" }, range),
    ),
    h("a", { class: "btn btn--sm rank-card__link", href: ctx.href({ name: "user", login: mine.login }) }, "Your stats"),
  );
};

const boardRow = (entry, board, me, ctx) => {
  const isMe = entry.login === me.user.login;
  const name = entry.name ?? entry.login;
  return h(
    "li",
    { class: `board-row${isMe ? " is-me" : ""}` },
    h("span", { class: "board-row__rank tnum" }, entry.rank),
    h("img", { class: "avatar", src: entry.avatarUrl, alt: "", width: 40, height: 40, loading: "lazy" }),
    h(
      "span",
      { class: "board-row__who" },
      h("a", { class: "board-row__name", href: ctx.href({ name: "user", login: entry.login }) }, name),
      h("span", { class: "board-row__login muted" }, `@${entry.login}`, isMe ? h("span", { class: "tag" }, "You") : null),
    ),
    h("span", { class: "board-row__share" }, renderShareBar(entry.byClient, { metric: board.metric })),
    h("span", { class: "board-row__spark" }, renderSparkline(entry.sparkline, { label: `Last 30 days for ${name}` })),
    h("span", { class: "board-row__value tnum" }, formatMetric(board.metric, entry.value)),
  );
};

const emptyState = (filters, onReset) =>
  h(
    "div",
    { class: "empty card" },
    h("p", { class: "empty__title" }, "No usage in this view."),
    h("p", { class: "muted" }, filters.client || filters.model ? "Nobody used that tool or model in this period." : "Nobody has synced usage for this period yet."),
    h("button", { class: "btn btn--sm", type: "button", onclick: onReset }, "Show all time, all tools"),
  );

export const renderLeaderboard = (view, ctx) => {
  ctx.setTitle("Leaderboard");
  const filters = filtersFromSearch(location.search);
  let requestId = 0;
  ctx.onCleanup(() => requestId++);
  let lastBoard = null;

  const rangeLine = h("p", { class: "view__sub muted" }, skeleton("skeleton--long"));
  const rankSlot = h("div", { class: "board-rank" }, h("div", { class: "rank-card card rank-card--loading" }, skeleton("skeleton--long"), skeleton("skeleton--title")));
  const legendSlot = h("div", { class: "board-legend" });
  const list = h("ol", { class: "board", "aria-label": "Leaderboard" });
  const status = h("div", { class: "board-status", role: "status" });
  const summary = h("span", { class: "filters__summary muted" }, summaryText(filters));
  const selectsSlot = h("div", { class: "filters__selects" });
  const media = matchMedia(DESKTOP);
  const sheet = h(
    "details",
    { class: "filters card", open: media.matches },
    h("summary", { class: "filters__toggle" }, h("span", { class: "filters__toggle-label" }, "Filters"), summary),
    h("div", { class: "filters__body" }, periodControl(filters.period, (value) => update("period", value)), selectsSlot),
  );
  const syncSheet = () => {
    sheet.open = media.matches || sheet.open;
  };
  media.addEventListener("change", syncSheet);
  ctx.onCleanup(() => media.removeEventListener("change", syncSheet));

  const head = h(
    "div",
    { class: "board-head", "aria-hidden": "true" },
    h("span", {}, "#"),
    h("span", {}, "Player"),
    h("span", {}, "Tools"),
    h("span", {}, "Last 30 days"),
    h("span", { class: "board-head__value", "data-metric-head": "" }, metricLabel(filters.metric)),
  );

  const drawSelects = (options = { clients: [], models: [] }) => {
    clear(selectsSlot).append(
      select({ name: "metric", label: "Metric", value: filters.metric, options: METRICS.map((m) => [m, metricLabel(m)]), onchange: (v) => update("metric", v) }),
      select({
        name: "client",
        label: "Tool",
        value: filters.client,
        options: [["", "All tools"], ...[...new Set([...options.clients, filters.client].filter(Boolean))].map((c) => [c, clientLabel(c)])],
        onchange: (v) => update("client", v),
      }),
      select({
        name: "model",
        label: "Model",
        value: filters.model,
        options: [["", "All models"], ...[...new Set([...options.models, filters.model].filter(Boolean))].map((m) => [m, m])],
        onchange: (v) => update("model", v),
      }),
    );
  };

  const draw = (board) => {
    lastBoard = board;
    rangeLine.textContent = `${periodLabel(board.period)} · ${formatRange(board.range)} · ${board.entries.length} ${board.entries.length === 1 ? "player" : "players"}`;
    clear(rankSlot).append(rankCard(board, ctx.me, ctx));
    const clients = [...new Set(board.entries.flatMap((e) => Object.keys(e.byClient)))]
      .map((client) => ({ client, slot: clientSlot(client) }))
      .sort((a, b) => String(a.slot).localeCompare(String(b.slot), "en", { numeric: true }));
    const legendItems = clients.some((c) => c.slot === "other") ? [...clients.filter((c) => c.slot !== "other"), { client: "other", slot: "other" }] : clients;
    clear(legendSlot).append(legendItems.length ? renderLegend(legendItems) : "");
    head.querySelector("[data-metric-head]").textContent = metricLabel(board.metric);
    clear(status);
    list.replaceChildren(...board.entries.map((entry) => boardRow(entry, board, ctx.me, ctx)));
    if (!board.entries.length) status.append(emptyState(filters, reset));
    drawSelects(board.filters);
  };

  const load = async () => {
    const id = ++requestId;
    list.setAttribute("aria-busy", "true");
    if (!lastBoard) list.replaceChildren(...Array.from({ length: 6 }, rowSkeleton));
    else list.classList.add("is-stale");
    try {
      const board = await api.get(`/api/leaderboard?${leaderboardQuery(filters)}`);
      if (id === requestId) draw(board);
    } catch (error) {
      if (id !== requestId) return;
      if (!lastBoard) list.replaceChildren();
      clear(status).append(
        h("div", { class: "empty card", role: "alert" }, h("p", { class: "empty__title" }, "The leaderboard did not load."), h("p", { class: "muted" }, error.message), h("button", { class: "btn btn--sm", type: "button", onclick: load }, "Try again")),
      );
    } finally {
      if (id === requestId) {
        list.removeAttribute("aria-busy");
        list.classList.remove("is-stale");
      }
    }
  };

  function update(key, value) {
    filters[key] = value;
    summary.textContent = summaryText(filters);
    ctx.setSearch(leaderboardQuery(filters));
    load();
  }

  function reset() {
    Object.assign(filters, { period: "all", client: "", model: "" });
    for (const input of sheet.querySelectorAll('input[name="period"]')) input.checked = input.value === "all";
    update("period", "all");
  }

  clear(view).append(
    h(
      "div",
      { class: "view-leaderboard" },
      h("header", { class: "view__head" }, h("h1", { class: "view__title" }, "Leaderboard"), rangeLine),
      rankSlot,
      sheet,
      h("section", { class: "board-wrap card", "aria-label": "Rankings" }, h("div", { class: "board-wrap__top" }, legendSlot), head, list, status),
    ),
  );
  drawSelects();
  load();
};
