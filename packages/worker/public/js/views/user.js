import { api } from "../api.js";
import { SPANS, dailySeries, filterOptions, summarizeWindow, windowByClientModel } from "../lib/activity.js";
import { groupByClient } from "../lib/breakdown.js";
import { addDays, dayRange, isoDay } from "../lib/dates.js";
import { formatCompact, formatDay, formatDecimal, formatDuration, formatInteger, formatMetric, formatRange, formatUsd, relativeTime } from "../lib/format.js";
import { metricKey, metricLabel } from "../lib/period.js";
import { DEFAULT_USER_SPAN, USER_HISTORY_DAYS, userFiltersFromSearch, userQuery } from "../lib/query.js";
import { clientLabel } from "../lib/share.js";
import { heatmapCellFor, renderBreakdown, renderHeatmap, renderHours } from "../ui/charts.js";
import { clear, h, skeleton } from "../ui/dom.js";
import { renderTrend } from "../ui/trend.js";
import { githubLink } from "../ui/github.js";

const METRIC_OPTIONS = [
  ["tokens", "Tokens"],
  ["tokens_nocache", "Without cache"],
  ["cost", "Cost"],
  ["model_time", "Model time"],
  ["prompts", "Prompts"],
];

const SPAN_OPTIONS = SPANS.map((span) => [span, span === 1 ? "Day" : `${span} days`]);

const segmented = ({ name, legend, options, value, onchange }) =>
  h(
    "fieldset",
    { class: "segmented segmented--compact" },
    h("legend", { class: "sr-only" }, legend),
    h(
      "div",
      { class: "segmented__track" },
      options.map(([option, label]) =>
        h(
          "label",
          { class: "segmented__option" },
          h("input", { type: "radio", name, value: option, checked: option === value, "data-focus": `${name}:${option}`, onchange: () => onchange(option) }),
          h("span", {}, label),
        ),
      ),
    ),
  );

const metricSwitch = (value, onchange) => segmented({ name: "detail-metric", legend: "Metric", options: METRIC_OPTIONS, value, onchange });

const chip = ({ label, selected, onclick, focus, slot = null }) =>
  h(
    "button",
    { class: "chip-toggle", type: "button", "aria-pressed": String(selected), "data-focus": focus, onclick },
    slot ? h("span", { class: `legend__swatch series--${slot}`, "aria-hidden": "true" }) : null,
    label,
  );

const chipRow = (label, chips) => h("div", { class: "scope__chips", role: "group", "aria-label": label }, h("span", { class: "scope__label" }, label), chips);

const kpiGroups = (s, span) => [
  [
    "Usage",
    [
      ["Tokens", formatCompact(s.tokens)],
      ["Cost", formatUsd(s.costUsd), "API-equivalent"],
      ["Messages", formatInteger(s.messages), "Model responses, one per agent step"],
      span > 1 ? ["Active days", `${formatInteger(s.activeDays)} of ${span}`] : null,
    ],
  ],
  [
    "Time",
    [
      ["Model time", formatDuration(s.modelMs), "Waiting for model responses"],
      ["Session time", formatDuration(s.activeMs), "Active time in agent sessions"],
      ["Outside model time", formatDuration(s.outsideModelMs), "Tools, reading and typing"],
      ["Longest stretch", formatDuration(s.longestMs), "Without a 3 minute break"],
      ["Sessions", formatInteger(s.sessions)],
      ["Peak parallel", formatInteger(s.maxConcurrent), "Sessions at the same time"],
    ],
  ],
  [
    "Per prompt",
    [
      ["Prompts", formatInteger(s.prompts), "Turns started by a person"],
      ["Tokens per prompt", formatCompact(s.tokensPerPrompt)],
      ["Messages per prompt", formatDecimal(s.messagesPerPrompt), "Agent steps per prompt"],
      ["Model time per prompt", formatDuration(s.modelMsPerPrompt)],
      ["Cost per prompt", formatUsd(s.costPerPrompt)],
    ],
  ],
];

