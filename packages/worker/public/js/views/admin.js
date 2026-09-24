import { api } from "../api.js";
import { relativeTime } from "../lib/format.js";
import { clear, h, skeleton } from "../ui/dom.js";
import { toast } from "../ui/toast.js";

const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;

const isLogin = (value) => LOGIN.test(value) && !value.endsWith("-");

const KIND_LABELS = { login: "GitHub user", org: "Organization" };

const avatar = (person) =>
  person.avatarUrl
    ? h("img", { class: "avatar avatar--sm", src: person.avatarUrl, alt: "", width: 28, height: 28, loading: "lazy" })
    : h("span", { class: "avatar avatar--sm", "aria-hidden": "true" });

const who = (person, meta) =>
  h(
    "div",
    { class: "admin-row__who" },
    avatar(person),
    h(
      "div",
      { class: "admin-row__text" },
      h("span", { class: "admin-row__name" }, person.name, " ", h("span", { class: "muted" }, `@${person.login}`), ...(person.tags ?? [])),
      meta ? h("span", { class: "admin-row__meta muted" }, meta) : null,
    ),
  );

const button = (label, onclick, variant = "") => h("button", { class: `btn btn--sm ${variant}`.trim(), type: "button", onclick }, label);

const busy = async (event, work) => {
  const target = event.currentTarget;
  target.setAttribute("aria-busy", "true");
  target.disabled = true;
  try {
    await work();
  } finally {
    target.removeAttribute("aria-busy");
    target.disabled = false;
  }
};

const section = (id, title, count, ...children) =>
  h(
    "section",
    { class: "admin-card card", "aria-labelledby": id },
    h("header", { class: "admin-card__head" }, h("h2", { class: "admin-card__title", id }, title), count === null ? null : h("span", { class: "tag" }, String(count))),
    ...children,
  );

const list = (rows) => h("ul", { class: "admin-list" }, rows);

