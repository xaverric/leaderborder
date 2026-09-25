import { api, signInHref } from "./api.js";
import { parseRoute, routeHref, routeMode } from "./lib/route.js";
import { clear, h } from "./ui/dom.js";
import { toast } from "./ui/toast.js";
import { renderAdmin } from "./views/admin.js";
import { renderDevices } from "./views/devices.js";
import { renderLeaderboard } from "./views/leaderboard.js";
import { renderUser } from "./views/user.js";

const mode = routeMode(location.pathname);
const view = document.querySelector("#view");
const $ = (selector) => document.querySelector(selector);

const state = { me: null, cleanups: [], first: true };

const currentRoute = () => parseRoute(location.pathname, location.hash.split("?")[0]);

const href = (route) => routeHref(route, mode);

const runCleanups = () => {
  for (const fn of state.cleanups.splice(0)) fn();
};

const setSearch = (search) => {
  const url = new URL(location.href);
  const keep = new URLSearchParams(url.search);
  for (const key of ["period", "metric", "client", "model", "day", "span"]) keep.delete(key);
  const next = new URLSearchParams(search);
  for (const [key, value] of next) keep.set(key, value);
  url.search = keep.toString();
  history.replaceState(null, "", url);
};

const navigate = (route) => {
  if (mode === "hash") {
    location.hash = href(route).slice(1);
    return;
  }
  history.pushState(null, "", href(route));
  render();
};

const ctx = {
  get me() {
    return state.me;
  },
  href,
  navigate,
  setSearch,
  onCleanup: (fn) => state.cleanups.push(fn),
  setTitle: (title) => {
    document.title = `${title} - leaderborder`;
  },
};

const syncNav = (route) => {
  for (const link of document.querySelectorAll("[data-route]")) {
    const target = link.dataset.route === "self" ? { name: "user", login: state.me?.user.login ?? "" } : { name: link.dataset.route };
    link.href = href(target);
    const current = link.dataset.route === route.name || (link.dataset.route === "self" && route.name === "user" && route.login === state.me?.user.login);
    if (current) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  $("[data-me]").open = false;
};

const renderNotFound = () => {
  ctx.setTitle("Not found");
  clear(view).append(
    h(
      "section",
      { class: "panel card" },
      h("h1", { class: "panel__title" }, "Nothing lives here."),
      h("p", { class: "panel__lead" }, "That address does not match a page in the app."),
      h("a", { class: "btn btn--ink", href: href({ name: "leaderboard" }) }, "Open the leaderboard"),
    ),
  );
};

const render = () => {
  runCleanups();
  const route = currentRoute();
  syncNav(route);
  if (route.name === "leaderboard") renderLeaderboard(view, ctx);
  else if (route.name === "user") renderUser(view, ctx, route.login);
  else if (route.name === "devices") renderDevices(view, ctx);
  else if (route.name === "admin" && state.me?.isAdmin) renderAdmin(view, ctx);
  else renderNotFound();
  if (!state.first) {
    view.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }
  state.first = false;
};

const showChrome = (me) => {
  $("[data-nav]").hidden = !me;
  $("[data-me]").hidden = !me;
  $("[data-admin]").hidden = !me?.isAdmin;
  if (!me) return;
  if (me.user.avatarUrl) $("[data-me-avatar]").src = me.user.avatarUrl;
  $("[data-me-name]").textContent = me.user.name ?? me.user.login;
  $("[data-me-login]").textContent = `@${me.user.login}`;
};

const renderGate = ({ title, lead, action }) => {
  runCleanups();
  ctx.setTitle(title);
  clear(view).append(
    h(
      "section",
      { class: "panel panel--gate card" },
      h("h1", { class: "panel__title" }, title),
      h("p", { class: "panel__lead" }, lead),
      action,
      h("p", { class: "panel__foot muted" }, "New here? ", h("a", { href: "/#install" }, "Install the Mac app"), " first so there is something to rank."),
    ),
  );
};

const signInAction = () =>
  h("a", { class: "btn btn--accent", href: signInHref(`${location.pathname}${location.search}${location.hash}`) }, "Sign in with GitHub");

const renderSignIn = (signedOut = false) =>
  renderGate({
    title: signedOut ? "You are signed out." : "Sign in to see the board.",
    lead: "The leaderboard and everyone's stats are visible to signed-in players only. Sign-in uses your GitHub account.",
    action: signInAction(),
  });

const renderForbidden = (message) =>
  renderGate({
    title: "This board is invite-only.",
    lead: message || "Your GitHub account is not on the list of allowed people or organizations for this board.",
    action: h("a", { class: "btn", href: "/" }, "Back to the homepage"),
  });

const renderBootError = (error) => {
  clear(view).append(
    h(
      "section",
      { class: "panel card", role: "alert" },
      h("h1", { class: "panel__title" }, "The board did not load."),
      h("p", { class: "panel__lead" }, error.message),
      h("button", { class: "btn btn--ink", type: "button", onclick: boot }, "Try again"),
    ),
  );
};

const signOut = async (button) => {
  button.setAttribute("aria-busy", "true");
  try {
    await api.post("/auth/logout");
    state.me = null;
    showChrome(null);
    renderSignIn(true);
  } catch (error) {
    toast({ tone: "error", message: `Sign out failed. ${error.message}`, action: { label: "Try again", run: () => signOut(button) } });
  } finally {
    button.removeAttribute("aria-busy");
  }
};

async function boot() {
  try {
    state.me = await api.get("/api/me");
    showChrome(state.me);
    render();
  } catch (error) {
    showChrome(null);
    if (error.status === 401) renderSignIn();
    else if (error.status === 403) renderForbidden(error.message);
    else renderBootError(error);
  }
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[href]");
  if (!link || mode !== "path" || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
  const url = new URL(link.href);
  if (url.origin !== location.origin || !(url.pathname === "/app" || url.pathname.startsWith("/app/"))) return;
  event.preventDefault();
  history.pushState(null, "", url);
  render();
});

document.addEventListener("click", (event) => {
  const menu = $("[data-me]");
  if (menu.open && !menu.contains(event.target)) menu.open = false;
});

document.addEventListener("keydown", (event) => {
  const menu = $("[data-me]");
  if (event.key === "Escape" && menu.open) {
    menu.open = false;
    menu.querySelector("summary").focus();
  }
});

$("[data-signout]").addEventListener("click", (event) => signOut(event.currentTarget));

window.addEventListener(mode === "hash" ? "hashchange" : "popstate", () => state.me && render());

boot();