const kpiGrid = (summary, span) =>
  kpiGroups(summary, span).map(([title, items]) =>
    h(
      "div",
      { class: "kpis" },
      h("h3", { class: "kpis__title" }, title),
      h(
        "dl",
        { class: "kpis__list" },
        items.filter(Boolean).map(([label, value, note]) =>
          h("div", { class: "kpi" }, h("dt", {}, label, note ? h("span", { class: "kpi__note" }, note) : null), h("dd", { class: "tnum" }, value)),
        ),
      ),
    ),
  );

const windowNotes = (summary, filters) =>
  [
    summary.hasActivity
      ? "Time comes from local session logs. Gaps over 3 minutes count as idle, parallel sessions add up and Cursor records no timing."
      : "No timing data yet. It arrives with the next sync from an updated leaderborder client.",
    summary.hasActivity && (filters.client || filters.model) ? "Session time, stretches and parallel sessions cover all tools, so the tool and model filters do not apply to them." : null,
    summary.hasActivity && filters.model ? "Prompts are counted per tool, so they are hidden while a model is selected. Hours of day show the whole tool." : null,
    summary.modelCoverage !== null && summary.modelCoverage < 0.995 ? `Model time covers ${Math.round(summary.modelCoverage * 100)}% of the tokens in this view.` : null,
  ].filter(Boolean);

const rangeLabel = ({ end, span }) => (span === 1 ? formatDay(end) : formatRange({ start: addDays(end, -(span - 1)), end }));

const filterLabel = (filters) => [filters.client ? clientLabel(filters.client) : null, filters.model || null].filter(Boolean).join(" · ");

const totalsStrip = (totals) =>
  h(
    "dl",
    { class: "totals" },
    [
      ["Tokens", formatCompact(totals.tokens)],
      ["Without cache", formatCompact(totals.tokensNoCache)],
      ["Cost", formatUsd(totals.costUsd), "API-equivalent"],
      ["Messages", formatInteger(totals.messages)],
      ["Active days", formatInteger(totals.activeDays)],
    ].map(([label, value, note]) =>
      h("div", { class: "totals__item" }, h("dt", {}, label, note ? h("span", { class: "totals__note" }, note) : null), h("dd", { class: "tnum" }, value)),
    ),
  );

const panel = (title, ...children) => h("section", { class: "detail-card card" }, h("h2", { class: "detail-card__title" }, title), ...children);

const loadingView = () =>
  h(
    "div",
    { class: "view-user", "aria-busy": "true" },
    h("div", { class: "profile" }, skeleton("skeleton--avatar-lg"), h("div", { class: "profile__text" }, skeleton("skeleton--title"), skeleton("skeleton--long"))),
    h("div", { class: "detail-card card" }, skeleton("skeleton--block")),
  );

