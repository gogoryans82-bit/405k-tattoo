// frontend/public/assets/admin.js

const $ = (s, r = document) => r.querySelector(s);

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "style" && typeof v === "string") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    n.append(c.nodeType ? c : document.createTextNode(c));
  }
  return n;
}

const escAttr = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

function toLocalDT(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.hidden = true; }, 1800);
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api/admin${path}`, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { showLogin(); throw new Error("Not authenticated"); }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

function showLogin() {
  $("#login-view").hidden = false;
  $("#main-view").hidden = true;
}

async function showMain() {
  $("#login-view").hidden = true;
  $("#main-view").hidden = false;
  await Promise.all([
    loadBookings().catch(() => {}),
    loadPaymentMethods().catch(() => {}),
    loadArtists().catch(() => {}),
  ]);
}

// ── Login ───────────────────────────────────────────────────
$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#login-error").hidden = true;
  try {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: $("#login-email").value,
        password: $("#login-pass").value,
      }),
    });
    if (!res.ok) throw new Error((await res.json()).error || "Login failed");
    await showMain();
  } catch (err) {
    $("#login-error").textContent = err.message;
    $("#login-error").hidden = false;
  }
});

$("#logout").addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST", credentials: "same-origin" });
  showLogin();
});

// ── Tabs ────────────────────────────────────────────────────
document.querySelectorAll(".tabs button").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.hidden = true);
    btn.classList.add("active");
    $(`#tab-${btn.dataset.tab}`).hidden = false;
  });
});

// ── Bookings ────────────────────────────────────────────────
async function loadBookings() {
  const q = $("#bk-search").value.trim();
  const status = $("#bk-status").value;
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  const rows = await api(`/bookings?${params}`);
  const wrap = $("#bk-list");
  wrap.innerHTML = "";
  for (const b of rows) {
    const row = el("div", { class: "bk-row" },
      el("span", { class: "bk-ref" }, b.ref),
      el("span", {}, b.name),
      el("span", { style: "color:#666;font-size:.9rem;" }, b.email),
      el("span", {}, b.status),
      el("span", {}, b.appointment_at ? new Date(b.appointment_at).toLocaleDateString() : "—"),
      el("span", {}, b.deposit_paid ? "paid" : (b.deposit_amount ? "$"+b.deposit_amount : "—")),
    );
    row.addEventListener("click", () => openBooking(b.id));
    wrap.appendChild(row);
  }
}
$("#bk-search").addEventListener("input", () => {
  clearTimeout(window._sTimer);
  window._sTimer = setTimeout(loadBookings, 300);
});
$("#bk-status").addEventListener("change", loadBookings);

// ── Drawer ──────────────────────────────────────────────────
function closeDrawer() {
  $("#drawer").hidden = true;
  $("#drawer-backdrop").hidden = true;
}
$("#drawer-close").addEventListener("click", closeDrawer);
$("#drawer-backdrop").addEventListener("click", closeDrawer);