export const renderAdmin = (view, ctx) => {
  ctx.setTitle("Admin");
  let data = null;

  const load = async () => {
    try {
      data = await api.get("/api/admin/overview");
      draw();
    } catch (error) {
      toast({ tone: "error", message: `Admin data could not be loaded. ${error.message}`, timeout: 0 });
    }
  };

  const act = (event, work, done) =>
    busy(event, async () => {
      try {
        await work();
        if (done) toast({ message: done });
        await load();
      } catch (error) {
        toast({ tone: "error", message: error.message, timeout: 0 });
      }
    });

  const requestRow = (request) =>
    h(
      "li",
      { class: "admin-row" },
      who(request, `Asked ${relativeTime(request.lastAttemptAt)}`),
      h(
        "div",
        { class: "admin-row__actions" },
        button("Approve", (event) => act(event, () => api.post(`/api/admin/requests/${encodeURIComponent(request.login)}/approve`), `@${request.login} can now sign in.`), "btn--accent"),
        request.status === "pending"
          ? button("Deny", (event) => act(event, () => api.post(`/api/admin/requests/${encodeURIComponent(request.login)}/deny`)))
          : null,
      ),
    );

  const requestsSection = () => {
    const pending = data.requests.filter((r) => r.status === "pending");
    const denied = data.requests.filter((r) => r.status === "denied");
    return section(
      "admin-requests",
      "Access requests",
      pending.length,
      pending.length
        ? list(pending.map(requestRow))
        : h("p", { class: "admin-empty muted" }, "No pending requests. People who sign in without access show up here."),
      denied.length
        ? h("details", { class: "admin-denied" }, h("summary", {}, `Denied (${denied.length})`), list(denied.map(requestRow)))
        : null,
    );
  };

  const ruleForm = () => {
    const kind = h(
      "select",
      { name: "kind", "aria-label": "Rule type" },
      Object.entries(KIND_LABELS).map(([value, text]) => h("option", { value }, text)),
    );
    const value = h("input", { class: "input", name: "value", placeholder: "github-login or org", autocomplete: "off", spellcheck: false, required: true, maxlength: 39, "aria-label": "GitHub login or organization" });
    const submit = h("button", { class: "btn btn--sm btn--ink", type: "submit" }, "Add");
    const onsubmit = (event) => {
      event.preventDefault();
      const trimmed = value.value.trim();
      if (!isLogin(trimmed)) {
        value.setCustomValidity("Use a GitHub login or organization name.");
        value.reportValidity();
        return;
      }
      act({ currentTarget: submit }, async () => {
        await api.post("/api/admin/rules", { kind: kind.value, value: trimmed });
        value.value = "";
      });
    };
    value.addEventListener("input", () => value.setCustomValidity(""));
    return h("form", { class: "rule-form", onsubmit }, h("span", { class: "select" }, kind), value, submit);
  };

  const ruleRow = (rule) =>
    h(
      "li",
      { class: "admin-row" },
      h(
        "div",
        { class: "admin-row__text" },
        h("span", { class: "admin-row__name" }, h("span", { class: "tag tag--neutral" }, KIND_LABELS[rule.kind]), " ", rule.value),
        h("span", { class: "admin-row__meta muted" }, `Added ${relativeTime(rule.createdAt)}${rule.createdBy ? ` by @${rule.createdBy}` : ""}`),
      ),
      h("div", { class: "admin-row__actions" }, button("Remove", (event) => act(event, () => api.del(`/api/admin/rules/${rule.id}`)), "btn--danger")),
    );

  const publicSwitch = () => {
    const input = h("input", {
      type: "checkbox",
      role: "switch",
      class: "switch",
      checked: data.settings.publicAccess,
      "aria-describedby": "public-access-help",
      onchange: (event) => {
        const next = event.target.checked;
        act(event, () => api.put("/api/admin/settings", { publicAccess: next }), next ? "The board is open to everyone." : "The board is invite only again.");
      },
    });
    return h(
      "label",
      { class: "switch-row" },
      h(
        "span",
        { class: "switch-row__text" },
        h("span", { class: "switch-row__label" }, "Open to everyone"),
        h("span", { class: "muted", id: "public-access-help" }, "Anyone with a GitHub account can sign in and publish. Turn it off to allow only the people and organizations below."),
      ),
      input,
    );
  };

  const accessSection = () =>
    section(
      "admin-access",
      "Who can join",
      null,
      publicSwitch(),
      ruleForm(),
      data.rules.length ? list(data.rules.map(ruleRow)) : h("p", { class: "admin-empty muted" }, "No rules yet. Only you can sign in until you add people or approve a request."),
      h("p", { class: "admin-note muted" }, "Organization members are checked when they sign in. Their membership has to be visible to leaderborder, or the organization has to approve the app under Third-party access."),
    );

  const userRow = (user) => {
    const tags = [user.isAdmin ? h("span", { class: "tag" }, "Admin") : null, user.blocked ? h("span", { class: "tag tag--negative" }, "Blocked") : null].filter(Boolean);
    const meta = `${user.devices} ${user.devices === 1 ? "device" : "devices"} · ${user.lastSyncAt ? `last sync ${relativeTime(user.lastSyncAt)}` : "never synced"}`;
    const action = user.isAdmin
      ? null
      : user.blocked
        ? button("Unblock", (event) => act(event, () => api.post(`/api/admin/users/${encodeURIComponent(user.login)}/unblock`), `@${user.login} is unblocked.`))
        : button("Block", (event) => act(event, () => api.post(`/api/admin/users/${encodeURIComponent(user.login)}/block`), `@${user.login} is blocked.`), "btn--danger");
    return h("li", { class: "admin-row" }, who({ ...user, tags }, meta), action ? h("div", { class: "admin-row__actions" }, action) : null);
  };

  const usersSection = () => section("admin-users", "People", data.users.length, list(data.users.map(userRow)));

  const head = h(
    "header",
    { class: "view__head" },
    h("h1", { class: "view__title" }, "Admin"),
    h("p", { class: "view__sub muted" }, "Who can join the board. Changes apply immediately, no redeploy needed."),
  );

  const draw = () => {
    clear(view).append(h("div", { class: "view-admin" }, head, requestsSection(), accessSection(), usersSection()));
  };

  clear(view).append(h("div", { class: "view-admin" }, head, h("section", { class: "admin-card card" }, skeleton("skeleton--title"), skeleton("skeleton--block"))));
  load();
};