export const renderUser = (view, ctx, login) => {
  ctx.setTitle(login);
  clear(view).append(loadingView());
  const today = isoDay(new Date());
  const filters = userFiltersFromSearch(location.search, { today, spans: SPANS });
  let disposeTrend = null;
  let alive = true;
  ctx.onCleanup(() => {
    alive = false;
    disposeTrend?.();
  });

  const draw = (detail) => {
    const isMe = detail.user.login === ctx.me.user.login;
    const name = detail.user.name ?? detail.user.login;
    ctx.setTitle(name);
    const heatmapSlot = h("div", { class: "detail-card__body" });
    const trendSlot = h("div", { class: "trend" });
    const breakdownSlot = h("div", { class: "detail-card__body" });
    const heatmapTotal = h("p", { class: "detail-card__meta muted tnum" });
    const scopeSlot = h("section", { class: "scope card", "aria-label": "Time window and filters" });
    const windowTitle = h("h2", { class: "detail-card__title" });
    const windowMeta = h("p", { class: "detail-card__meta muted" });
    const kpiSlot = h("div", { class: "kpi-groups" });
    const notesSlot = h("ul", { class: "window-notes muted" });
    const hoursSlot = h("div", { class: "detail-card__body" });
    const hoursMeta = h("p", { class: "detail-card__meta muted" });
    const breakdownMeta = h("p", { class: "detail-card__meta muted" });

    const update = (changes) => {
      Object.assign(filters, changes);
      ctx.setSearch(userQuery(filters, today));
      redraw();
    };
    const selectDay = (day) => update({ end: day, span: 1 });
    const toggleClient = (client) => update({ client: filters.client === client ? "" : client, model: "" });
    const toggleModel = (model) => update({ model: filters.model === model ? "" : model });

    const drawScope = () => {
      const options = filterOptions(detail.usage, filters);
      const earliest = addDays(today, -(USER_HISTORY_DAYS - 1));
      const isDefault = filters.end === today && filters.span === DEFAULT_USER_SPAN && !filters.client && !filters.model;
      clear(scopeSlot).append(
        h(
          "div",
          { class: "scope__row" },
          segmented({ name: "detail-span", legend: "Window", options: SPAN_OPTIONS, value: filters.span, onchange: (span) => update({ span }) }),
          h(
            "div",
            { class: "day-nav" },
            h(
              "button",
              { class: "btn btn--sm btn--quiet", type: "button", "aria-label": "Previous day", "data-focus": "prev", disabled: filters.end <= earliest, onclick: () => update({ end: addDays(filters.end, -1) }) },
              "←",
            ),
            h("span", { class: "day-nav__label tnum", "aria-live": "polite" }, rangeLabel(filters)),
            h(
              "button",
              { class: "btn btn--sm btn--quiet", type: "button", "aria-label": "Next day", "data-focus": "next", disabled: filters.end >= today, onclick: () => update({ end: addDays(filters.end, 1) }) },
              "→",
            ),
            filters.end === today ? null : h("button", { class: "btn btn--sm", type: "button", onclick: () => update({ end: today }) }, "Today"),
          ),
          isDefault ? null : h("button", { class: "btn btn--sm btn--quiet scope__reset", type: "button", onclick: () => update({ end: today, span: DEFAULT_USER_SPAN, client: "", model: "" }) }, "Reset"),
        ),
        chipRow("Tool", [
          chip({ label: "All tools", selected: !filters.client, focus: "client:", onclick: () => update({ client: "", model: "" }) }),
          options.clients.map(({ value, slot }) => chip({ label: clientLabel(value), slot, selected: filters.client === value, focus: `client:${value}`, onclick: () => toggleClient(value) })),
        ]),
        options.models.length > 1 || filters.model
          ? chipRow("Model", [
              chip({ label: "All models", selected: !filters.model, focus: "model:", onclick: () => update({ model: "" }) }),
              options.models.map((model) => chip({ label: model, selected: filters.model === model, focus: `model:${model}`, onclick: () => toggleModel(model) })),
            ])
          : null,
      );
    };

    const drawWindow = () => {
      const summary = summarizeWindow(detail, filters);
      const scope = filterLabel(filters);
      windowTitle.textContent = rangeLabel(filters);
      windowMeta.textContent = scope ? `Filtered to ${scope}` : "All tools and models";
      clear(kpiSlot).append(...kpiGrid(summary, filters.span));
      clear(notesSlot).append(...windowNotes(summary, filters).map((note) => h("li", {}, note)));
      hoursMeta.textContent = `Local time of the syncing device · ${rangeLabel(filters)}${filters.client ? ` · ${clientLabel(filters.client)}` : ""}`;
      clear(hoursSlot).append(summary.hours ? renderHours(summary.hours, { label: `Tokens per hour of day, ${rangeLabel(filters)}` }) : h("p", { class: "muted" }, "No hourly data for this window."));
      const key = metricKey(filters.metric);
      breakdownMeta.textContent = `${rangeLabel(filters)} · ${metricLabel(filters.metric)}. Pick a tool or model to filter the page.`;
      clear(breakdownSlot).append(
        renderBreakdown(groupByClient(windowByClientModel(detail, filters, filters.metric), key), {
          metric: filters.metric,
          empty: "Nothing recorded in this window.",
          filters,
          onClient: toggleClient,
          onModel: filters.metric === "prompts" ? null : toggleModel,
        }),
      );
    };

    const drawCharts = () => {
      const { metric } = filters;
      const key = metricKey(metric);
      const daily = dailySeries(detail, filters);
      const yearTotal = daily.filter((d) => d.day > addDays(today, -USER_HISTORY_DAYS)).reduce((sum, d) => sum + (d[key] ?? 0), 0);
      const scope = filterLabel(filters);
      heatmapTotal.textContent = `${formatMetric(metric, yearTotal)} ${metric === "cost" ? "API-equivalent" : metricLabel(metric).toLowerCase()} in the last 365 days${scope ? ` · ${scope}` : ""}. Pick a day to open it.`;
      const cell = heatmapCellFor(heatmapSlot.clientWidth, 54, { min: 11, max: 18 });
      const selected = new Set(filters.span < USER_HISTORY_DAYS ? dayRange(filters.end, filters.span) : []);
      clear(heatmapSlot).append(renderHeatmap({ daily, end: today, days: 365, key, metric, cell, selected, onSelect: selectDay, label: `${metricLabel(metric)} per day, last 365 days` }));
      disposeTrend?.();
      disposeTrend = renderTrend(trendSlot, daily, { metric, end: today, days: 365, onSelect: selectDay });
      for (const scroller of view.querySelectorAll(".chart-scroll")) scroller.scrollLeft = scroller.scrollWidth;
    };

    const redraw = () => {
      const focus = document.activeElement?.dataset?.focus;
      drawScope();
      drawWindow();
      drawCharts();
      if (focus) view.querySelector(`[data-focus="${CSS.escape(focus)}"]`)?.focus();
    };

    const deviceCount = detail.deviceCount ?? detail.devices.length;
    const devices = detail.devices.length
      ? h(
          "ul",
          { class: "device-mini" },
          detail.devices.map((device) =>
            h("li", {}, h("span", { class: "device-mini__name" }, device.name), h("span", { class: "muted" }, `Last sync ${relativeTime(device.lastSyncAt)}`)),
          ),
        )
      : h("p", { class: "muted" }, deviceCount ? `${deviceCount} ${deviceCount === 1 ? "device" : "devices"} registered.` : "No devices registered.");

    clear(view).append(
      h(
        "div",
        { class: "view-user" },
        h("a", { class: "back-link", href: ctx.href({ name: "leaderboard" }) }, h("span", { "aria-hidden": "true" }, "←"), "Leaderboard"),
        h(
          "header",
          { class: "profile" },
          h("img", { class: "avatar avatar--lg", src: detail.user.avatarUrl, alt: "", width: 72, height: 72 }),
          h(
            "div",
            { class: "profile__text" },
            h("h1", { class: "view__title" }, name, isMe ? h("span", { class: "tag tag--lg" }, "You") : null),
            h("p", { class: "profile__links" }, githubLink(detail.user.login, { label: "GitHub profile", className: "btn btn--sm gh-button" }), h("span", { class: "muted" }, `@${detail.user.login}`)),
          ),
          h("div", { class: "profile__metric" }, metricSwitch(filters.metric, (metric) => update({ metric }))),
        ),
        totalsStrip(detail.totals),
        scopeSlot,
        h("section", { class: "detail-card card window-card" }, windowTitle, windowMeta, kpiSlot, notesSlot),
        h(
          "div",
          { class: "detail-grid" },
          panel("Tools and models", breakdownMeta, breakdownSlot),
          panel("Hours of day", hoursMeta, hoursSlot),
        ),
        panel("Last 365 days", heatmapTotal, heatmapSlot),
        panel("Daily trend", trendSlot),
        panel(isMe ? "Your devices" : "Devices", devices, isMe ? h("a", { class: "detail-card__link", href: ctx.href({ name: "devices" }) }, "Manage devices") : null),
      ),
    );
    redraw();
  };

  api
    .get(`/api/users/${encodeURIComponent(login)}`)
    .then((detail) => alive && draw(detail))
    .catch((error) => {
      if (!alive) return;
      clear(view).append(
        h(
          "section",
          { class: "panel card", role: error.status === 404 ? null : "alert" },
          h("h1", { class: "panel__title" }, error.status === 404 ? `No player called @${login}.` : "This profile did not load."),
          h("p", { class: "panel__lead" }, error.status === 404 ? "They may not have signed in yet, or the login is misspelled." : error.message),
          h("a", { class: "btn btn--ink", href: ctx.href({ name: "leaderboard" }) }, "Back to the leaderboard"),
        ),
      );
    });
};
