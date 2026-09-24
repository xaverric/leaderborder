import { api, signInHref } from "./api.js";
import { isoDay } from "./lib/dates.js";
import { compactParts, formatCompact, formatDay, formatInteger, formatUsd, relativeTime } from "./lib/format.js";
import { activityFacts } from "./lib/heatmap.js";
import { clientSlot } from "./lib/share.js";
import { heatmapCellFor, renderHeatmap } from "./ui/charts.js";
import { clear, h, reducedMotion } from "./ui/dom.js";

const FORMATS = {
  compact: formatCompact,
  integer: formatInteger,
  usd: formatUsd,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const easeOut = (t) => 1 - (1 - t) ** 3;

const figureNodes = (parts, value) => [
  `${parts.sign}${value.toFixed(parts.decimals)}`,
  parts.suffix ? h("span", { class: "unit" }, parts.suffix) : null,
];

const countUp = (el, target) => {
  const parts = compactParts(target);
  if (!parts) return;
  el.setAttribute("aria-label", formatCompact(target));
  if (reducedMotion() || target === 0) {
    el.replaceChildren(...figureNodes(parts, parts.value).filter(Boolean));
    return;
  }
  const started = performance.now();
  const duration = 900;
  const frame = (now) => {
    const t = Math.min(1, (now - started) / duration);
    el.replaceChildren(...figureNodes(parts, parts.value * easeOut(t)).filter(Boolean));
    if (t < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
};

let activityObserver = null;

const drawActivity = (daily) => {
  const host = $("[data-activity]");
  let lastCell = 0;
  const draw = () => {
    const cell = heatmapCellFor(host.clientWidth, 14, { max: 24 });
    if (cell === lastCell) return;
    lastCell = cell;
    clear(host).append(renderHeatmap({ daily, end: isoDay(new Date()), days: 90, label: "Tokens per day, last 90 days", cell, scroll: false }));
  };
  activityObserver?.disconnect();
  activityObserver = new ResizeObserver(draw);
  activityObserver.observe(host);
  draw();
};

const renderStats = (stats) => {
  for (const el of $$("[data-stat]")) {
    const value = stats[el.dataset.stat];
    if (el.classList.contains("hero__figure")) countUp(el, value);
    else el.textContent = FORMATS[el.dataset.format](value);
  }

  $("[data-stat-exact]").textContent = `${formatInteger(stats.tokensThisWeek)} tokens in the last 7 days`;
  $("[data-stat-updated]").textContent = `Live from the board, updated ${relativeTime(stats.updatedAt)}`;

  const facts = activityFacts(stats.daily, { end: isoDay(new Date()), days: 90 });
  $("[data-activity-total]").textContent = `${formatCompact(facts.total)} tokens`;
  $('[data-fact="busiest"]').textContent = facts.busiest ? formatCompact(facts.busiest.value) : "-";
  $('[data-fact="busiestDay"]').textContent = facts.busiest ? formatDay(facts.busiest.day) : "no usage yet";
  $('[data-fact="average"]').textContent = formatCompact(Math.round(facts.average));
  $('[data-fact="activeDays"]').textContent = formatInteger(facts.activeDays);
  drawActivity(stats.daily);

  const byClient = new Map(stats.topClients.map((c) => [c.client, c.tokens]));
  for (const row of $$("[data-tools] [data-client]")) {
    const tokens = byClient.get(row.dataset.client);
    const share = row.querySelector(".tool-row__share");
    if (!tokens || !stats.tokensThisWeek) {
      share.replaceChildren(h("span", { class: "meter", "aria-hidden": "true" }), h("span", { class: "tool-row__pct" }, "-"));
      share.setAttribute("aria-label", "No usage this week");
      continue;
    }
    const fraction = tokens / stats.tokensThisWeek;
    share.replaceChildren(
      h("span", { class: `meter series--${clientSlot(row.dataset.client)}`, "aria-hidden": "true" }, h("span", { class: "meter__fill", style: { "--fraction": fraction.toFixed(4) } })),
      h("span", { class: "tool-row__pct" }, `${Math.round(fraction * 100)}%`),
    );
    share.setAttribute("aria-label", `${Math.round(fraction * 100)}% of this week's tokens, ${formatCompact(tokens)}`);
  }

  const models = $("[data-models]");
  models.replaceChildren(
    ...(stats.topModels.length
      ? stats.topModels.map((m, i) =>
          h("li", { class: "models__row" }, h("span", { class: "models__rank" }, i + 1), h("span", { class: "models__name" }, m.model), h("span", { class: "models__value" }, formatCompact(m.tokens))),
        )
      : [h("li", { class: "models__row muted" }, "No usage recorded this week yet.")]),
  );
};

const renderStatsError = (retry) => {
  for (const el of $$("[data-stat]")) el.replaceChildren(h("span", { class: "placeholder" }, "-"));
  $("[data-stat-exact]").textContent = "Live numbers unavailable";
  $("[data-stat-updated]").textContent = "";
  for (const el of $$(".fact__value")) el.replaceChildren(h("span", { class: "placeholder" }, "-"));
  $('[data-fact="busiestDay"]').textContent = "";
  clear($("[data-activity]")).append(h("p", { class: "muted" }, "The activity chart appears here once live stats load."));
  $("[data-models]").replaceChildren(h("li", { class: "models__row muted" }, "Unavailable right now."));
  for (const share of $$(".tool-row__share")) share.replaceChildren();
  clear($("[data-stats-status]")).append(
    "Live stats could not be loaded. ",
    h("button", { class: "btn btn--sm", type: "button", onclick: retry }, "Try again"),
  );
};

const loadStats = async () => {
  clear($("[data-stats-status]"));
  try {
    renderStats(await api.get("/api/public/stats"));
  } catch {
    renderStatsError(loadStats);
  }
};

const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = h("textarea", { class: "sr-only", readonly: true });
    area.value = text;
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
};

const wireCopyButtons = () => {
  for (const button of $$("[data-copy]")) {
    let timer = null;
    button.setAttribute("aria-label", `Copy ${button.dataset.copy}`);
    button.addEventListener("click", async () => {
      const ok = await copyText(button.dataset.copy);
      button.dataset.state = ok ? "copied" : "failed";
      button.textContent = ok ? "Copied" : "Select it";
      clearTimeout(timer);
      timer = setTimeout(() => {
        delete button.dataset.state;
        button.textContent = "Copy";
      }, 2500);
    });
  }
};

for (const link of $$("[data-signin]")) link.href = signInHref("/app");
wireCopyButtons();
loadStats();
