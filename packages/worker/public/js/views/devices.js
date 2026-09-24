import { api } from "../api.js";
import { formatDay, relativeTime } from "../lib/format.js";
import { clear, h } from "../ui/dom.js";
import { toast } from "../ui/toast.js";

const byCreated = (a, b) => (a.createdAt < b.createdAt ? 1 : -1);

export const renderDevices = (view, ctx) => {
  ctx.setTitle("Your devices");
  let devices = [...(ctx.me?.devices ?? [])].sort(byCreated);
  const pending = new Set();
  const list = h("ul", { class: "devices", "aria-label": "Registered devices" });
  const empty = h(
    "div",
    { class: "empty card" },
    h("p", { class: "empty__title" }, "No devices yet."),
    h("p", { class: "muted" }, "Run the Mac app and sign in with GitHub to register this Mac."),
    h("div", { class: "code-line" }, h("code", {}, "npx leaderborder")),
  );

  const draw = () => {
    const visible = devices.filter((device) => !pending.has(device.id));
    list.replaceChildren(
      ...visible.map((device) =>
        h(
          "li",
          { class: "device card" },
          h(
            "div",
            { class: "device__text" },
            h("p", { class: "device__name" }, device.name),
            h("p", { class: "device__meta muted" }, `Added ${formatDay(device.createdAt.slice(0, 10))} · ${device.lastSyncAt ? `Last sync ${relativeTime(device.lastSyncAt)}` : "Never synced"}`),
          ),
          h("button", { class: "btn btn--sm btn--danger", type: "button", onclick: () => revoke(device) }, "Revoke"),
        ),
      ),
    );
    empty.hidden = visible.length > 0;
  };

  const commit = async (device) => {
    try {
      await api.del(`/api/me/devices/${encodeURIComponent(device.id)}`);
      devices = devices.filter((d) => d.id !== device.id);
      if (ctx.me) ctx.me.devices = ctx.me.devices.filter((d) => d.id !== device.id);
      toast({ message: `${device.name} revoked.` });
    } catch (error) {
      if (error.status === 404) {
        devices = devices.filter((d) => d.id !== device.id);
        return;
      }
      toast({ tone: "error", message: `${device.name} was not revoked. ${error.message}`, action: { label: "Try again", run: () => revoke(device) }, timeout: 0 });
    } finally {
      pending.delete(device.id);
      if (list.isConnected) draw();
    }
  };

  function revoke(device) {
    pending.add(device.id);
    draw();
    toast({
      message: `${device.name} will be revoked.`,
      action: {
        label: "Undo",
        run: () => {
          pending.delete(device.id);
          if (list.isConnected) draw();
        },
      },
      onClose: (reason) => reason !== "action" && commit(device),
    });
  }

  const deleteAccount = async () => {
    if (!window.confirm("Delete your leaderborder account, all devices and all uploaded usage? This cannot be undone.")) return;
    try {
      await api.del("/api/me");
      window.location.assign("/");
    } catch (error) {
      toast({ tone: "error", message: `Account was not deleted. ${error.message}`, timeout: 0 });
    }
  };

  clear(view).append(
    h(
      "div",
      { class: "view-devices" },
      h(
        "header",
        { class: "view__head" },
        h("h1", { class: "view__title" }, "Your devices"),
        h("p", { class: "view__sub muted" }, "Every Mac that syncs has its own token. Revoking one signs it out; it has to sign in again before it can upload. Device tokens expire after 90 days."),
      ),
      list,
      empty,
      h(
        "section",
        { class: "card danger-zone" },
        h(
          "div",
          { class: "danger-zone__text" },
          h("h2", { class: "danger-zone__title" }, "Delete account"),
          h("p", { class: "danger-zone__desc muted" }, "Removes your profile, every device token and all usage you uploaded. Historical leaderboards will no longer include you."),
        ),
        h("button", { class: "btn btn--sm btn--danger", type: "button", onclick: deleteAccount }, "Delete my account and data"),
      ),
    ),
  );
  draw();

  api
    .get("/api/me")
    .then((me) => {
      devices = [...me.devices].sort(byCreated);
      draw();
    })
    .catch(() => draw());
};
