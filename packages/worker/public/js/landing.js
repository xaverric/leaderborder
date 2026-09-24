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

const WEEKLY_STATS = new Set(["tokensThisWeek", "costThisWeekUsd"]);

const renderHero = (stats, suppressed) => {
  countUp($(".hero__figure"), suppressed ? stats.tokensAllTime : stats.tokensThisWeek);
  $("[data-stat-exact]").textContent = suppressed
    ? `${formatInteger(stats.tokensAllTime)} tokens tracked so far`
    : `${formatInteger(stats.tokensThisWeek)} tokens in the last 7 days`;
  $("[data-stat-updated]").textContent = suppressed
    ? `Weekly numbers go live once ${stats.minGroup} players are active this week (${stats.activeThisWeek} of ${stats.minGroup} now).`
    : `Live from the board, updated ${relativeTime(stats.updatedAt)}`;
};

const renderStripStats = (stats, suppressed) => {
  for (const el of $$(".stat-strip [data-stat]")) {
    const key = el.dataset.stat;
    el.textContent = suppressed && WEEKLY_STATS.has(key) ? "-" : FORMATS[el.dataset.format](stats[key]);
  }
};

const noteRow = (text) => h("li", { class: "models__row models__row--note muted" }, text);

const renderStats = (stats) => {
  const suppressed = stats.suppressed === true;
  renderHero(stats, suppressed);
  renderStripStats(stats, suppressed);
  clear($("[data-stats-status]")).append(
    suppressed ? `Weekly details stay hidden until ${stats.minGroup} players are active this week, so nobody's own usage shows up publicly.` : "",
  );

  const facts = activityFacts(stats.daily, { end: isoDay(new Date()), days: 90 });
  const fact = (text) => (suppressed ? "-" : text);
  $("[data-activity-total]").textContent = suppressed ? "" : `${formatCompact(facts.total)} tokens`;
  $('[data-fact="busiest"]').textContent = fact(facts.busiest ? formatCompact(facts.busiest.value) : "-");
  $('[data-fact="busiestDay"]').textContent = suppressed ? "" : facts.busiest ? formatDay(facts.busiest.day) : "no usage yet";
  $('[data-fact="average"]').textContent = fact(formatCompact(Math.round(facts.average)));
  $('[data-fact="activeDays"]').textContent = fact(formatInteger(facts.activeDays));
  if (suppressed) clear($("[data-activity]")).append(h("p", { class: "muted" }, `Daily activity appears once ${stats.minGroup} players are active this week.`));
  else drawActivity(stats.daily);

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
  const modelRows = stats.topModels.map((m, i) =>
    h("li", { class: "models__row" }, h("span", { class: "models__rank" }, i + 1), h("span", { class: "models__name" }, m.model), h("span", { class: "models__value" }, formatCompact(m.tokens))),
  );
  const emptyModels = suppressed ? `Appears once ${stats.minGroup} players are active this week.` : "No usage recorded this week yet.";
  models.replaceChildren(...(modelRows.length ? modelRows : [noteRow(emptyModels)]));
};

const renderStatsError = (retry) => {
  for (const el of $$("[data-stat]")) el.replaceChildren(h("span", { class: "placeholder" }, "-"));
  $("[data-stat-exact]").textContent = "Live numbers unavailable";
  $("[data-stat-updated]").textContent = "";
  for (const el of $$(".fact__value")) el.replaceChildren(h("span", { class: "placeholder" }, "-"));
  $('[data-fact="busiestDay"]').textContent = "";
  clear($("[data-activity]")).append(h("p", { class: "muted" }, "The activity chart appears here once live stats load."));
  $("[data-models]").replaceChildren(noteRow("Unavailable right now."));
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

const APP_HREF = "/app";

const openLink = (link, label) => {
  link.href = APP_HREF;
  link.removeAttribute("data-signin");
  link.replaceChildren(label);
};

const rankLine = (me) =>
  me.rank
    ? h("p", { class: "hero__me" }, `Signed in as @${me.user.login}. You are `, h("strong", {}, `#${formatInteger(me.rank.position)}`), ` of ${formatInteger(me.rank.of)} this week.`)
    : h("p", { class: "hero__me" }, `Signed in as @${me.user.login}. Install the app and sync to join this week's board.`);

const renderSignedIn = (me) => {
  const nav = $(".nav-pill [data-signin]");
  if (nav) {
    const avatar = me.user.avatarUrl ? h("img", { class: "avatar avatar--xs", src: me.user.avatarUrl, alt: "", width: 20, height: 20 }) : null;
    nav.classList.add("nav-me");
    nav.href = APP_HREF;
    nav.removeAttribute("data-signin");
    nav.setAttribute("aria-label", `Open leaderboard, signed in as ${me.user.login}`);
    nav.replaceChildren(...[avatar, "Leaderboard"].filter(Boolean));
  }
  const hero = $(".hero__actions [data-signin]");
  if (hero) {
    openLink(hero, "Open leaderboard");
    $(".hero__actions").after(rankLine(me));
  }
};

const loadSession = async () => {
  try {
    renderSignedIn(await api.get("/api/me"));
  } catch {
    return;
  }
};

for (const link of $$("[data-signin]")) link.href = signInHref("/app");
wireCopyButtons();
loadSession();
loadStats();