async function openBooking(id) {
  const b = await api(`/bookings/${id}`);
  const artists = await api("/artists");
  const methods = await api("/payment-methods");

  $("#drawer-title").textContent = `${b.ref} · ${b.name}`;
  $("#drawer-backdrop").hidden = false;
  $("#drawer").hidden = false;

  const body = $("#drawer-body");
  body.innerHTML = "";

  const statusSelect = el("select");
  ["pending","approved","scheduled","completed","cancelled"].forEach(s => {
    statusSelect.append(el("option", { value: s, selected: s === b.status ? "selected" : null }, s));
  });

  const artistSelect = el("select");
  artistSelect.append(el("option", { value: "" }, "— none —"));
  for (const a of artists) {
    artistSelect.append(el("option",
      { value: a.id, selected: a.id === b.artist_id ? "selected" : null },
      a.name));
  }

  const amountInput = el("input", {
    type: "number", min: "0", step: "1",
    value: b.deposit_amount ?? "",
  });
  const methodSelect = el("select");
  methodSelect.append(el("option", { value: "" }, "— none —"));
  for (const m of methods) {
    methodSelect.append(el("option",
      { value: m.key, selected: m.key === b.deposit_method ? "selected" : null },
      m.label + (m.enabled ? "" : " (disabled)")));
  }

  const dtInput = el("input", {
    type: "datetime-local",
    value: b.appointment_at ? toLocalDT(b.appointment_at) : "",
  });

  const notesInput = el("textarea", { rows: "3" }, b.notes || "");

  body.append(
    el("div", { class: "field" }, el("label", {}, "Status"), statusSelect),
    el("div", { class: "field" }, el("label", {}, "Artist"), artistSelect),
    el("div", { class: "field" }, el("label", {}, "Deposit amount ($)"), amountInput),
    el("div", { class: "field" }, el("label", {}, "Deposit method"), methodSelect),
    el("div", { class: "field" }, el("label", {}, "Appointment date & time"), dtInput),
    el("div", { class: "field" }, el("label", {}, "Internal notes"), notesInput),
  );

  const consultationRequired = el("input", { type: "checkbox", style: "width:auto;",
    checked: b.consultation_required ? "checked" : null });
  const consultationDone = el("input", { type: "checkbox", style: "width:auto;",
    checked: b.consultation_done ? "checked" : null });
  const consultationAt = el("input", { type: "datetime-local",
    value: b.consultation_at ? toLocalDT(b.consultation_at) : "" });
  const consultationArtist = el("select");
  consultationArtist.append(el("option", { value: "" }, "— none —"));
  for (const a of artists) {
    consultationArtist.append(el("option",
      { value: a.id, selected: a.id === b.consultation_artist_id ? "selected" : null },
      a.name));
  }
  const consultationNotes = el("textarea", { rows: "2" }, b.consultation_notes || "");

  body.appendChild(el("div", {
    style: "background:#fafafa;border:1px solid #eee;padding:14px;border-radius:4px;margin-top:12px;",
  },
    el("div", { style: "font-size:.72rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#666;margin-bottom:12px;" }, "Consultation"),
    el("label", { style: "display:flex;align-items:center;gap:10px;font-size:.95rem;color:#111;margin-bottom:10px;" },
      consultationRequired, "Require consultation"),
    el("div", { class: "field" }, el("label", {}, "Date & time"), consultationAt),
    el("div", { class: "field" }, el("label", {}, "With artist"), consultationArtist),
    el("label", { style: "display:flex;align-items:center;gap:10px;font-size:.95rem;color:#111;margin:10px 0;" },
      consultationDone, "Mark consultation complete"),
    el("div", { class: "field" }, el("label", {}, "Consultation notes (client-visible)"), consultationNotes),
  ));

  const saveBtn = el("button", {}, "Save changes");
  body.appendChild(el("div", { class: "actions" }, saveBtn));

  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      await api(`/bookings/${b.id}`, {
        method: "PATCH",
        body: {
          status: statusSelect.value,
          artist_id: artistSelect.value || null,
          deposit_amount: amountInput.value === "" ? null : Number(amountInput.value),
          deposit_method: methodSelect.value || null,
          appointment_at: dtInput.value || null,
          notes: notesInput.value || null,
          consultation_required: consultationRequired.checked ? 1 : 0,
          consultation_done: consultationDone.checked ? 1 : 0,
          consultation_at: consultationAt.value || null,
          consultation_artist_id: consultationArtist.value || null,
          consultation_notes: consultationNotes.value || null,
        },
      });
      toast("Saved ✓");
      loadBookings();
      closeDrawer();
    } catch (err) {
      alert(err.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save changes";
    }
  });
}

// ── Payment methods ─────────────────────────────────────────
async function loadPaymentMethods() {
  const list = await api("/payment-methods");
  const wrap = $("#pm-list");
  wrap.innerHTML = "";

  for (const m of list) {
    const row = el("div", { class: "pm-row" },
      el("label", { class: "pm-toggle" },
        el("input", { type: "checkbox", "data-f": "enabled", checked: m.enabled ? "checked" : null })),
      el("input", { class: "pm-input", "data-f": "label", value: m.label, placeholder: "Label" }),
      el("input", { class: "pm-input pm-key", "data-f": "key", value: m.key, placeholder: "key" }),
      el("input", { class: "pm-input", "data-f": "handle", value: m.handle || "", placeholder: "@handle" }),
      el("input", { class: "pm-input pm-num", "data-f": "min_deposit", type: "number", value: m.min_deposit ?? "", placeholder: "min $" }),
      el("input", { class: "pm-input pm-num", "data-f": "max_deposit", type: "number", value: m.max_deposit ?? "", placeholder: "max $" }),
      el("button", { class: "pm-save" }, "Save"),
      el("button", { class: "pm-del" }, "✕"),
    );

    row.querySelector(".pm-save").addEventListener("click", async () => {
      const body = {};
      for (const inp of row.querySelectorAll("[data-f]")) {
        const f = inp.dataset.f;
        if (inp.type === "checkbox") body[f] = inp.checked ? 1 : 0;
        else if (f === "min_deposit" || f === "max_deposit")
          body[f] = inp.value === "" ? null : Number(inp.value);
        else body[f] = inp.value || null;
      }
      try {
        await api(`/payment-methods/${m.id}`, { method: "PATCH", body });
        toast("Saved");
        loadPaymentMethods();
      } catch (err) { alert(err.message); }
    });

    row.querySelector(".pm-del").addEventListener("click", async () => {
      if (!confirm(`Delete "${m.label}"?`)) return;
      try {
        await api(`/payment-methods/${m.id}`, { method: "DELETE" });
        loadPaymentMethods();
      } catch (err) { alert(err.message); }
    });

    wrap.appendChild(row);
  }

  const { min_deposit_default } = await api("/settings/min-deposit");
  $("#pm-global-min").value = min_deposit_default;
}

