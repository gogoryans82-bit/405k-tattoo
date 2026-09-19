(() => {
  const API = "/api";
  const $ = s => document.querySelector(s);

  $("#yr").textContent = new Date().getFullYear();

  // ── Load artists ─────────────────────────────────────────────
  async function loadArtists() {
    try {
      const res = await fetch(`${API}/artists`);
      const artists = await res.json();

      const select = $("#artist-select");
      for (const a of artists) {
        const opt = document.createElement("option");
        opt.value = a.id;
        opt.textContent = a.name + (a.specialty ? ` — ${a.specialty}` : "");
        select.appendChild(opt);
      }

      const grid = $("#gallery-grid");
      const withImages = artists.filter(a => a.image_url);

      if (!withImages.length) {
        grid.outerHTML = `<p class="gallery-empty">Artist lineup coming soon.</p>`;
        return;
      }

      grid.innerHTML = withImages.map(a => `
        <a class="gallery-item" href="${escapeAttr(a.portfolio_url || "#gallery")}">
          <img src="${escapeAttr(a.image_url)}" alt="${escapeAttr(a.name)}" loading="lazy">
          <p class="gallery-caption">${escapeHtml(a.name)}</p>
        </a>`).join("");
    } catch (err) {
      console.error("Failed to load artists:", err);
    }
  }

  // ── Reference uploads ────────────────────────────────────────
  const refInput = $("#ref-input");
  const refPreviews = $("#ref-previews");
  let uploadedUrls = [];

  refInput.addEventListener("change", async () => {
    const files = Array.from(refInput.files || []).slice(0, 5);
    if (!files.length) return;

    refPreviews.innerHTML = "<p style='font-size:.8rem;color:#666'>Uploading…</p>";
    const fd = new FormData();
    for (const f of files) fd.append("files", f);

    try {
      const res = await fetch(`${API}/uploads`, { method: "POST", body: fd });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      uploadedUrls = data.urls || [];
      refPreviews.innerHTML = uploadedUrls
        .map(u => `<img class="thumb" src="${escapeAttr(u)}" alt="">`)
        .join("");
    } catch (err) {
      console.error(err);
      refPreviews.innerHTML = "<p style='color:#c33;font-size:.8rem'>Upload failed. Try again.</p>";
      uploadedUrls = [];
    }
  });

  // ── Submit ───────────────────────────────────────────────────
  const form = $("#booking-form");
  const errorBox = $("#form-error");
  const submitBtn = $("#submit-btn");
  const successPanel = $("#success-panel");

  form.addEventListener("submit", async e => {
    e.preventDefault();
    errorBox.hidden = true;

    if (!form.checkValidity()) { form.reportValidity(); return; }

    const fd = new FormData(form);
    const payload = {
      name:        fd.get("name")?.trim(),
      email:       fd.get("email")?.trim(),
      phone:       fd.get("phone")?.trim(),
      artist_id:   fd.get("artist_id") || null,
      placement:   fd.get("placement")?.trim(),
      size:        fd.get("size")?.trim(),
      color_mode:  fd.get("color_mode") || "black",
      description: fd.get("description")?.trim() || "",
      preferred_dates: fd.get("preferred_dates")?.trim() || "",
      reference_urls:  uploadedUrls,
    };

    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";

    try {
      const res = await fetch(`${API}/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not submit booking");

      $("#ref-code").textContent = data.ref || "";
      form.hidden = true;
      successPanel.hidden = false;
      successPanel.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = "Send booking request";
    }
  });

  $("#book-another").addEventListener("click", () => {
    form.reset();
    refPreviews.innerHTML = "";
    uploadedUrls = [];
    form.hidden = false;
    successPanel.hidden = true;
    submitBtn.disabled = false;
    submitBtn.textContent = "Send booking request";
    window.scrollTo({ top: form.offsetTop - 100, behavior: "smooth" });
  });

  // ── Helpers ──────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  const escapeAttr = escapeHtml;

  loadArtists();
})();
