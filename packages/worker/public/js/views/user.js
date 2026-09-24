import { api } from "../api.js";
import { groupByClient } from "../lib/breakdown.js";
import { isoDay } from "../lib/dates.js";
import { formatCompact, formatInteger, formatMetric, formatUsd, relativeTime } from "../lib/format.js";
import { metricKey, metricLabel } from "../lib/period.js";
import { heatmapCellFor, renderBreakdown, renderHeatmap } from "../ui/charts.js";
import { clear, h, skeleton } from "../ui/dom.js";
import { renderTrend } from "../ui/trend.js";
import { githubLink } from "../ui/github.js";

const METRIC_OPTIONS = [
  ["tokens", "Tokens"],
  ["tokens_nocache", "Without cache"],
  ["cost", "Cost"],
];

const metricSwitch = (value, onchange) =>
  h(
    "fieldset",
    { class: "segmented segmented--compact" },
    h("legend", { class: "sr-only" }, "Metric"),
    h(
      "div",
      { class: "segmented__track" },
      METRIC_OPTIONS.map(([metric, label]) =>
        h(
          "label",
          { class: "segmented__option" },
          h("input", { type: "radio", name: "detail-metric", value: metric, checked: metric === value, onchange: () => onchange(metric) }),
          h("span", {}, label),
        ),
      ),
    ),
  );

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
  let metric = "tokens";
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
    const today = isoDay(new Date());
    const heatmapSlot = h("div", { class: "detail-card__body" });
    const trendSlot = h("div", { class: "trend" });
    const breakdownSlot = h("div", { class: "detail-card__body" });
    const heatmapTotal = h("p", { class: "detail-card__meta muted tnum" });

    const drawCharts = () => {
      const key = metricKey(metric);
      const yearTotal = detail.daily.reduce((sum, d) => sum + (d[key] ?? 0), 0);
      heatmapTotal.textContent = `${formatMetric(metric, yearTotal)} ${metric === "cost" ? "API-equivalent" : metricLabel(metric).toLowerCase()} in the last 365 days`;
      const cell = heatmapCellFor(heatmapSlot.clientWidth, 54, { min: 11, max: 18 });
      clear(heatmapSlot).append(renderHeatmap({ daily: detail.daily, end: today, days: 365, key, metric, cell, label: `${metricLabel(metric)} per day, last 365 days` }));
      disposeTrend?.();
      disposeTrend = renderTrend(trendSlot, detail.daily, { metric, end: today, days: 365 });
      for (const scroller of view.querySelectorAll(".chart-scroll")) scroller.scrollLeft = scroller.scrollWidth;
      clear(breakdownSlot).append(renderBreakdown(groupByClient(detail.byClientModel, key), { metric }));
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
          h("div", { class: "profile__metric" }, metricSwitch(metric, (next) => {
            metric = next;
            drawCharts();
          })),
        ),
        totalsStrip(detail.totals),
        panel("Last 365 days", heatmapTotal, heatmapSlot),
        panel("Daily trend", trendSlot),
        h(
          "div",
          { class: "detail-grid" },
          panel("Tools and models", breakdownSlot),
          panel(isMe ? "Your devices" : "Devices", devices, isMe ? h("a", { class: "detail-card__link", href: ctx.href({ name: "devices" }) }, "Manage devices") : null),
        ),
      ),
    );
    drawCharts();
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
