(() => {
  // The admin API prefix uses the same secret slug the page is served from.
  const slug = location.pathname.split("/").filter(Boolean)[0] || "";
  const API = `/${slug}/api/admin`;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (v != null) n.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null) continue;
      n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return n;
  };

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const fmtDate = iso => !iso ? "—"
    : new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

  // ── API wrapper ──────────────────────────────────────────────
  let csrf = "";

  async function api(path, { method = "GET", body, raw = false } = {}) {
    const headers = {};
    if (body && !raw) headers["Content-Type"] = "application/json";
    if (method !== "GET") headers["x-csrf-token"] = csrf;

    const res = await fetch(API + path, {
      method,
      headers,
      credentials: "same-origin",
      body: raw ? body : body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401) { showLogin(); throw new Error("Not authenticated"); }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  // ── Login / logout ───────────────────────────────────────────
  const loginView = $("#login-view");
  const appView = $("#app-view");

  async function checkAuth() {
    try {
      const r = await fetch(`${API}/me`, { credentials: "same-origin" });
      const d = await r.json();
      if (d.authenticated) { csrf = d.csrf; showApp(); return true; }
    } catch {}
    showLogin();
    return false;
  }

  function showLogin() { loginView.hidden = false; appView.hidden = true; }
  function showApp()   {
    loginView.hidden = true; appView.hidden = false;
    loadStats(); loadRecent(); loadBookings(); loadArtists();
  }

  $("#login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const errorBox = $("#login-error");
    errorBox.hidden = true;

    const password = $("#login-password").value;
    try {
      const res = await fetch(`${API}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Invalid credentials");
      csrf = data.csrf;
      $("#login-password").value = "";
      showApp();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
    }
  });

  $("#logout").addEventListener("click", async () => {
    await api("/logout", { method: "POST" }).catch(() => {});
    location.reload();
  });

  // ── Tabs ─────────────────────────────────────────────────────
  $$(".tabs button").forEach(btn => {
    btn.addEventListener("click", () => {
      $$(".tabs button").forEach(b => b.classList.toggle("active", b === btn));
      const tab = btn.dataset.tab;
      $$("main > section").forEach(s => s.hidden = s.dataset.view !== tab);
    });
  });

  // ── Dashboard ────────────────────────────────────────────────
  async function loadStats() {
    const s = await api("/stats").catch(() => null);
    if (!s) return;
    $("#stats").innerHTML = `
      <div class="stat"><div class="n">${s.total}</div><div class="l">Total</div></div>
      <div class="stat"><div class="n">${s.pending}</div><div class="l">Pending review</div></div>
      <div class="stat"><div class="n">${s.approved}</div><div class="l">Approved</div></div>
      <div class="stat"><div class="n">${s.paid}</div><div class="l">Deposit paid</div></div>
      <div class="stat"><div class="n">${s.unpaid}</div><div class="l">Awaiting deposit</div></div>`;
  }

  async function loadRecent() {
    const rows = await api("/bookings").catch(() => []);
    const recent = rows.slice(0, 5);
    const box = $("#recent-bookings");
    if (!recent.length) { box.innerHTML = `<div class="empty">No bookings yet.</div>`; return; }
    box.innerHTML = "";
    for (const b of recent) box.append(bookingCard(b));
  }

  // ── Bookings list ────────────────────────────────────────────
  function bookingCard(b) {
    const card = el("div", { class: "booking-card", "data-id": b.id },
      el("div", { class: "ref" }, b.ref),
      el("div", { class: "who" },
        el("div", { class: "name" }, b.name),
        el("div", { class: "email" }, b.email)),
      el("span", { class: `badge ${b.status}` }, b.status),
      el("span", { class: `badge ${b.deposit_paid ? "paid" : "unpaid"}` },
        b.deposit_paid ? "Paid"
        : b.deposit_amount ? `$${b.deposit_amount} due` : "No deposit set"),
      el("div", { class: "sub" },
        b.appointment_at ? fmtDate(b.appointment_at)
        : `Created ${fmtDate(b.created_at)}`)
    );
    card.addEventListener("click", () => openBooking(b.id));
    return card;
  }

  async function loadBookings() {
    const q = $("#filter-q").value.trim();
    const status = $("#filter-status").value;
    const paid = $("#filter-paid").value;
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (paid) params.set("paid", paid);

    const rows = await api(`/bookings?${params}`).catch(() => []);
    const list = $("#bookings-list");

    if (!rows.length) { list.innerHTML = `<div class="empty">No bookings match.</div>`; return; }
    list.innerHTML = "";
    for (const b of rows) list.append(bookingCard(b));
  }

  $("#filter-apply").addEventListener("click", loadBookings);
  $("#filter-q").addEventListener("keydown", e => e.key === "Enter" && loadBookings());

  // ── Drawer ───────────────────────────────────────────────────
  const drawer = $("#drawer");
  $("#drawer-close").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { closeDrawer(); closeModal(); }
  });

  function closeDrawer() {
    drawer.hidden = true;
    $("#drawer-body").innerHTML = "";
  }

  async function openBooking(id) {
    const b = await api(`/bookings/${id}`).catch(() => null);
    if (!b) return;

    const artists = await api("/artists").catch(() => []);
    $("#drawer-title").textContent = `Booking · ${b.ref}`;

    const body = $("#drawer-body");
    body.innerHTML = "";

    // Reference block (click to copy)
    const refBlock = el("div", { class: "ref-block" }, b.ref,
      el("span", { style: "font-size:.6rem;letter-spacing:.14em;margin-left:10px;color:#888" },
        "CLICK TO COPY"));
    refBlock.style.cursor = "pointer";
    refBlock.addEventListener("click", () => {
      navigator.clipboard.writeText(b.ref);
      refBlock.style.background = "#e6f7e6";
      setTimeout(() => refBlock.style.background = "", 600);
    });
    body.append(refBlock);

    // Contact
    body.append(
      el("div", { class: "field" },
        el("label", {}, "Contact"),
        el("div", {},
          el("strong", {}, b.name), " — ",
          el("a", { href: `mailto:${b.email}` }, b.email), " — ",
          el("a", { href: `sms:${b.phone}` }, b.phone)))
    );

    // Piece
    body.append(
      el("div", { class: "row2" },
        el("div", { class: "field" }, el("label", {}, "Placement"), el("div", {}, b.placement || "—")),
        el("div", { class: "field" }, el("label", {}, "Size"),      el("div", {}, b.size || "—"))),
      el("div", { class: "row2" },
        el("div", { class: "field" }, el("label", {}, "Colour"),          el("div", {}, b.color_mode || "—")),
        el("div", { class: "field" }, el("label", {}, "Preferred dates"), el("div", {}, b.preferred_dates || "—")))
    );

    if (b.description) {
      body.append(
        el("div", { class: "field" },
          el("label", {}, "Description"),
          el("div", { style: "white-space:pre-wrap" }, b.description))
      );
    }

    if (b.reference_urls?.length) {
      const thumbs = el("div", { class: "thumb-row" });
      for (const u of b.reference_urls) {
        thumbs.append(el("a", { href: u, target: "_blank" },
          el("img", { src: u, alt: "reference" })));
      }
      body.append(el("div", { class: "field" },
        el("label", {}, "Reference images"), thumbs));
    }

    // Editable fields
    const statusSelect = el("select");
    for (const s of ["pending","approved","scheduled","completed","cancelled"]) {
      statusSelect.append(el("option", { value: s, selected: s === b.status ? "selected" : null }, s));
    }

    const artistSelect = el("select");
    artistSelect.append(el("option", { value: "" }, "— none —"));
    for (const a of artists) {
      artistSelect.append(el("option",
        { value: a.id, selected: a.id === b.artist_id ? "selected" : null }, a.name));
    }

    const amountInput = el("input", {
      type: "number", step: "0.01", min: "0",
      value: b.deposit_amount ?? "", placeholder: "0.00",
    });

    const methodSelect = el("select");
    methodSelect.append(el("option", { value: "" }, "— none —"));
    for (const m of ["paypal","cash","card","venmo"]) {
      methodSelect.append(el("option",
        { value: m, selected: m === b.deposit_method ? "selected" : null }, m));
    }

    const dtInput = el("input", {
      type: "datetime-local",
      value: b.appointment_at ? toLocalDT(b.appointment_at) : "",
    });

    const notesInput = el("textarea", { rows: "3" }, b.notes || "");

    body.append(
      el("div", { class: "row2" },
        el("div", { class: "field" }, el("label", {}, "Status"), statusSelect),
        el("div", { class: "field" }, el("label", {}, "Artist"), artistSelect)),
      el("div", { class: "row2" },
        el("div", { class: "field" }, el("label", {}, "Deposit amount"), amountInput),
        el("div", { class: "field" }, el("label", {}, "Deposit method"), methodSelect)),
      el("div", { class: "field" }, el("label", {}, "Appointment at"), dtInput),
      el("div", { class: "field" }, el("label", {}, "Internal notes"), notesInput)
    );

    // Actions
    const saveBtn = el("button", { class: "btn" }, "Save changes");
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
          },
        });
        saveBtn.textContent = "Saved ✓";
        setTimeout(() => { saveBtn.textContent = "Save changes"; saveBtn.disabled = false; }, 800);
        loadBookings(); loadRecent();
      } catch (err) {
        alert(err.message);
        saveBtn.disabled = false;
        saveBtn.textContent = "Save changes";
      }
    });

    const paidBtn = el("button",
      { class: b.deposit_paid ? "btn btn--ghost" : "btn" },
      b.deposit_paid ? "Mark as unpaid" : "Mark deposit paid");
    paidBtn.addEventListener("click", async () => {
      paidBtn.disabled = true;
      try {
        await api(`/bookings/${b.id}`, {
          method: "PATCH",
          body: { deposit_paid: b.deposit_paid ? 0 : 1 },
        });
        closeDrawer(); loadBookings(); loadRecent();
      } catch (err) {
        alert(err.message);
        paidBtn.disabled = false;
      }
    });

    const deleteBtn = el("button", { class: "btn btn--danger" }, "Delete");
    deleteBtn.addEventListener("click", async () => {
      if (!confirm(`Delete booking ${b.ref}? This cannot be undone.`)) return;
      await api(`/bookings/${b.id}`, { method: "DELETE" });
      closeDrawer(); loadBookings(); loadRecent();
    });

    body.append(el("div", { class: "actions" }, saveBtn, paidBtn, deleteBtn));
    drawer.hidden = false;
  }

  function toLocalDT(iso) {
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // ── Artists ──────────────────────────────────────────────────
  async function loadArtists() {
    const list = await api("/artists").catch(() => []);
    const box = $("#artists-list");
    box.innerHTML = "";

    if (!list.length) {
      box.innerHTML = `<div class="empty">No artists yet. Click "New artist".</div>`;
      return;
    }

    for (const a of list) {
      const card = el("div", { class: "artist-card" },
        el("img", { src: a.image_url || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3Crect width='1' height='1' fill='%23eee'/%3E%3C/svg%3E", alt: a.name }),
        el("div", { class: "body" },
          el("h4", {}, a.name),
          el("div", { class: "sub" }, a.specialty || ""),
          el("div", { class: "row-actions" },
            el("button", { class: "btn btn--ghost", onclick: () => openArtistModal(a) }, "Edit"),
            el("button", { class: "btn btn--danger", onclick: async () => {
              if (!confirm(`Remove ${a.name}?`)) return;
              await api(`/artists/${a.id}`, { method: "DELETE" });
              loadArtists();
            }}, "Delete"),
            el("button", { class: "btn btn--ghost", onclick: () => uploadArtistImage(a) }, "Photo"))));
      box.append(card);
    }
  }

  $("#new-artist-btn").addEventListener("click", () => openArtistModal(null));

  // Modal
  const modal = $("#modal");
  $("#modal-close").addEventListener("click", closeModal);
  modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });

  function closeModal() {
    modal.hidden = true;
    $("#modal-body").innerHTML = "";
  }

  function openArtistModal(a) {
    const isEdit = !!a;
    const form = el("form", {},
      el("h3", {}, isEdit ? `Edit ${a.name}` : "New artist"),
      el("div", { class: "field" }, el("label", {}, "Name"),
        el("input", { name: "name", required: true, value: a?.name || "" })),
      el("div", { class: "field" }, el("label", {}, "Specialty"),
        el("input", { name: "specialty", value: a?.specialty || "",
          placeholder: "e.g. Fine line, Japanese, Realism" })),
      el("div", { class: "field" }, el("label", {}, "Bio"),
        el("textarea", { name: "bio", rows: "3" }, a?.bio || "")),
      el("div", { class: "field" }, el("label", {}, "Portfolio URL"),
        el("input", { name: "portfolio_url", value: a?.portfolio_url || "", placeholder: "/miguel" })),
      el("div", { class: "row2" },
        el("div", { class: "field" }, el("label", {}, "Sort order"),
          el("input", { name: "sort_order", type: "number", value: a?.sort_order ?? 0 })),
        el("div", { class: "field" }, el("label", {}, "Active"),
          el("select", { name: "active" },
            el("option", { value: "1", selected: (a?.active ?? 1) === 1 ? "selected" : null }, "Yes"),
            el("option", { value: "0", selected: a?.active === 0 ? "selected" : null }, "No")))),
      el("button", { class: "btn", type: "submit" },
        isEdit ? "Save changes" : "Create artist"));

    form.addEventListener("submit", async e => {
      e.preventDefault();
      const fd = new FormData(form);
      const body = Object.fromEntries(fd.entries());
      try {
        if (isEdit) await api(`/artists/${a.id}`, { method: "PATCH", body });
        else        await api("/artists",         { method: "POST",  body });
        closeModal();
        loadArtists();
        loadRecent();
      } catch (err) { alert(err.message); }
    });

    $("#modal-body").innerHTML = "";
    $("#modal-body").append(form);
    modal.hidden = false;
  }

  async function uploadArtistImage(a) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      const fd = new FormData();
      fd.append("image", file);
      try {
        const res = await api(`/artists/${a.id}/image`, { method: "POST", body: fd, raw: true });
        if (!res?.url) throw new Error("Upload failed");
        loadArtists();
      } catch (err) { alert(err.message); }
    });
    input.click();
  }

  // Boot
  checkAuth();
})();
