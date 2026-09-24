import { buildHeatmap } from "../lib/heatmap.js";
import { formatDay, formatDayShort, formatMetric } from "../lib/format.js";
import { clientLabel, shareSegments } from "../lib/share.js";
import { sparklinePath } from "../lib/sparkline.js";
import { h, svg } from "./dom.js";

const LEFT = 30;
const TOP = 18;
const WEEKDAYS = [
  [0, "Mon"],
  [2, "Wed"],
  [4, "Fri"],
];

export const heatmapCellFor = (width, weeks, { min = 10, max = 30 } = {}) =>
  Math.max(min, Math.min(max, Math.floor(((width - LEFT) / weeks) * 0.8)));

export const renderHeatmap = ({ daily, end, days, key = "tokens", metric = "tokens", label, cell = 12, scroll = true }) => {
  const CELL = cell;
  const GAP = Math.max(2, Math.round(cell * 0.24));
  const STEP = CELL + GAP;
  const map = buildHeatmap(daily, { end, days, key });
  const width = LEFT + map.weeks.length * STEP;
  const height = TOP + 7 * STEP;
  const cells = [];
  const readout = h("p", { class: "heatmap__readout", "aria-live": "polite" }, "Hover or tap a day to read it.");

  const describe = (cell) => `${formatDay(cell.day)} · ${cell.value ? formatMetric(metric, cell.value) : "no usage"}`;

  const rects = map.weeks.flatMap((week, col) =>
    week.map((cell, row) => {
      if (!cell) return null;
      const rect = svg("rect", {
        x: LEFT + col * STEP,
        y: TOP + row * STEP,
        width: CELL,
        height: CELL,
        rx: Math.min(4, Math.max(2, Math.round(CELL * 0.16))),
        class: `heat heat--${cell.level}`,
        "data-index": cells.length,
      });
      cells.push({ ...cell, rect });
      return rect;
    }),
  );

  let active = -1;
  const activate = (index) => {
    if (index < 0 || index >= cells.length) return;
    cells[active]?.rect.classList.remove("is-active");
    active = index;
    cells[active].rect.classList.add("is-active");
    readout.textContent = describe(cells[active]);
  };

  const graphic = svg(
    "svg",
    {
      class: "heatmap__svg",
      viewBox: `0 0 ${width} ${height}`,
      width,
      height,
      role: "img",
      tabindex: 0,
      "aria-label": `${label}: ${formatMetric(metric, map.total)} over ${map.activeDays} active days`,
      onpointerover: (event) => {
        const index = event.target.dataset?.index;
        if (index !== undefined) activate(Number(index));
      },
      onkeydown: (event) => {
        const moves = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1, Home: -Infinity, End: Infinity };
        if (!(event.key in moves)) return;
        event.preventDefault();
        const move = moves[event.key];
        const next = active < 0 ? cells.length - 1 : active + move;
        activate(Math.max(0, Math.min(cells.length - 1, Number.isFinite(next) ? next : move < 0 ? 0 : cells.length - 1)));
      },
      onfocus: () => active < 0 && activate(cells.length - 1),
    },
    map.months.map(({ col, label: text }) => svg("text", { x: LEFT + col * STEP, y: 11, class: "heatmap__label" }, text)),
    WEEKDAYS.map(([row, text]) => svg("text", { x: 0, y: TOP + row * STEP + CELL - 2, class: "heatmap__label" }, text)),
    rects,
  );

  const legend = h(
    "div",
    { class: "heatmap__legend", "aria-hidden": "true" },
    h("span", {}, "Less"),
    [0, 1, 2, 3, 4].map((level) => h("span", { class: `heat-swatch heat--${level}` })),
    h("span", {}, "More"),
  );

  return h(
    "figure",
    { class: "heatmap" },
    h("div", { class: scroll ? "chart-scroll" : "heatmap__frame" }, graphic),
    h("figcaption", { class: "heatmap__foot" }, readout, legend),
  );
};

export const renderSparkline = (points = [], { width = 120, height = 28, label = "" } = {}) => {
  const values = points.map((p) => p.value);
  const path = sparklinePath(values, { width, height, pad: 3 });
  const last = path.split(/[ML]/).filter(Boolean).at(-1)?.split(" ").map(Number);
  return svg(
    "svg",
    { class: "spark", viewBox: `0 0 ${width} ${height}`, width, height, role: "img", "aria-label": label },
    svg("path", { d: path, class: "spark__line" }),
    last ? svg("circle", { cx: last[0], cy: last[1], r: 2.75, class: "spark__dot" }) : null,
  );
};

export const renderShareBar = (byClient, { metric = "tokens", limit = 4 } = {}) => {
  const segments = shareSegments(byClient, { limit });
  const summary = segments.map((s) => `${clientLabel(s.client)} ${Math.round(s.fraction * 100)}%`).join(", ");
  return h(
    "div",
    { class: "share", role: "img", "aria-label": summary ? `Share by tool: ${summary}` : "No usage" },
    segments.map((s) =>
      h("span", {
        class: `share__seg series--${s.slot}`,
        style: { "flex-grow": s.fraction.toFixed(4) },
        title: `${clientLabel(s.client)}: ${formatMetric(metric, s.value)} (${Math.round(s.fraction * 100)}%)`,
      }),
    ),
  );
};

export const renderLegend = (clients) =>
  h(
    "ul",
    { class: "legend" },
    clients.map((client) => h("li", {}, h("span", { class: `legend__swatch series--${client.slot}`, "aria-hidden": "true" }), clientLabel(client.client))),
  );

export const renderBreakdown = (groups, { metric }) => {
  const total = groups.reduce((sum, g) => sum + g.total, 0);
  if (!total) return h("p", { class: "muted" }, "No usage recorded yet.");
  const rows = groups.map((group) =>
    h(
      "li",
      { class: "breakdown__row" },
      h(
        "div",
        { class: "breakdown__head" },
        h("span", { class: `legend__swatch series--${group.slot}`, "aria-hidden": "true" }),
        h("span", { class: "breakdown__client" }, clientLabel(group.client)),
        h("span", { class: "breakdown__value tnum" }, formatMetric(metric, group.total)),
        h("span", { class: "breakdown__pct tnum" }, `${Math.round((group.total / total) * 100)}%`),
      ),
      h(
        "div",
        { class: "breakdown__bar", style: { "--bar": `${((group.total / groups[0].total) * 100).toFixed(2)}%` }, "aria-hidden": "true" },
        group.models.map((model, i) =>
          h("span", {
            class: `breakdown__seg series--${group.slot} shade--${Math.min(i, 3)}`,
            style: { "flex-grow": model.fraction.toFixed(4) },
            title: `${model.model}: ${formatMetric(metric, model.value)}`,
          }),
        ),
      ),
      h(
        "ul",
        { class: "breakdown__models" },
        group.models.map((model, i) =>
          h(
            "li",
            {},
            h("span", { class: `breakdown__key series--${group.slot} shade--${Math.min(i, 3)}`, "aria-hidden": "true" }),
            h("span", { class: "breakdown__model" }, model.model),
            h("span", { class: "tnum muted" }, formatMetric(metric, model.value)),
          ),
        ),
      ),
    ),
  );
  return h("ol", { class: "breakdown" }, rows);
};

export const dayTick = (day) => formatDayShort(day);