$("#pm-global-min-save").addEventListener("click", async () => {
  const v = Number($("#pm-global-min").value);
  try {
    await api("/settings/min-deposit", { method: "PUT", body: { min_deposit_default: v } });
    toast("Minimum deposit updated");
  } catch (err) { alert(err.message); }
});

$("#pm-add").addEventListener("click", async () => {
  const key   = $("#pm-new-key").value.trim().toLowerCase();
  const label = $("#pm-new-label").value.trim();
  if (!key || !label) return alert("Key and label required");
  try {
    await api("/payment-methods", { method: "POST", body: { key, label } });
    $("#pm-new-key").value = "";
    $("#pm-new-label").value = "";
    loadPaymentMethods();
  } catch (err) { alert(err.message); }
});

// ── Artists ─────────────────────────────────────────────────
async function loadArtists() {
  const list = await api("/artists");
  const wrap = $("#ar-list");
  if (!wrap) return;
  wrap.innerHTML = "";

  for (const a of list) {
    const row = el("div", { class: "pm-row" });
    row.style.gridTemplateColumns = "44px 1.2fr 1fr 1fr 1.6fr 90px auto auto";
    row.innerHTML = `
      <label class="pm-toggle"><input type="checkbox" data-f="active" ${a.active ? "checked" : ""}></label>
      <input class="pm-input" data-f="name"          value="${escAttr(a.name || "")}"          placeholder="Name">
      <input class="pm-input" data-f="specialty"     value="${escAttr(a.specialty || "")}"     placeholder="Specialty">
      <input class="pm-input pm-key" data-f="slug"   value="${escAttr(a.slug || "")}"          placeholder="slug">
      <input class="pm-input" data-f="image_url"     value="${escAttr(a.image_url || "")}"     placeholder="Image URL">
      <input class="pm-input pm-num" data-f="sort_order" type="number" value="${a.sort_order ?? 0}">
      <button class="pm-save">Save</button>
      <button class="pm-del">✕</button>
    `;
    row.querySelector(".pm-save").onclick = async () => {
      const body = {};
      for (const inp of row.querySelectorAll("[data-f]")) {
        const f = inp.dataset.f;
        if (inp.type === "checkbox") body[f] = inp.checked ? 1 : 0;
        else if (f === "sort_order") body[f] = Number(inp.value) || 0;
        else body[f] = inp.value || null;
      }
      try {
        await api(`/artists/${a.id}`, { method: "PATCH", body });
        toast("Saved");
        loadArtists();
      } catch (err) { alert(err.message); }
    };
    row.querySelector(".pm-del").onclick = async () => {
      if (!confirm(`Hide “${a.name}”?`)) return;
      try {
        await api(`/artists/${a.id}`, { method: "DELETE" });
        loadArtists();
      } catch (err) { alert(err.message); }
    };
    wrap.appendChild(row);
  }
}

$("#ar-add")?.addEventListener("click", async () => {
  const g = id => document.getElementById(id)?.value.trim() || null;
  const body = {
    name: g("ar-new-name"),
    slug: g("ar-new-slug"),
    specialty: g("ar-new-specialty"),
    image_url: g("ar-new-image"),
    portfolio_url: g("ar-new-portfolio"),
    instagram: g("ar-new-instagram"),
  };
  if (!body.name) return alert("Name is required");
  try {
    await api("/artists", { method: "POST", body });
    for (const id of ["ar-new-name","ar-new-slug","ar-new-specialty","ar-new-image","ar-new-portfolio","ar-new-instagram"]) {
      const el2 = document.getElementById(id);
      if (el2) el2.value = "";
    }
    loadArtists();
    toast("Artist added");
  } catch (err) { alert(err.message); }
});

// ── Boot ────────────────────────────────────────────────────
(async () => {
  try {
    const r = await fetch("/api/admin/me", { credentials: "same-origin" });
    if (!r.ok) throw new Error();
    await showMain();
  } catch { showLogin(); }
})();
