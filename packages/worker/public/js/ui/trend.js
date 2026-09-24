import uPlot from "/vendor/uPlot.esm.js";
import { dayRange } from "../lib/dates.js";
import { formatCompact, formatDay, formatMetric, formatUsd } from "../lib/format.js";
import { metricKey } from "../lib/period.js";
import { h } from "./dom.js";

const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });

const tokenRgb = (name) => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = value || "gray";
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
};

const rgba = ([r, g, b], a = 1) => `rgba(${r}, ${g}, ${b}, ${a})`;

const toSeconds = (day) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / 1000;

const tooltipPlugin = (metric, tip) => ({
  hooks: {
    setCursor: (u) => {
      const index = u.cursor.idx;
      if (index === null || index === undefined || u.cursor.left < 0) {
        tip.hidden = true;
        return;
      }
      const day = new Date(u.data[0][index] * 1000).toISOString().slice(0, 10);
      tip.replaceChildren(h("span", { class: "trend__tip-day" }, formatDay(day)), h("strong", { class: "tnum" }, formatMetric(metric, u.data[1][index])));
      tip.hidden = false;
      const x = u.valToPos(u.data[0][index], "x");
      const flip = x > u.over.clientWidth - 140;
      tip.style.transform = `translate(${Math.round(flip ? x - 12 : x + 12)}px, 8px) translateX(${flip ? "-100%" : "0"})`;
    },
  },
});

export const renderTrend = (container, daily, { metric, end, days = 365 }) => {
  const key = metricKey(metric);
  const byDay = new Map(daily.map((row) => [row.day, row[key]]));
  const range = dayRange(end, days);
  const data = [range.map(toSeconds), range.map((day) => byDay.get(day) ?? 0)];
  const line = tokenRgb("--series-1");
  const ink = rgba(tokenRgb("--color-muted"));
  const grid = rgba(tokenRgb("--color-rule"));
  const font = `12px ${getComputedStyle(document.documentElement).getPropertyValue("--font-body").trim()}`;
  const tip = h("div", { class: "trend__tip", hidden: true });
  const plotHost = h("div", { class: "trend__plot" });
  container.replaceChildren(h("div", { class: "chart-scroll", tabindex: -1 }, h("div", { class: "trend__inner" }, plotHost)));

  const size = () => ({ width: Math.max(Math.floor(plotHost.getBoundingClientRect().width), 320), height: 240 });
  const axis = {
    stroke: ink,
    font,
    grid: { stroke: grid, width: 1 },
    ticks: { show: false },
  };

  const plot = new uPlot(
    {
      ...size(),
      legend: { show: false },
      cursor: { points: { size: 8, fill: rgba(line), stroke: rgba(tokenRgb("--color-card")), width: 2 }, y: false, drag: { x: false, y: false } },
      scales: { x: { time: true }, y: { range: (u, min, max) => [0, max > 0 ? max * 1.1 : 1] } },
      axes: [
        { ...axis, grid: { show: false }, space: 64 },
        { ...axis, side: 1, size: 56, values: (u, ticks) => ticks.map((v) => (metric === "cost" ? formatUsd(v) : formatCompact(v))) },
      ],
      series: [{}, { stroke: rgba(line), width: 2, fill: rgba(line, 0.1), points: { show: false } }],
      plugins: [tooltipPlugin(metric, tip)],
    },
    data,
    plotHost,
  );
  plot.over.append(tip);

  const observer = new ResizeObserver(() => plot.setSize(size()));
  observer.observe(plotHost);
  return () => {
    observer.disconnect();
    plot.destroy();
  };
};
