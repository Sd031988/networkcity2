/* Networkcity – Verwaltung
 * Speichert Änderungen direkt im GitHub-Repository (data/*.json und data/images/).
 * Anmeldung mit einem persönlichen GitHub-Token (fine-grained, nur dieses Repo,
 * Berechtigung "Contents: Read and write"). Ohne gültigen Token kann nichts
 * geändert werden.
 */
(function () {
  "use strict";
  const { esc, icon } = NC;

  const CFG = Object.assign({
    repo: "Sd031988/networkcity2",
    branch: "main",
    api: "https://api.github.com",
  }, window.NC_ADMIN_CONFIG || {});

  const CATEGORIES = ["Smartphone", "Tablet", "Zubehör", "Laptop/PC", "Sonstiges"];
  // Symbole, die in der lokal eingebundenen Symbolschrift enthalten sind
  const ICON_CHOICES = ("local_shipping package_2 package inventory_2 local_post_office markunread_mailbox move_to_inbox " +
    "currency_exchange public payments account_balance_wallet credit_card account_balance euro paid savings attach_money " +
    "point_of_sale local_atm qr_code qr_code_scanner receipt confirmation_number airplane_ticket flight train directions_bus " +
    "wifi print scanner content_copy photo_camera computer laptop desktop_windows monitor tablet_android smartphone phone_iphone " +
    "phone_android headphones headset_mic speaker watch keyboard mouse cable battery_charging_full power sim_card memory sd_card usb " +
    "router tv cast devices videogame_asset sports_esports build handyman construction support_agent translate language description " +
    "article badge id_card fax verified verified_user security shield lock key star favorite thumb_up bolt eco recycling coffee " +
    "local_cafe restaurant local_drink lightbulb celebration groups person storefront store shopping_bag shopping_cart shopping_basket " +
    "local_mall redeem card_giftcard loyalty percent sell local_offer location_on directions schedule calendar_month event handshake").split(" ");

  const root = document.getElementById("admin");
  const dialog = document.getElementById("edit-dialog");
  const toastEl = document.getElementById("toast");
  const logoutBtn = document.getElementById("logout");

  let token = "";
  let serverMode = false;   // true, wenn die Seite bei Cloudflare mit Server-Anmeldung läuft
  let serverConfigError = "";
  let settings = null;
  let products = [];
  let images = [];
  let currentTab = "promo";
  const localPreview = {}; // frisch hochgeladene Bilder (bis GitHub Pages neu veröffentlicht hat)

  /* ---------------- Hilfen ---------------- */

  let toastTimer = null;
  function toast(msg, isError) {
    toastEl.textContent = msg;
    toastEl.classList.toggle("error", !!isError);
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, isError ? 7000 : 4500);
  }
  const SAVED_MSG = "Gespeichert ✓ Auf der Website in ca. 1–2 Minuten sichtbar.";

  function imgSrc(name) { return name ? (localPreview[name] || NC.imageUrl(name)) : ""; }

  function utf8ToB64(str) {
    const bytes = new TextEncoder().encode(str);
    return bytesToB64(bytes);
  }
  function bytesToB64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64ToUtf8(b64) {
    const bin = atob(String(b64).replace(/\s/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  async function withBusy(el, fn) {
    if (el) el.classList.add("busy");
    try { return await fn(); }
    catch (e) { console.error(e); toast(e.message || String(e), true); }
    finally { if (el) el.classList.remove("busy"); }
  }

  /* ---------------- GitHub-API ---------------- */

  async function gh(method, path, body) {
    const headers = { Accept: "application/vnd.github+json" };
    if (!serverMode) headers.Authorization = "Bearer " + token;
    if (body) headers["Content-Type"] = "application/json";
    let res;
    try {
      res = await fetch((serverMode ? "api/gh" : CFG.api) + path, {
        method: method, headers: headers, body: body ? JSON.stringify(body) : undefined,
        cache: "no-store", credentials: serverMode ? "same-origin" : "omit",
      });
    } catch (e) {
      throw new Error("Keine Verbindung. Bitte Internetverbindung prüfen.");
    }
    if (serverMode && res.status === 401) {
      // Sitzung abgelaufen → zurück zur Anmeldung
      const err = new Error("Ihre Anmeldung ist abgelaufen. Bitte neu anmelden.");
      err.status = 401;
      setTimeout(function () { renderLogin(err.message); }, 0);
      throw err;
    }
    if (res.ok) return res.status === 204 ? null : res.json();
    let detail = "";
    try { detail = (await res.json()).message || ""; } catch (e) { /* leer */ }
    const err = new Error(explain(res.status, method, detail));
    err.status = res.status;
    throw err;
  }
  function explain(status, method, detail) {
    if (serverMode && (status === 500 || status === 502)) return detail || "Serverfehler.";
    if (serverMode && status === 403 && /Herkunft|nicht erlaubt/.test(detail)) return detail;
    if (serverMode && (status === 401 || status === 403 || status === 404)) return "GitHub hat den Zugriff abgelehnt (" + status + "). Bitte den GitHub-Token in den Cloudflare-Einstellungen prüfen (Contents: Read and write für " + CFG.repo + ").";
    if (status === 401) return "Der Token ist ungültig oder abgelaufen. Bitte neu anmelden.";
    if (status === 403 && method !== "GET") return "Keine Schreibrechte. Der Token braucht „Contents: Read and write“ für dieses Repository.";
    if (status === 403) return "Zugriff verweigert (" + detail + ").";
    if (status === 404) return "Nicht gefunden – hat der Token Zugriff auf das Repository " + CFG.repo + "?";
    if (status === 409) return "Gleichzeitige Änderung erkannt. Bitte noch einmal speichern.";
    if (status === 422) return "GitHub hat die Änderung abgelehnt: " + detail;
    return "GitHub-Fehler " + status + (detail ? ": " + detail : "");
  }

  function contentsPath(path) {
    return "/repos/" + CFG.repo + "/contents/" + path.split("/").map(encodeURIComponent).join("/");
  }

  async function readJson(path) {
    const f = await gh("GET", contentsPath(path) + "?ref=" + encodeURIComponent(CFG.branch));
    return { data: JSON.parse(b64ToUtf8(f.content)), sha: f.sha };
  }

  // Liest die aktuelle Datei, wendet die Änderung an und speichert (bei Konflikt 1x wiederholen)
  async function updateJson(path, mutate, message) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const cur = await readJson(path);
      const res = mutate(cur.data);
      const data = res === undefined ? cur.data : res;
      try {
        await gh("PUT", contentsPath(path), {
          message: message || "Aktualisiert: " + path.split("/").pop(),
          content: utf8ToB64(JSON.stringify(data, null, 2) + "\n"),
          sha: cur.sha,
          branch: CFG.branch,
        });
        return data;
      } catch (e) {
        if ((e.status === 409 || e.status === 422) && attempt === 0) continue;
        throw e;
      }
    }
  }
  async function saveSettings(mutate, msg) { settings = await updateJson("data/settings.json", mutate, msg); }
  async function saveProducts(mutate, msg) { products = await updateJson("data/products.json", mutate, msg); }

  // Bild verkleinern (max. 1600 px) und als neue Datei in data/images/ hochladen
  async function uploadImage(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Bitte ein JPG-, PNG- oder WEBP-Bild wählen.");
    const blob = await shrink(file, 1600);
    const ext = blob.type === "image/png" ? ".png" : blob.type === "image/webp" ? ".webp" : ".jpg";
    const name = NC.uid() + ext;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await gh("PUT", contentsPath("data/images/" + name), {
      message: "Bild hinzugefügt: " + name,
      content: bytesToB64(bytes),
      branch: CFG.branch,
    });
    localPreview[name] = URL.createObjectURL(blob);
    images.push(name);
    return name;
  }
  function shrink(file, maxW) {
    return new Promise(function (resolve) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        if (img.naturalWidth <= maxW && file.size < 350000) return resolve(file);
        const scale = Math.min(1, maxW / img.naturalWidth);
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * scale);
        c.height = Math.round(img.naturalHeight * scale);
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, c.width, c.height);
        // PNG nur behalten, wenn es wirklich durchsichtige Stellen hat (z. B. Logo) – sonst als kleineres JPG speichern
        let keepPng = false;
        if (file.type === "image/png") {
          try {
            const px = ctx.getImageData(0, 0, c.width, c.height).data;
            for (let i = 3; i < px.length; i += 4) { if (px[i] < 250) { keepPng = true; break; } }
          } catch (e) { keepPng = true; }
        }
        if (!keepPng) {
          const c2 = document.createElement("canvas"); c2.width = c.width; c2.height = c.height;
          const x2 = c2.getContext("2d"); x2.fillStyle = "#fff"; x2.fillRect(0, 0, c2.width, c2.height); x2.drawImage(c, 0, 0);
          return c2.toBlob(function (b) { resolve(b && b.size < file.size ? b : file); }, "image/jpeg", 0.82);
        }
        c.toBlob(function (b) { resolve(b && b.size < file.size ? b : file); }, "image/png");
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  async function loadImages() {
    try {
      const list = await gh("GET", contentsPath("data/images") + "?ref=" + encodeURIComponent(CFG.branch));
      images = list.filter(function (f) { return f.type === "file"; }).map(function (f) { return f.name; }).sort();
    } catch (e) { images = []; }
  }

  /* ---------------- Anmeldung ---------------- */

  function storedToken() {
    try { return sessionStorage.getItem("nc_token") || localStorage.getItem("nc_token") || ""; } catch (e) { return ""; }
  }
  function storeToken(t, remember) {
    try {
      sessionStorage.removeItem("nc_token"); localStorage.removeItem("nc_token");
      if (t) (remember ? localStorage : sessionStorage).setItem("nc_token", t);
    } catch (e) { /* Speicher evtl. gesperrt – Token gilt dann nur bis zum Neuladen */ }
  }

  function renderLogin(errorMsg) {
    logoutBtn.hidden = true;
    if (serverMode) return renderServerLogin(errorMsg);
    root.innerHTML = '<div class="card login form-stack">' +
      '<h1 class="section-title" style="margin:0">' + icon("admin_panel_settings") + "Verwaltung</h1>" +
      "<p style=\"margin:0\">Melden Sie sich mit Ihrem <strong>GitHub-Token</strong> an. Nur damit können Inhalte geändert werden.</p>" +
      '<form id="login-form" class="form-stack">' +
      '<label class="field">GitHub-Token<input type="password" id="tok" autocomplete="current-password" placeholder="github_pat_…" required></label>' +
      '<label class="check"><input type="checkbox" id="remember"> Auf diesem Gerät angemeldet bleiben</label>' +
      (errorMsg ? '<p class="err" style="margin:0">' + esc(errorMsg) + "</p>" : "") +
      '<button class="btn primary" type="submit">' + icon("key") + "Anmelden</button></form>" +
      '<details><summary style="cursor:pointer;font-weight:600">Wie bekomme ich einen Token?</summary><ol class="small" style="margin-top:8px">' +
      '<li>Auf GitHub anmelden und <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">neuen Fine-grained Token erstellen</a>.</li>' +
      "<li>Name z. B. „Networkcity Verwaltung“, Ablaufdatum wählen.</li>" +
      "<li>Repository access: <strong>Only select repositories</strong> → <strong>" + esc(CFG.repo.split("/")[1]) + "</strong>.</li>" +
      "<li>Permissions → Repository permissions → <strong>Contents: Read and write</strong>.</li>" +
      "<li>„Generate token“ klicken, Token kopieren und hier einfügen.</li></ol>" +
      '<p class="small muted" style="margin:8px 0 0">Den Token niemandem geben. Auf fremden Geräten „angemeldet bleiben“ nicht anhaken.</p></details></div>';

    document.getElementById("login-form").addEventListener("submit", function (e) {
      e.preventDefault();
      const t = document.getElementById("tok").value.trim();
      const remember = document.getElementById("remember").checked;
      login(t, remember, e.target);
    });
  }

  function renderServerLogin(errorMsg) {
    root.innerHTML = '<div class="card login form-stack">' +
      '<h1 class="section-title" style="margin:0">' + icon("admin_panel_settings") + "Verwaltung</h1>" +
      (serverConfigError ? '<p class="err" style="margin:0">' + esc(serverConfigError) + "</p>" : "") +
      '<form id="login-form" class="form-stack">' +
      '<label class="field">Benutzername<input type="text" id="usr" autocomplete="username" autocapitalize="none" required></label>' +
      '<label class="field">Passwort<input type="password" id="pwd" autocomplete="current-password" required></label>' +
      '<label class="check"><input type="checkbox" id="remember"> Auf diesem Gerät 30 Tage angemeldet bleiben</label>' +
      (errorMsg ? '<p class="err" style="margin:0">' + esc(errorMsg) + "</p>" : "") +
      '<button class="btn primary" type="submit">' + icon("key") + "Anmelden</button></form></div>";
    document.getElementById("login-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      const form = e.target;
      form.classList.add("busy");
      try {
        const res = await fetch("api/login", {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
          body: JSON.stringify({ user: val("usr").trim(), password: val("pwd"), remember: checked("remember") }),
        });
        const data = await res.json().catch(function () { return {}; });
        if (!res.ok) { renderServerLogin(data.error || "Anmeldung fehlgeschlagen."); return; }
        try { await loadAll(); } catch (loadErr) { renderServerLogin("Anmeldung erfolgreich, aber die Daten konnten nicht geladen werden: " + loadErr.message); }
        return;
      } catch (err) {
        renderServerLogin(err.message || "Keine Verbindung.");
      }
    });
  }

  async function loadAll() {
    const res = await Promise.all([readJson("data/settings.json"), readJson("data/products.json"), loadImages()]);
    settings = res[0].data;
    products = Array.isArray(res[1].data) ? res[1].data : [];
    logoutBtn.hidden = false;
    renderApp();
  }

  async function login(t, remember, formEl) {
    token = t;
    if (formEl) formEl.classList.add("busy");
    try {
      await gh("GET", "/repos/" + CFG.repo);
      const res = await Promise.all([readJson("data/settings.json"), readJson("data/products.json"), loadImages()]);
      settings = res[0].data;
      products = Array.isArray(res[1].data) ? res[1].data : [];
      storeToken(t, remember);
      logoutBtn.hidden = false;
      renderApp();
    } catch (e) {
      token = "";
      storeToken("");
      renderLogin(e.message);
    }
  }

  logoutBtn.addEventListener("click", function () {
    token = ""; settings = null; products = [];
    storeToken("");
    if (serverMode) fetch("api/logout", { method: "POST", credentials: "same-origin" }).catch(function () {});
    renderLogin();
  });

  /* ---------------- Grundgerüst ---------------- */

  const TABS = [
    ["promo", "campaign", "Werbung"],
    ["products", "inventory", "Produkte"],
    ["business", "store", "Stammdaten"],
    ["texts", "edit_note", "Texte"],
    ["services", "receipt_long", "Preise & Services"],
    ["payment", "payments", "Bezahlung"],
    ["design", "palette", "Design"],
    ["images", "image", "Logo & Bilder"],
    ["contract", "description", "Kaufvertrag"],
    ["receipt", "receipt", "Quittung"],
  ];

  function renderApp() {
    NC.applyTheme(settings.theme);
    root.innerHTML = '<p class="status-line">' + icon("cloud_done") + "Änderungen werden direkt in GitHub gespeichert und erscheinen nach ca. 1–2 Minuten auf der Website.</p>" +
      '<div class="tabs" role="tablist">' + TABS.map(function (t) {
        return '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === currentTab) + '">' + icon(t[1]) + t[2] + "</button>";
      }).join("") + '</div><div id="panel" class="panel" role="tabpanel"></div>';
    root.querySelector(".tabs").addEventListener("click", function (e) {
      const b = e.target.closest("[data-tab]");
      if (!b) return;
      currentTab = b.dataset.tab;
      root.querySelectorAll("[data-tab]").forEach(function (x) { x.setAttribute("aria-selected", String(x === b)); });
      renderPanel();
    });
    renderPanel();
  }

  function renderPanel() {
    const panel = document.getElementById("panel");
    if (currentTab !== "receipt") quittungDaten = null; // Quittung beim Verlassen löschen
    ({ promo: tabPromo, products: tabProducts, business: tabBusiness, texts: tabTexts, services: tabServices,
      payment: tabPayment, design: tabDesign, images: tabImages, contract: tabContract, receipt: tabReceipt })[currentTab](panel);
  }

  /* ---------------- Bausteine für Formulare ---------------- */

  function field(label, inputHtml, hint) {
    return '<label class="field">' + esc(label) + (hint ? '<span class="hint">' + esc(hint) + "</span>" : "") + inputHtml + "</label>";
  }
  function inp(id, value, type, attrs) {
    return '<input type="' + (type || "text") + '" id="' + id + '" value="' + esc(value == null ? "" : value) + '"' + (attrs || "") + ">";
  }
  function area(id, value, rows) {
    return '<textarea id="' + id + '" rows="' + (rows || 3) + '">' + esc(value || "") + "</textarea>";
  }
  function check(id, label, on) {
    return '<label class="check"><input type="checkbox" id="' + id + '"' + (on ? " checked" : "") + "> " + esc(label) + "</label>";
  }
  function val(id) { const el = document.getElementById(id); return el ? el.value : ""; }
  function checked(id) { const el = document.getElementById(id); return !!(el && el.checked); }
  function iconSelect(cls, current) {
    const list = ICON_CHOICES.indexOf(current) === -1 && current ? [current].concat(ICON_CHOICES) : ICON_CHOICES;
    return '<div style="display:flex;gap:8px;align-items:center"><span class="ms big" data-icon-preview>' + esc(current || "sell") + "</span>" +
      '<select class="' + cls + '">' + list.map(function (n) { return "<option" + (n === current ? " selected" : "") + ">" + esc(n) + "</option>"; }).join("") + "</select></div>";
  }
  function saveBtn(id, label) {
    return '<div class="btn-row"><button class="btn primary" type="button" id="' + id + '">' + icon("save") + esc(label || "Speichern") + "</button></div>";
  }
  function onClick(id, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", function () { withBusy(el.closest(".card") || el, fn); });
  }

  /* Liste mit bearbeitbaren Zeilen (Leistungen, Öffnungszeiten, Zahlungsarten …) */
  function rowsEditor(container, rows, fields, opts) {
    opts = opts || {};
    let data = rows.map(function (r) { return Object.assign({}, r); });

    function sync() {
      container.querySelectorAll(".row-item").forEach(function (item, i) {
        fields.forEach(function (f) {
          const el = item.querySelector('[data-k="' + f.key + '"]');
          if (!el) return;
          data[i][f.key] = f.type === "checkbox" ? el.checked : el.value.trim();
        });
      });
    }
    function draw() {
      container.innerHTML = '<div class="rows">' + (data.length ? data.map(function (r, i) {
        return '<div class="row-item"><div class="row-fields">' + fields.map(function (f) {
          const v = r[f.key];
          let input;
          if (f.type === "checkbox") return '<label class="check' + (f.wide ? " wide" : "") + '"><input type="checkbox" data-k="' + f.key + '"' + (v !== false ? " checked" : "") + "> " + esc(f.label) + "</label>";
          if (f.type === "readonly") input = '<input type="text" data-k="' + f.key + '" value="' + esc(v) + '" readonly>';
          else if (f.type === "textarea") input = '<textarea data-k="' + f.key + '" rows="2">' + esc(v) + "</textarea>";
          else if (f.type === "icon") input = iconSelect("", v).replace("<select", '<select data-k="' + f.key + '"');
          else input = '<input type="' + (f.type || "text") + '" data-k="' + f.key + '" value="' + esc(v == null ? "" : v) + '"' + (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : "") + ">";
          return '<label class="field' + (f.wide ? " wide" : "") + '">' + esc(f.label) + (f.hint ? '<span class="hint">' + esc(f.hint) + "</span>" : "") + input + "</label>";
        }).join("") + "</div>" + (opts.fixed ? "" : '<div class="row-actions">' +
          '<button class="btn small icon-only" type="button" data-act="up" data-i="' + i + '" aria-label="Nach oben"' + (i ? "" : " disabled") + ">" + icon("arrow_upward") + "</button>" +
          '<button class="btn small icon-only" type="button" data-act="down" data-i="' + i + '" aria-label="Nach unten"' + (i < data.length - 1 ? "" : " disabled") + ">" + icon("arrow_downward") + "</button>" +
          '<button class="btn small danger" type="button" data-act="del" data-i="' + i + '">' + icon("delete") + "Entfernen</button></div>") + "</div>";
      }).join("") : '<p class="muted small" style="margin:0">Noch keine Einträge.</p>') + "</div>" +
        (opts.fixed ? "" : '<div class="btn-row" style="margin-top:10px"><button class="btn small" type="button" data-act="add">' + icon("add") + esc(opts.addLabel || "Eintrag hinzufügen") + "</button></div>");
    }
    container.addEventListener("click", function (e) {
      const b = e.target.closest("[data-act]");
      if (!b || !container.contains(b)) return;
      sync();
      const i = Number(b.dataset.i);
      if (b.dataset.act === "add") data.push(opts.newRow ? opts.newRow() : {});
      if (b.dataset.act === "del") data.splice(i, 1);
      if (b.dataset.act === "up" && i > 0) data.splice(i - 1, 0, data.splice(i, 1)[0]);
      if (b.dataset.act === "down" && i < data.length - 1) data.splice(i + 1, 0, data.splice(i, 1)[0]);
      draw();
    });
    container.addEventListener("change", function (e) {
      if (e.target.tagName === "SELECT") {
        const prev = e.target.parentElement.querySelector("[data-icon-preview]");
        if (prev) prev.textContent = e.target.value;
      }
    });
    draw();
    return { get: function () { sync(); return data.map(function (r) { return Object.assign({}, r); }); } };
  }

  // Bildauswahl: vorhandenes Bild oder neues hochladen
  function imagePicker(prefix, current) {
    const opts = [""].concat(images);
    if (current && opts.indexOf(current) === -1) opts.push(current);
    return '<div class="form-stack">' +
      '<img class="img-preview" id="' + prefix + '-prev" src="' + esc(imgSrc(current)) + '" alt="Vorschau"' + (current ? "" : " hidden") + ">" +
      field("Vorhandenes Bild", '<select id="' + prefix + '-sel">' + opts.map(function (n) {
        return '<option value="' + esc(n) + '"' + (n === current ? " selected" : "") + ">" + (n ? esc(n) : "(kein Bild)") + "</option>";
      }).join("") + "</select>") +
      field("… oder neues Bild hochladen", '<input type="file" id="' + prefix + '-file" accept="image/jpeg,image/png,image/webp">', "JPG, PNG oder WEBP. Große Bilder werden automatisch verkleinert.") +
      "</div>";
  }
  function wireImagePicker(prefix) {
    const sel = document.getElementById(prefix + "-sel");
    const file = document.getElementById(prefix + "-file");
    const prev = document.getElementById(prefix + "-prev");
    sel.addEventListener("change", function () { prev.hidden = !sel.value; prev.src = imgSrc(sel.value); file.value = ""; });
    file.addEventListener("change", function () {
      if (!file.files[0]) return;
      prev.src = URL.createObjectURL(file.files[0]); prev.hidden = false;
    });
  }
  async function pickedImage(prefix) {
    const file = document.getElementById(prefix + "-file");
    if (file.files && file.files[0]) return uploadImage(file.files[0]);
    return document.getElementById(prefix + "-sel").value;
  }

  function openDialog(title, bodyHtml, onSave, saveLabel) {
    dialog.innerHTML = '<div class="dialog-head"><h3 id="edit-title">' + esc(title) + '</h3><button class="btn icon-only small" type="button" data-close aria-label="Schließen">' + icon("close") + "</button></div>" +
      '<div class="dialog-body">' + bodyHtml + '<div class="btn-row end"><button class="btn" type="button" data-close>Abbrechen</button>' +
      '<button class="btn primary" type="button" id="dlg-save">' + icon("save") + esc(saveLabel || "Speichern") + "</button></div></div>";
    document.getElementById("dlg-save").addEventListener("click", function () {
      withBusy(dialog.querySelector(".dialog-body"), async function () {
        const ok = await onSave();
        if (ok !== false) { dialog.close(); toast(SAVED_MSG); renderPanel(); }
      });
    });
    dialog.showModal();
  }
  dialog.addEventListener("click", function (e) {
    if (e.target === dialog || e.target.closest("[data-close]")) dialog.close();
  });
  dialog.addEventListener("cancel", function (e) { if (dialog.querySelector(".busy")) e.preventDefault(); });

  /* ---------------- Tab: Werbung ---------------- */

  function tabPromo(panel) {
    const cfg = settings.promo || {};
    const slides = cfg.slides || [];
    panel.innerHTML = '<div class="card form-stack"><h3>' + icon("campaign") + "Werbung & Angebote</h3>" +
      '<p class="muted small" style="margin:0">Die große Bildergalerie oben auf der Startseite. Die Bilder wechseln automatisch und können ein Label, eine Überschrift und eine Beschreibung haben.</p>' +
      '<div class="form-grid">' + check("pr-on", "Werbung anzeigen", !!cfg.enabled) + check("pr-auto", "Automatisch wechseln", cfg.autoplay !== false) +
      check("pr-feat", "Angebote (Produkte mit Häkchen „Angebot“) automatisch zeigen", cfg.include_featured !== false) +
      field("Wechsel alle (Sekunden)", inp("pr-int", cfg.interval || 5, "number", ' min="2" max="20"')) +
      field("Höhe (Pixel, Desktop)", inp("pr-h", cfg.height || 520, "number", ' min="240" max="760" step="20"')) + "</div>" +
      saveBtn("pr-save", "Einstellungen speichern") + "</div>" +
      '<div class="card form-stack"><h3>' + icon("photo_library") + "Bilder in der Werbung</h3>" +
      '<p class="muted small" style="margin:0">Reihenfolge = Ablauf der Werbung.</p><div class="rows">' +
      (slides.length ? slides.map(function (s, i) {
        return '<div class="list-item"><div class="thumb">' + (s.image ? '<img src="' + esc(imgSrc(s.image)) + '" alt="">' : icon("image")) + "</div>" +
          '<div class="meta"><strong>' + esc(s.title || "Bild " + (i + 1)) + "</strong><span class=\"small\">" +
          (s.enabled === false ? '<span class="tag off">ausgeblendet</span>' : "") + (s.badge ? '<span class="tag">' + esc(s.badge) + "</span>" : "") + "</span></div>" +
          '<div class="acts"><button class="btn small icon-only" type="button" data-up="' + i + '" aria-label="Nach oben"' + (i ? "" : " disabled") + ">" + icon("arrow_upward") + "</button>" +
          '<button class="btn small icon-only" type="button" data-down="' + i + '" aria-label="Nach unten"' + (i < slides.length - 1 ? "" : " disabled") + ">" + icon("arrow_downward") + "</button>" +
          '<button class="btn small icon-only" type="button" data-edit="' + i + '" aria-label="Bearbeiten">' + icon("edit") + "</button>" +
          '<button class="btn small icon-only danger" type="button" data-del="' + i + '" aria-label="Löschen">' + icon("delete") + "</button></div></div>";
      }).join("") : '<p class="muted">Noch keine Werbebilder vorhanden.</p>') + "</div>" +
      '<div class="btn-row"><button class="btn primary" type="button" id="pr-add">' + icon("add_photo_alternate") + "Neues Werbebild</button></div></div>";

    onClick("pr-save", async function () {
      await saveSettings(function (s) {
        s.promo = s.promo || {};
        s.promo.enabled = checked("pr-on");
        s.promo.autoplay = checked("pr-auto");
        s.promo.include_featured = checked("pr-feat");
        s.promo.interval = Math.min(20, Math.max(2, parseInt(val("pr-int"), 10) || 5));
        s.promo.height = Math.min(760, Math.max(240, parseInt(val("pr-h"), 10) || 520));
      }, "Werbung: Einstellungen");
      toast(SAVED_MSG);
    });
    document.getElementById("pr-add").addEventListener("click", function () { editSlide(-1); });
    panel.querySelector(".rows").addEventListener("click", function (e) {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.edit) return editSlide(Number(b.dataset.edit));
      const card = b.closest(".card");
      withBusy(card, async function () {
        if (b.dataset.del) {
          const i = Number(b.dataset.del);
          if (!confirm("Dieses Werbebild wirklich löschen?")) return;
          const id = slides[i].id;
          await saveSettings(function (s) { s.promo.slides = (s.promo.slides || []).filter(function (x) { return x.id !== id; }); }, "Werbung: Bild gelöscht");
        } else {
          const i = Number(b.dataset.up || b.dataset.down);
          const dir = b.dataset.up ? -1 : 1;
          const id = slides[i].id;
          await saveSettings(function (s) {
            const arr = s.promo.slides || [];
            const k = arr.findIndex(function (x) { return x.id === id; });
            if (k === -1 || k + dir < 0 || k + dir >= arr.length) return;
            arr.splice(k + dir, 0, arr.splice(k, 1)[0]);
          }, "Werbung: Reihenfolge");
        }
        toast(SAVED_MSG);
        renderPanel();
      });
    });
  }

  function editSlide(index) {
    const s = index >= 0 ? settings.promo.slides[index] : { enabled: true };
    openDialog(index >= 0 ? "Werbebild bearbeiten" : "Neues Werbebild",
      imagePicker("sl", s.image || "") +
      field("Label / Badge (z. B. Angebot)", inp("sl-badge", s.badge)) +
      field("Überschrift", inp("sl-title", s.title)) +
      field("Beschreibung", area("sl-text", s.text)) +
      field("Link (optional)", inp("sl-link", s.link, "url", ' placeholder="https://…"'), "z. B. ein WhatsApp-Link (https://wa.me/…)") +
      field("Link-Text (optional)", inp("sl-ltext", s.link_label)) +
      check("sl-on", "Dieses Bild anzeigen", s.enabled !== false),
      async function () {
        const image = await pickedImage("sl");
        if (!image) { toast("Bitte ein Bild auswählen oder hochladen.", true); return false; }
        const slide = {
          id: s.id || NC.uid(), image: image, badge: val("sl-badge").trim(), title: val("sl-title").trim(),
          text: val("sl-text").trim(), link: val("sl-link").trim(), link_label: val("sl-ltext").trim(), enabled: checked("sl-on"),
        };
        await saveSettings(function (st) {
          st.promo = st.promo || { enabled: true, autoplay: true, interval: 5, height: 520 };
          st.promo.slides = st.promo.slides || [];
          const k = st.promo.slides.findIndex(function (x) { return x.id === slide.id; });
          if (k === -1) st.promo.slides.push(slide); else st.promo.slides[k] = slide;
        }, "Werbung: " + (slide.title || "Bild"));
      });
    wireImagePicker("sl");
  }

  /* ---------------- Tab: Produkte ---------------- */

  function tabProducts(panel) {
    const q = (panel.dataset.q || "");
    panel.innerHTML = '<div class="card form-stack"><h3>' + icon("inventory") + "Produkte (" + products.length + ")</h3>" +
      '<p class="muted small" style="margin:0">Ist ein Produkt verkauft, „Verkauft“ anhaken – es bleibt noch ' + esc(settings.sold_remove_days != null ? settings.sold_remove_days : 7) +
      ' Tag(e) mit Hinweis sichtbar und verschwindet dann automatisch.</p>' +
      '<p class="muted small" style="margin:0">Produkte mit der Kategorie „Zubehör“ erscheinen auf der Website im Bereich <strong>Zubehör</strong>, alle anderen im <strong>Handy-Shop</strong>.</p>' +
      '<div class="btn-row"><button class="btn primary" type="button" id="pd-add">' + icon("smartphone") + 'Neues Handy / Gerät</button>' +
      '<button class="btn primary" type="button" id="pd-add-acc">' + icon("headphones") + 'Neues Zubehör</button></div>' +
      '<div class="btn-row"><select id="pd-kind" style="width:auto"><option value="">Alle Produkte</option><option value="geraet"' + (panel.dataset.kind === "geraet" ? " selected" : "") + '>Nur Handys & Geräte</option><option value="zubehoer"' + (panel.dataset.kind === "zubehoer" ? " selected" : "") + '>Nur Zubehör</option></select>' +
      '<input type="search" id="pd-q" placeholder="Produkt suchen …" value="' + esc(q) + '" style="flex:1 1 200px;width:auto"></div>' +
      '<div class="rows" id="pd-list"></div></div>';

    function drawList() {
      const qq = val("pd-q").trim().toLowerCase();
      panel.dataset.q = qq;
      const kind = val("pd-kind");
      panel.dataset.kind = kind;
      const list = products.map(function (p, i) { return [p, i]; }).filter(function (x) {
        const acc = /zubeh/i.test(String(x[0].category || ""));
        if (kind === "zubehoer" && !acc) return false;
        if (kind === "geraet" && acc) return false;
        return !qq || String(x[0].name).toLowerCase().indexOf(qq) !== -1;
      });
      document.getElementById("pd-list").innerHTML = list.length ? list.map(function (x) {
        const p = x[0];
        const tags = [];
        if (p.sold) tags.push('<span class="tag off">Verkauft</span>');
        if (p.available === false) tags.push('<span class="tag off">Ausgeblendet</span>');
        if (p.featured) tags.push('<span class="tag">Angebot</span>');
        if (p.online_sale) tags.push('<span class="tag">Online</span>');
        return '<div class="list-item"><div class="thumb">' + (p.image ? '<img src="' + esc(imgSrc(p.image)) + '" alt="" loading="lazy">' : icon(/zubeh/i.test(String(p.category || "")) ? "headphones" : "phone_iphone")) + "</div>" +
          '<div class="meta"><strong>' + esc(p.name) + '</strong><span class="small">' + esc(NC.fmtPrice(p.price) || "ohne Preis") + " · " + esc(p.condition || "") + " · " + esc(p.category || "") + "</span><div>" + tags.join("") + "</div></div>" +
          '<div class="acts"><button class="btn small icon-only" type="button" data-edit="' + esc(p.id) + '" aria-label="Bearbeiten">' + icon("edit") + "</button>" +
          '<button class="btn small icon-only danger" type="button" data-del="' + esc(p.id) + '" aria-label="Löschen">' + icon("delete") + "</button></div></div>";
      }).join("") : '<p class="muted">Keine Produkte gefunden.</p>';
    }
    drawList();
    document.getElementById("pd-q").addEventListener("input", drawList);
    document.getElementById("pd-kind").addEventListener("change", drawList);
    document.getElementById("pd-add").addEventListener("click", function () { editProduct(null, "Smartphone"); });
    document.getElementById("pd-add-acc").addEventListener("click", function () { editProduct(null, "Zubehör"); });
    document.getElementById("pd-list").addEventListener("click", function (e) {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.edit) return editProduct(b.dataset.edit);
      if (b.dataset.del) {
        const p = products.find(function (x) { return String(x.id) === b.dataset.del; });
        if (!p || !confirm("„" + p.name + "“ wirklich löschen?")) return;
        withBusy(b.closest(".card"), async function () {
          await saveProducts(function (list) { return list.filter(function (x) { return String(x.id) !== String(p.id); }); }, "Produkt gelöscht: " + p.name);
          toast(SAVED_MSG);
          renderPanel();
        });
      }
    });
  }

  function editProduct(id, presetCat) {
    const p = id ? products.find(function (x) { return String(x.id) === String(id); }) : null;
    const d = p || { condition: "Neu", category: presetCat || "Smartphone", available: true, online_sale: true };
    const cats = CATEGORIES.indexOf(d.category) === -1 && d.category ? CATEGORIES.concat([d.category]) : CATEGORIES;
    const methods = NC.enabledPaymentMethods(settings);
    const sel = d.payment_methods || [];
    openDialog(p ? "Produkt bearbeiten" : (d.category === "Zubehör" ? "Neues Zubehör" : "Neues Handy / Gerät"),
      field("Produktname", inp("p-name", d.name, "text", " required")) +
      '<div class="form-grid">' +
      field("Kategorie", '<select id="p-cat">' + cats.map(function (c) { return "<option" + (c === d.category ? " selected" : "") + ">" + esc(c) + "</option>"; }).join("") + "</select>") +
      field("Zustand", '<select id="p-cond">' + ["Neu", "Gebraucht"].map(function (c) { return "<option" + (c === d.condition ? " selected" : "") + ">" + c + "</option>"; }).join("") + "</select>") +
      field("Preis (€)", inp("p-price", d.price != null ? d.price : "", "number", ' min="0" step="0.01" inputmode="decimal"')) +
      field("Alter Preis (€)", inp("p-old", d.old_price || "", "number", ' min="0" step="0.01" inputmode="decimal"'), "Optional – zeigt Streichpreis und Rabatt") +
      "</div>" +
      field("Beschreibung", area("p-desc", d.description)) +
      '<div class="form-stack">' +
      check("p-feat", "Als Angebot auf der Startseite anzeigen", !!d.featured) +
      check("p-avail", "Auf der Website anzeigen (verfügbar)", d.available !== false) +
      check("p-online", "Direkt online verkaufbar (Button „Online kaufen / anfragen“ per WhatsApp)", !!d.online_sale) +
      check("p-sold", "Verkauft", !!d.sold) + "</div>" +
      (methods.length ? '<fieldset class="form-stack" style="border:1px solid var(--nc-border);border-radius:12px;padding:12px"><legend style="font-weight:600;padding:0 6px">Zahlungsarten (keine Auswahl = alle)</legend>' +
        methods.map(function (m) { return '<label class="check"><input type="checkbox" class="p-pay" value="' + esc(m.id) + '"' + (sel.indexOf(m.id) !== -1 ? " checked" : "") + "> " + esc(m.label) + "</label>"; }).join("") + "</fieldset>" : "") +
      '<div class="form-stack"><strong>Produktbild</strong>' + imagePicker("pi", d.image || "") + "</div>",
      async function () {
        const name = val("p-name").trim();
        if (!name) { toast("Bitte einen Produktnamen eingeben.", true); return false; }
        const image = await pickedImage("pi");
        const price = parseFloat(String(val("p-price")).replace(",", "."));
        const old = parseFloat(String(val("p-old")).replace(",", "."));
        const sold = checked("p-sold");
        const rec = {
          id: d.id || NC.uid(), name: name, category: val("p-cat"), condition: val("p-cond"),
          price: isFinite(price) ? Math.round(price * 100) / 100 : 0,
          old_price: isFinite(old) && old > 0 ? Math.round(old * 100) / 100 : null,
          description: val("p-desc").trim(), image: image, featured: checked("p-feat"),
          available: checked("p-avail"), online_sale: checked("p-online"), sold: sold,
          sold_at: sold ? (d.sold_at || NC.todayIso()) : "",
          payment_methods: Array.from(dialog.querySelectorAll(".p-pay:checked")).map(function (c) { return c.value; }),
        };
        await saveProducts(function (list) {
          const k = list.findIndex(function (x) { return String(x.id) === String(rec.id); });
          if (k === -1) list.push(rec); else list[k] = Object.assign({}, list[k], rec);
        }, (p ? "Produkt geändert: " : "Neues Produkt: ") + name);
      });
    wireImagePicker("pi");
  }

  /* ---------------- Tab: Stammdaten ---------------- */

  function tabBusiness(panel) {
    const b = settings.business || {};
    const l = settings.legal || {};
    panel.innerHTML = '<div class="card form-stack"><h3>' + icon("store") + "Stammdaten</h3><div class=\"form-grid\">" +
      field("Ladenname", inp("b-name", b.name)) + field("Kurzbeschreibung (Slogan)", inp("b-tag", b.tagline)) +
      field("Straße & Hausnummer", inp("b-street", b.street)) + field("PLZ & Ort", inp("b-zip", b.zip_city)) +
      field("Telefon", inp("b-phone", b.phone, "tel")) + field("WhatsApp", inp("b-wa", b.whatsapp, "tel"), "mit Ländercode, z. B. 491751234567") +
      field("E-Mail", inp("b-mail", b.email, "email")) +
      field("Verkaufte Produkte ausblenden nach (Tagen)", inp("b-sold", settings.sold_remove_days != null ? settings.sold_remove_days : 7, "number", ' min="0" max="365"'), "0 = sofort ausblenden") +
      "</div>" + field("Google-Maps-Embed-URL", inp("b-map", b.map_url, "url"), "Für die Karte auf der Kontaktseite (beginnt mit https://www.google.com/maps/embed?… oder https://maps.google.com/…)") +
      saveBtn("b-save", "Stammdaten speichern") + "</div>" +
      '<div class="card form-stack"><h3>' + icon("badge") + "Impressum-Angaben</h3>" +
      (String(l.owner_name || "").trim() ? "" : '<p class="err" style="margin:0">Bitte den vollständigen Namen des Inhabers eintragen – ohne ihn ist das Impressum unvollständig.</p>') +
      '<p class="muted small" style="margin:0">Adresse, Telefon und E-Mail kommen automatisch aus den Stammdaten. Leere Felder werden im Impressum nicht angezeigt.</p><div class="form-grid">' +
      field("Inhaber (Vor- und Nachname)", inp("l-owner", l.owner_name)) +
      field("Firmenname", inp("l-company", l.company_name, "text", ' placeholder="' + esc(b.name || "") + '"'), "Leer = Ladenname") +
      field("Rechtsform", inp("l-form", l.legal_form, "text", ' placeholder="z. B. Einzelunternehmen"')) +
      field("Umsatzsteuer-ID", inp("l-vat", l.vat_id, "text", ' placeholder="DE…"'), "Nur falls vorhanden") +
      field("Registergericht", inp("l-court", l.register_court), "Nur bei Handelsregistereintrag") +
      field("Registernummer", inp("l-regno", l.register_number), "z. B. HRA 12345") +
      field("Verantwortlich für den Inhalt", inp("l-resp", l.content_responsible), "Optional, Name") +
      "</div>" + saveBtn("l-save", "Impressum-Angaben speichern") + "</div>" +
      '<div class="card form-stack"><h3>' + icon("schedule") + "Öffnungszeiten</h3><p class=\"muted small\" style=\"margin:0\">„Öffnet“ leer lassen = an diesem Tag geschlossen.</p><div id=\"hours\"></div>" + saveBtn("h-save", "Öffnungszeiten speichern") + "</div>" +
      '<div class="card form-stack"><h3>' + icon("event") + "Sonderöffnungszeiten</h3><p class=\"muted small\" style=\"margin:0\">Einmalige Änderungen mit Datum, z. B. Feiertage. Erscheinen automatisch auf Start- und Kontaktseite. „Öffnet“ leer = geschlossen.</p><div id=\"special\"></div>" + saveBtn("sp-save", "Sonderöffnungszeiten speichern") + "</div>";

    const hours = rowsEditor(document.getElementById("hours"), settings.hours || [], [
      { key: "day", label: "Tag", type: "readonly" }, { key: "open", label: "Öffnet", type: "time" }, { key: "close", label: "Schließt", type: "time" },
    ], { fixed: true });
    const special = rowsEditor(document.getElementById("special"), settings.special_hours || [], [
      { key: "date", label: "Datum", type: "date" }, { key: "open", label: "Öffnet", type: "time" }, { key: "close", label: "Schließt", type: "time" },
      { key: "note", label: "Hinweis (optional)", wide: true },
    ], { addLabel: "Datum hinzufügen", newRow: function () { return { date: NC.todayIso(), open: "", close: "", note: "" }; } });

    onClick("b-save", async function () {
      const days = parseInt(val("b-sold"), 10);
      await saveSettings(function (s) {
        s.business = Object.assign(s.business || {}, {
          name: val("b-name").trim(), tagline: val("b-tag").trim(), street: val("b-street").trim(), zip_city: val("b-zip").trim(),
          phone: val("b-phone").trim(), whatsapp: val("b-wa").trim(), email: val("b-mail").trim(), map_url: val("b-map").trim(),
        });
        s.sold_remove_days = isNaN(days) ? 7 : Math.max(0, Math.min(365, days));
      }, "Stammdaten");
      toast(SAVED_MSG);
    });
    onClick("l-save", async function () {
      await saveSettings(function (s) {
        s.legal = {
          owner_name: val("l-owner").trim(), company_name: val("l-company").trim(), legal_form: val("l-form").trim(),
          vat_id: val("l-vat").trim(), register_court: val("l-court").trim(), register_number: val("l-regno").trim(),
          content_responsible: val("l-resp").trim(),
        };
      }, "Impressum-Angaben");
      toast(SAVED_MSG);
      renderPanel();
    });
    onClick("h-save", async function () {
      const rows = hours.get().map(function (r) { return { day: r.day, open: r.open, close: r.open ? r.close : "" }; });
      await saveSettings(function (s) { s.hours = rows; }, "Öffnungszeiten");
      toast(SAVED_MSG);
    });
    onClick("sp-save", async function () {
      const rows = special.get().filter(function (r) { return r.date; }).map(function (r) { return { date: r.date, open: r.open, close: r.open ? r.close : "", note: r.note }; });
      await saveSettings(function (s) { s.special_hours = rows; }, "Sonderöffnungszeiten");
      toast(SAVED_MSG);
      renderPanel();
    });
  }

  /* ---------------- Tab: Texte ---------------- */

  function tabTexts(panel) {
    const b = settings.business || {}, c = settings.internetcafe || {}, r = settings.repair || {};
    panel.innerHTML = '<div class="card form-stack"><h3>' + icon("home") + "Startseite</h3>" +
      field("Startseiten-Titel", inp("t-ht", b.hero_title)) + field("Startseiten-Untertitel", area("t-hs", b.hero_subtitle, 2)) +
      field("Über-uns-Text", area("t-about", b.about_text, 5)) + "</div>" +
      '<div class="card form-stack"><h3>' + icon("computer") + "Internetcafé</h3>" +
      field("Titel", inp("t-ct", c.title)) + field("Text", area("t-cx", c.text)) +
      field("Stichpunkte", area("t-cp", (c.bullet_points || []).join("\n"), 4), "Eine Zeile pro Punkt") + "</div>" +
      '<div class="card form-stack"><h3>' + icon("build") + "Reparatur</h3>" +
      field("Titel", inp("t-rt", r.title)) + field("Text", area("t-rx", r.text)) +
      field("Ablauf", area("t-rs", (r.steps || []).join("\n"), 4), "Eine Zeile pro Schritt") +
      saveBtn("t-save", "Alle Texte speichern") + "</div>";
    const lines = function (s) { return s.split("\n").map(function (x) { return x.trim(); }).filter(Boolean); };
    onClick("t-save", async function () {
      await saveSettings(function (s) {
        s.business = Object.assign(s.business || {}, { hero_title: val("t-ht").trim(), hero_subtitle: val("t-hs").trim(), about_text: val("t-about").trim() });
        s.internetcafe = Object.assign(s.internetcafe || {}, { title: val("t-ct").trim(), text: val("t-cx").trim(), bullet_points: lines(val("t-cp")) });
        s.repair = Object.assign(s.repair || {}, { title: val("t-rt").trim(), text: val("t-rx").trim(), steps: lines(val("t-rs")) });
      }, "Texte");
      toast(SAVED_MSG);
    });
  }

  /* ---------------- Tab: Preise & Services ---------------- */

  function tabServices(panel) {
    const svcFields = [{ key: "name", label: "Leistung" }, { key: "price", label: "Preis", placeholder: "z. B. ab 49 €" }, { key: "description", label: "Beschreibung", type: "textarea", wide: true }];
    panel.innerHTML = '<div class="card form-stack"><h3>' + icon("computer") + 'Internetcafé – Leistungen</h3><div id="sv-cafe"></div>' + saveBtn("sv-cafe-save") + "</div>" +
      '<div class="card form-stack"><h3>' + icon("build") + 'Reparatur – Leistungen</h3><div id="sv-rep"></div>' + saveBtn("sv-rep-save") + "</div>" +
      '<div class="card form-stack"><h3>' + icon("handshake") + 'Weitere Services (Partner)</h3><p class="muted small" style="margin:0">z. B. Hermes Paketshop, Western Union. Erscheinen als Karten auf der Startseite.</p><div id="sv-extra"></div>' + saveBtn("sv-extra-save") + "</div>";
    const cafe = rowsEditor(document.getElementById("sv-cafe"), (settings.internetcafe || {}).services || [], svcFields, { addLabel: "Leistung hinzufügen" });
    const rep = rowsEditor(document.getElementById("sv-rep"), (settings.repair || {}).services || [], svcFields, { addLabel: "Leistung hinzufügen" });
    const extra = rowsEditor(document.getElementById("sv-extra"), settings.extra_services || [], [
      { key: "icon", label: "Symbol", type: "icon" }, { key: "name", label: "Leistung" }, { key: "description", label: "Beschreibung", type: "textarea", wide: true },
    ], { addLabel: "Service hinzufügen", newRow: function () { return { icon: "sell", name: "", description: "" }; } });
    const clean = function (rows) { return rows.filter(function (r) { return r.name; }); };
    onClick("sv-cafe-save", async function () {
      const rows = clean(cafe.get());
      await saveSettings(function (s) { s.internetcafe = s.internetcafe || {}; s.internetcafe.services = rows; }, "Internetcafé-Leistungen");
      toast(SAVED_MSG);
    });
    onClick("sv-rep-save", async function () {
      const rows = clean(rep.get());
      await saveSettings(function (s) { s.repair = s.repair || {}; s.repair.services = rows; }, "Reparatur-Leistungen");
      toast(SAVED_MSG);
    });
    onClick("sv-extra-save", async function () {
      const rows = clean(extra.get());
      await saveSettings(function (s) { s.extra_services = rows; }, "Weitere Services");
      toast(SAVED_MSG);
    });
  }

  /* ---------------- Tab: Bezahlung ---------------- */

  function tabPayment(panel) {
    panel.innerHTML = '<div class="card form-stack"><h3>' + icon("payments") + "Zahlungsarten</h3>" +
      '<p class="muted small" style="margin:0">Diese Zahlungsarten können Kunden bei der Kaufanfrage auswählen. Unter „Info“ z. B. einen Hinweis zur Abholung oder Überweisung eintragen.</p>' +
      '<div id="pay"></div>' + saveBtn("pay-save", "Zahlungsarten speichern") + "</div>";
    const ed = rowsEditor(document.getElementById("pay"), settings.payment_methods || [], [
      { key: "label", label: "Bezeichnung" }, { key: "icon", label: "Symbol", type: "icon" },
      { key: "info", label: "Info für Kunden (optional)", type: "textarea", wide: true }, { key: "enabled", label: "Aktiv", type: "checkbox", wide: true },
    ], { addLabel: "Zahlungsart hinzufügen", newRow: function () { return { id: NC.uid(), label: "", icon: "payments", enabled: true, info: "" }; } });
    onClick("pay-save", async function () {
      const rows = ed.get().filter(function (r) { return r.label; }).map(function (r) {
        return { id: r.id || NC.uid(), label: r.label, icon: r.icon || "payments", enabled: r.enabled !== false, info: r.info || "" };
      });
      await saveSettings(function (s) { s.payment_methods = rows; }, "Zahlungsarten");
      toast(SAVED_MSG);
    });
  }

  /* ---------------- Tab: Design ---------------- */

  function tabDesign(panel) {
    const cur = settings.theme || NC.DEFAULT_THEME;
    panel.innerHTML = '<div class="card form-stack"><h3>' + icon("palette") + "Design & Farben</h3>" +
      '<p class="muted small" style="margin:0">Das Aussehen der Website für alle Besucher.</p><div class="theme-opts">' +
      Object.keys(NC.THEMES).map(function (k) {
        const t = NC.THEMES[k];
        return '<label class="theme-opt"><span class="check"><input type="radio" name="theme" value="' + k + '"' + (k === cur ? " checked" : "") + "> <strong>" + esc(t.label) + "</strong></span>" +
          '<span class="swatches">' + t.swatch.map(function (c) { return '<span style="background:' + c + '"></span>'; }).join("") + "</span></label>";
      }).join("") + "</div>" + saveBtn("d-save", "Design speichern") + "</div>";
    panel.querySelectorAll("input[name=theme]").forEach(function (r) { r.addEventListener("change", function () { NC.applyTheme(r.value); }); });
    onClick("d-save", async function () {
      const k = (panel.querySelector("input[name=theme]:checked") || {}).value || NC.DEFAULT_THEME;
      await saveSettings(function (s) { s.theme = k; }, "Design");
      toast(SAVED_MSG);
    });
  }

  /* ---------------- Tab: Logo & Bilder ---------------- */

  function tabImages(panel) {
    const b = settings.business || {};
    function single(key, title, hint, wide) {
      const cur = b[key];
      return '<div class="card form-stack"><h3>' + icon("image") + esc(title) + "</h3>" +
        (cur ? '<img class="img-preview' + (wide ? " wide" : "") + '" src="' + esc(imgSrc(cur)) + '" alt="Aktuelles Bild">' : '<p class="muted" style="margin:0">Kein Bild gesetzt.</p>') +
        field("Neues Bild hochladen", '<input type="file" id="up-' + key + '" accept="image/jpeg,image/png,image/webp">', hint) +
        '<div class="btn-row"><button class="btn primary" type="button" id="save-' + key + '">' + icon("upload") + "Bild speichern</button>" +
        (cur ? '<button class="btn danger" type="button" id="rm-' + key + '">' + icon("delete") + "Bild entfernen</button>" : "") + "</div></div>";
    }
    panel.innerHTML = single("logo", "Logo (oben links)", "Quadratisch oder breit, PNG empfohlen") +
      single("hero_image", "Titelbild (groß oben auf der Startseite)", "Ein breites Bild, z. B. vom Laden", true);

    ["logo", "hero_image"].forEach(function (key) {
      onClick("save-" + key, async function () {
        const f = document.getElementById("up-" + key).files[0];
        if (!f) { toast("Bitte zuerst ein Bild auswählen.", true); return; }
        const name = await uploadImage(f);
        await saveSettings(function (s) { s.business = s.business || {}; s.business[key] = name; }, key === "logo" ? "Logo geändert" : "Titelbild geändert");
        toast(SAVED_MSG); renderPanel();
      });
      onClick("rm-" + key, async function () {
        if (!confirm("Bild wirklich entfernen?")) return;
        await saveSettings(function (s) { s.business[key] = ""; }, key === "logo" ? "Logo entfernt" : "Titelbild entfernt");
        toast(SAVED_MSG); renderPanel();
      });
    });
  }


  /* ---------------- Tab: Kaufvertrag (Ankauf Gebrauchtgerät) ----------------
   * Nur zum Ausfüllen und Drucken. Es wird NICHTS gespeichert – die Daten
   * (Name, Ausweis-Nr. …) bleiben nur in diesem Browserfenster. */

  const ZAHL_1 = ["null", "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwölf",
    "dreizehn", "vierzehn", "fünfzehn", "sechzehn", "siebzehn", "achtzehn", "neunzehn"];
  const ZAHL_10 = ["", "", "zwanzig", "dreißig", "vierzig", "fünfzig", "sechzig", "siebzig", "achtzig", "neunzig"];
  function zahlUnter100(n, ende) {
    if (n < 20) return n === 1 ? (ende ? "eins" : "ein") : ZAHL_1[n];
    const e = n % 10, z = Math.floor(n / 10);
    return e ? (e === 1 ? "ein" : ZAHL_1[e]) + "und" + ZAHL_10[z] : ZAHL_10[z];
  }
  function zahlUnter1000(n, ende) {
    const h = Math.floor(n / 100), r = n % 100;
    return (h ? (h === 1 ? "ein" : ZAHL_1[h]) + "hundert" : "") + (r ? zahlUnter100(r, ende) : "");
  }
  function zahlInWorten(n) {
    if (n === 0) return "null";
    const t = Math.floor(n / 1000), r = n % 1000;
    return (t ? (t === 1 ? "ein" : zahlUnter1000(t, false)) + "tausend" : "") + (r ? zahlUnter1000(r, true) : "");
  }
  function betragInWorten(wert) {
    const v = Math.round(Number(wert) * 100);
    if (!isFinite(v) || v <= 0 || v >= 100000000) return "";
    const euro = Math.floor(v / 100), cent = v % 100;
    let t = "";
    if (euro) t = (euro === 1 ? "ein" : zahlInWorten(euro)) + " Euro";
    if (cent) t += (t ? " und " : "") + zahlInWorten(cent) + " Cent";
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  let vertragDaten = null; // nur im Arbeitsspeicher, wird nicht gespeichert

  function vertragVorlage() {
    const b = settings.business || {};
    const l = settings.legal || {};
    const ort = String(b.zip_city || "").replace(/^\d+\s*/, "").split("-")[0].trim();
    return {
      v_name: "", v_strasse: "", v_ort: "", v_land: "DE", v_tel: "", v_ausweis: "", v_ausgestellt: "",
      k_name: (l.company_name || b.name || "") + (l.owner_name ? ", Inh. " + l.owner_name : ""),
      k_strasse: b.street || "", k_ort: b.zip_city || "", k_land: "DE", k_tel: b.phone || "",
      g_hersteller: "", g_produkt: "", g_serie: "", g_farbe: "", g_alter: "",
      ovp: "", zustand: "", funktion: "", optik: "", zubehoer: "", besonderheiten: "",
      begutachtet: false, preis: "", worten: "", ort: ort, datum: NC.todayIso(),
      ausweis_vorne: "", ausweis_hinten: "", ausweis_ok: false,
    };
  }

  function tabContract(panel) {
    if (!vertragDaten) vertragDaten = vertragVorlage();
    const d = vertragDaten;
    function t(id, label, attrs) { return field(label, inp("kv-" + id, d[id], "text", attrs || "")); }
    function wahl(id, label, opts) {
      return '<fieldset class="kv-wahl"><legend>' + esc(label) + "</legend>" + opts.map(function (o) {
        return '<label class="check"><input type="radio" name="kv-' + id + '" value="' + esc(o[0]) + '"' + (d[id] === o[0] ? " checked" : "") + "> " + esc(o[1]) + "</label>";
      }).join("") + "</fieldset>";
    }
    function ausweisFeld(seite, label) {
      const url = d["ausweis_" + seite];
      return '<div class="kv-ausweis-feld"><strong>' + label + "</strong>" +
        (url ? '<img src="' + url + '" alt="Ausweis ' + label + '">' : '<div class="kv-ausweis-leer">' + icon("photo_camera") + "<span>Noch kein Bild</span></div>") +
        '<div class="btn-row">' +
        '<label class="btn small"><input type="file" accept="image/*" capture="environment" data-ausweis="' + seite + '" hidden>' + icon("photo_camera") + "Foto aufnehmen</label>" +
        '<label class="btn small"><input type="file" accept="image/*,application/pdf,.pdf" data-ausweis="' + seite + '" hidden>' + icon("upload") + "Datei / PDF wählen</label></div>" +
        (url ? '<button class="btn small danger" type="button" data-ausweis-weg="' + seite + '">' + icon("delete") + "Entfernen</button>" : "") + "</div>";
    }
    panel.innerHTML = '<div class="card form-stack"><h3>' + icon("description") + "Kaufvertrag (Ankauf)</h3>" +
      '<p class="muted small" style="margin:0">Formular ausfüllen und drucken. <strong>Es wird nichts gespeichert</strong> – Namen und Ausweisdaten bleiben nur in diesem Fenster und sind nach dem Neuladen weg. Leere Felder bleiben auf dem Ausdruck zum Ausfüllen per Hand frei.</p>' +
      '<div class="btn-row"><button class="btn primary" type="button" id="kv-print">' + icon("print") + 'Drucken</button>' +
      '<button class="btn" type="button" id="kv-reset">' + icon("refresh") + "Formular leeren</button></div></div>" +

      '<div class="card form-stack"><h3>' + icon("person") + 'Verkäufer/-in</h3><div class="form-grid">' +
      t("v_name", "Name") + t("v_strasse", "Straße") + t("v_ort", "PLZ Ort") + t("v_land", "Land") +
      t("v_tel", "Telefon", ' inputmode="tel"') + t("v_ausweis", "Ausweis-Nr.") + t("v_ausgestellt", "Ausgestellt von") + "</div></div>" +

      '<div class="card form-stack"><h3>' + icon("store") + 'Käufer/-in</h3><p class="muted small" style="margin:0">Aus den Stammdaten vorausgefüllt.</p><div class="form-grid">' +
      t("k_name", "Name") + t("k_strasse", "Straße") + t("k_ort", "PLZ Ort") + t("k_land", "Land") + t("k_tel", "Telefon") + "</div></div>" +

      '<div class="card form-stack"><h3>' + icon("smartphone") + 'Gerät</h3><div class="form-grid">' +
      t("g_hersteller", "Hersteller") + t("g_produkt", "Produkt / Modell") + t("g_serie", "Serien-Nr. / IMEI") + t("g_farbe", "Farbe") + t("g_alter", "Alter") + "</div>" +
      '<div class="kv-wahlen">' +
      wahl("ovp", "OVP", [["ja", "ja"], ["nein", "nein"]]) +
      wahl("zustand", "Zustand", [["neu", "neu"], ["gebraucht", "gebraucht"], ["defekt", "defekt"]]) +
      wahl("funktion", "Funktion", [["ok", "uneingeschränkt"], ["siehe", "siehe Besonderheiten"]]) +
      wahl("optik", "Optik", [["ok", "neuwertig"], ["siehe", "siehe Besonderheiten"]]) +
      wahl("zubehoer", "Zubehör", [["ok", "original und komplett"], ["siehe", "siehe Besonderheiten"]]) + "</div>" +
      field("Besonderheiten", area("kv-besonderheiten", d.besonderheiten, 3)) +
      check("kv-begutachtet", "Das Gerät wurde zuvor vom Käufer begutachtet", d.begutachtet) + "</div>" +

      '<div class="card form-stack"><h3>' + icon("badge") + "Ausweiskopie (Anlage)</h3>" +
      '<p class="muted small" style="margin:0">Foto oder Scan (auch als PDF) vom Ausweis des Verkäufers. Ein PDF mit 2 Seiten wird automatisch als Vorder- und Rückseite übernommen. Wird <strong>nicht gespeichert</strong> und nur als 2. Seite mit dem Vertrag gedruckt – deutlich als „KOPIE“ gekennzeichnet. Nur mit Zustimmung des Ausweisinhabers (§ 20 PAuswG).</p>' +
      '<div class="kv-ausweis">' + ausweisFeld("vorne", "Vorderseite") + ausweisFeld("hinten", "Rückseite") + "</div>" +
      check("kv-ausweis_ok", "Der Verkäufer ist mit der Kopie seines Ausweises einverstanden", d.ausweis_ok) + "</div>" +

      '<div class="card form-stack"><h3>' + icon("euro") + 'Kaufpreis</h3><div class="form-grid">' +
      field("Kaufpreis (EUR)", inp("kv-preis", d.preis, "number", ' min="0" step="0.01" inputmode="decimal"')) +
      field("in Worten", inp("kv-worten", d.worten), "Wird automatisch ausgefüllt, kann geändert werden") +
      t("ort", "Ort") + field("Datum", inp("kv-datum", d.datum, "date")) + "</div>" +
      '<div class="btn-row"><button class="btn primary" type="button" id="kv-print2">' + icon("print") + "Drucken</button></div></div>";

    function lesen() {
      panel.querySelectorAll("input[id^=kv-], textarea[id^=kv-]").forEach(function (el) {
        const k = el.id.slice(3);
        if (k in d) d[k] = el.type === "checkbox" ? el.checked : el.value;
      });
      ["ovp", "zustand", "funktion", "optik", "zubehoer"].forEach(function (k) {
        const r = panel.querySelector('input[name="kv-' + k + '"]:checked');
        d[k] = r ? r.value : "";
      });
    }
    panel.addEventListener("input", function (e) {
      if (e.target.id === "kv-preis") {
        const w = document.getElementById("kv-worten");
        if (!w.dataset.manuell) w.value = betragInWorten(String(e.target.value).replace(",", "."));
      }
      if (e.target.id === "kv-worten") e.target.dataset.manuell = e.target.value ? "1" : "";
      lesen();
    });
    panel.addEventListener("change", function (e) {
      const seite = e.target.dataset && e.target.dataset.ausweis;
      if (seite && e.target.files && e.target.files[0]) {
        lesen();
        const datei = e.target.files[0];
        const karte = e.target.closest(".card");
        withBusy(karte, async function () {
          // Dateiart am Inhalt erkennen (nicht nur an der Endung)
          const kopf = new Uint8Array(await datei.slice(0, 5).arrayBuffer());
          const istPdf = String.fromCharCode.apply(null, kopf) === "%PDF-";
          const bilder = istPdf ? await pdfZuBildern(datei, 2) : [await bildZuJpeg(datei)];
          if (!bilder.length) throw new Error("Das PDF konnte nicht gelesen werden.");
          setzeAusweis(seite, bilder[0]);
          // Zweite PDF-Seite automatisch als andere Seite, wenn diese noch leer ist
          const andere = seite === "vorne" ? "hinten" : "vorne";
          if (bilder[1]) {
            if (!d["ausweis_" + andere]) setzeAusweis(andere, bilder[1]);
          }
          renderPanel();
          if (bilder.length > 1) toast("PDF mit 2 Seiten: Seite 2 wurde als " + (andere === "hinten" ? "Rückseite" : "Vorderseite") + " übernommen.");
        });
        return;
      }
      lesen();
    });
    panel.addEventListener("click", function (e) {
      const btn = e.target.closest("[data-ausweis-weg]");
      if (!btn) return;
      lesen();
      d["ausweis_" + btn.dataset.ausweisWeg] = "";
      renderPanel();
    });
    ["kv-print", "kv-print2"].forEach(function (id) {
      document.getElementById(id).addEventListener("click", function () {
        lesen();
        if ((d.ausweis_vorne || d.ausweis_hinten) && !d.ausweis_ok) {
          toast("Bitte zuerst bestätigen, dass der Verkäufer mit der Ausweiskopie einverstanden ist – oder die Bilder entfernen.", true);
          return;
        }
        vertragDrucken(d);
      });
    });
    document.getElementById("kv-reset").addEventListener("click", function () {
      if (!confirm("Alle Eingaben im Kaufvertrag löschen?")) return;
      vertragDaten = vertragVorlage(); renderPanel();
    });
  }

  function setzeAusweis(seite, url) {
    const k = "ausweis_" + seite;
    vertragDaten[k] = url;
  }

  // Weißen Rand (z. B. leere Fläche auf einem A4-Scan) automatisch abschneiden,
  // damit der Ausweis groß gedruckt wird. Danach auf max. 1600 px verkleinern.
  function zuschneidenUndExport(quelle) {
    const w = quelle.width, h = quelle.height;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    try {
      const px = quelle.getContext("2d").getImageData(0, 0, w, h).data;
      const schritt = Math.max(1, Math.round(Math.max(w, h) / 1500));
      for (let y = 0; y < h; y += schritt) {
        for (let x = 0; x < w; x += schritt) {
          const i = (y * w + x) * 4;
          if (px[i] < 225 || px[i + 1] < 225 || px[i + 2] < 225) {
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
        }
      }
    } catch (e) { x1 = -1; }
    let sx = 0, sy = 0, sw = w, sh = h;
    if (x1 > x0 && y1 > y0) {
      const rand = Math.round(Math.max(w, h) * 0.012);
      sx = Math.max(0, x0 - rand); sy = Math.max(0, y0 - rand);
      sw = Math.min(w, x1 + rand) - sx; sh = Math.min(h, y1 + rand) - sy;
      // nur zuschneiden, wenn es sich lohnt (mehr als 10 % Fläche weg)
      if (sw * sh > w * h * 0.9) { sx = 0; sy = 0; sw = w; sh = h; }
    }
    const f = Math.min(1, 1600 / Math.max(sw, sh));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(sw * f)); c.height = Math.max(1, Math.round(sh * f));
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(quelle, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.9);
  }

  // Foto öffnen, prüfen und als JPEG (data-URL) bereitstellen.
  // Formate, die der Browser nicht anzeigen kann (z. B. HEIC vom iPhone), werden hier abgelehnt.
  function bildZuJpeg(datei) {
    return new Promise(function (ok, fehler) {
      const url = URL.createObjectURL(datei);
      const img = new Image();
      img.onload = function () {
        const f = Math.min(1, 3200 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.naturalWidth * f));
        c.height = Math.max(1, Math.round(img.naturalHeight * f));
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        ok(zuschneidenUndExport(c));
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        fehler(new Error("Diese Datei kann nicht als Bild geöffnet werden (z. B. HEIC vom iPhone). Bitte als JPG, PNG oder PDF wählen."));
      };
      img.src = url;
    });
  }

  // pdf.js wird nur bei Bedarf geladen (liegt lokal in assets/vendor/pdfjs)
  let pdfjsLaden = null;
  function ladePdfjs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!pdfjsLaden) {
      pdfjsLaden = new Promise(function (ok, fehler) {
        const sc = document.createElement("script");
        sc.src = "assets/vendor/pdfjs/pdf.min.js";
        sc.onload = function () {
          if (!window.pdfjsLib) return fehler(new Error("PDF-Leser nicht verfügbar."));
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = "assets/vendor/pdfjs/pdf.worker.min.js";
          ok(window.pdfjsLib);
        };
        sc.onerror = function () { pdfjsLaden = null; fehler(new Error("PDF-Leser konnte nicht geladen werden.")); };
        document.head.appendChild(sc);
      });
    }
    return pdfjsLaden;
  }

  async function pdfZuBildern(datei, maxSeiten) {
    const lib = await ladePdfjs();
    const daten = new Uint8Array(await datei.arrayBuffer());
    let doc;
    try {
      doc = await lib.getDocument({ data: daten, isEvalSupported: false, disableAutoFetch: true }).promise;
    } catch (e) {
      throw new Error(/password/i.test(String(e && e.name)) ? "Das PDF ist passwortgeschützt." : "Das PDF konnte nicht gelesen werden.");
    }
    const urls = [];
    const n = Math.min(doc.numPages, maxSeiten);
    for (let i = 1; i <= n; i++) {
      const seite = await doc.getPage(i);
      const basis = seite.getViewport({ scale: 1 });
      const viewport = seite.getViewport({ scale: Math.min(6, 4200 / Math.max(basis.width, basis.height)) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await seite.render({ canvasContext: ctx, viewport: viewport }).promise;
      urls.push(zuschneidenUndExport(canvas));
    }
    doc.destroy();
    return urls;
  }

  function vertragDrucken(d) {
    const box = function (on) { return '<span class="kv-box">' + (on ? "✕" : "") + "</span>"; };
    const z = function (label, wert) { return '<div class="kv-zeile"><span class="kv-lab">' + esc(label) + ':</span><span class="kv-val">' + esc(wert || "") + "</span></div>"; };
    const datum = d.datum ? d.datum.split("-").reverse().join(".") : "";
    const preis = Number(String(d.preis).replace(",", "."));
    const preisText = isFinite(preis) && preis > 0 ? preis.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
    const zeile2 = function (label, key, a, b) {
      return '<div class="kv-check"><span class="kv-lab">' + label + ":</span>" + box(d[key] === a[0]) + " " + a[1] + " &nbsp; " + box(d[key] === b[0]) + " " + b[1] + "</div>";
    };
    let sheet = document.getElementById("print-sheet");
    if (!sheet) { sheet = document.createElement("div"); sheet.id = "print-sheet"; document.body.appendChild(sheet); }
    sheet.innerHTML = '<div class="kv-seite">' +
      "<h1>Kaufvertrag für ein " + (d.zustand === "neu" ? "Gerät" : "Gebrauchtgerät") + "</h1>" +
      '<div class="kv-grid2"><section><h2>Verkäufer/-in</h2>' +
      z("Name", d.v_name) + z("Straße", d.v_strasse) + z("PLZ Ort", d.v_ort) + z("Land", d.v_land) + z("Telefon", d.v_tel) + z("Ausweis-Nr.", d.v_ausweis) + z("Ausgestellt von", d.v_ausgestellt) +
      "</section><section><h2>Käufer/-in</h2>" +
      z("Name", d.k_name) + z("Straße", d.k_strasse) + z("PLZ Ort", d.k_ort) + z("Land", d.k_land) + z("Telefon", d.k_tel) + "</section></div>" +
      '<div class="kv-grid2 kv-geraet"><section><h2>Gerät</h2>' +
      z("Hersteller", d.g_hersteller) + z("Produkt", d.g_produkt) + z("Serien-Nr./IMEI", d.g_serie) + z("Farbe", d.g_farbe) + z("Alter", d.g_alter) +
      zeile2("OVP", "ovp", ["ja", "ja"], ["nein", "nein"]) +
      '<div class="kv-check"><span class="kv-lab">Zustand:</span>' + box(d.zustand === "neu") + " neu &nbsp; " + box(d.zustand === "gebraucht") + " gebraucht &nbsp; " + box(d.zustand === "defekt") + " defekt</div>" +
      zeile2("Funktion", "funktion", ["ok", "uneingeschränkt"], ["siehe", "siehe Besonderheiten"]) +
      zeile2("Optik", "optik", ["ok", "neuwertig"], ["siehe", "siehe Besonderheiten"]) +
      zeile2("Zubehör", "zubehoer", ["ok", "original und komplett"], ["siehe", "siehe Besonderheiten"]) +
      '</section><section><h2>Besonderheiten</h2><div class="kv-frei">' + esc(d.besonderheiten || "").replace(/\n/g, "<br>") + "</div></section></div>" +
      '<p class="kv-text">Das beschriebene Gerät wird ' + ({ neu: "in neuem Zustand", gebraucht: "in gebrauchtem Zustand", defekt: "in defektem Zustand" }[d.zustand] || "im beschriebenen Zustand") + ' und unter <strong>Ausschluss der Sachmängelhaftung</strong> verkauft. ' +
      "Die Haftung auf Schadensersatz wegen Verletzung von Leben, Körper oder Gesundheit sowie bei grober Fahrlässigkeit oder Vorsatz bleibt unberührt.</p>" +
      '<p class="kv-text">Der Verkäufer versichert, dass das Gerät einschließlich Zubehör sein frei verfügbares Eigentum ist und keine Rechte Dritter daran bestehen.</p>' +
      '<div class="kv-check" style="margin:2mm 0">' + box(d.begutachtet) + " Das Gerät wurde zuvor vom Käufer begutachtet.</div>" +
      '<div class="kv-preis"><div class="kv-zeile"><span class="kv-lab">Kaufpreis:</span><span class="kv-val">' + esc(preisText) + " EUR</span></div>" +
      '<div class="kv-zeile"><span class="kv-lab">in Worten:</span><span class="kv-val">' + esc(d.worten || "") + "</span></div>" +
      '<p class="kv-text" style="margin:2mm 0 0">Der Betrag ist spätestens bei Übergabe des Gerätes fällig.</p></div>' +
      '<div class="kv-unterschriften"><div><span class="kv-linie">' + esc([d.ort, datum].filter(Boolean).join(", ")) + "</span>Ort, Datum</div>" +
      '<div><span class="kv-linie"></span>Unterschrift Verkäufer/-in</div><div><span class="kv-linie"></span>Unterschrift Käufer/-in</div></div></div>' +
      ((d.ausweis_vorne || d.ausweis_hinten) ? '<div class="kv-anlage"><h1>Anlage: Ausweiskopie</h1>' +
        '<p class="kv-text">Zum Kaufvertrag vom ' + esc(datum) + (d.v_name ? " – Verkäufer/-in: " + esc(d.v_name) : "") + "</p>" +
        ["vorne", "hinten"].filter(function (k) { return d["ausweis_" + k]; }).map(function (k) {
          return '<div class="kv-kopie"><img src="' + d["ausweis_" + k] + '" alt=""><span class="kv-stempel">KOPIE</span></div>';
        }).join("") +
        '<p class="kv-text">' + box(d.ausweis_ok) + " Der Ausweisinhaber ist mit der Anfertigung dieser Kopie einverstanden. Die Kopie dient nur der Dokumentation dieses Ankaufs und wird nicht an Dritte weitergegeben.</p>" +
        '<div class="kv-unterschriften" style="grid-template-columns:1fr 1fr"><div><span class="kv-linie"></span>Unterschrift Ausweisinhaber/-in</div><div></div></div></div>' : "");
    const bilder = Array.prototype.slice.call(sheet.querySelectorAll("img"));
    Promise.all(bilder.map(function (img) { return img.decode ? img.decode().catch(function () {}) : null; }))
      .then(function () {
        if (bilder.some(function (img) { return !img.naturalWidth; })) {
          toast("Die Ausweiskopie konnte nicht geladen werden. Bitte das Bild/PDF noch einmal auswählen.", true);
          return;
        }
        window.print();
      });
  }


  /* ---------------- Tab: Quittung (Verkauf) ---------------- */
  // Nichts wird gespeichert – weder in GitHub noch im Browser. Beim Verlassen des Bereichs
  // oder beim Neuladen der Seite ist die Quittung weg.

  const GARANTIE = { Neu: "24 Monate Software-Garantie", Gebraucht: "3 Monate Software-Garantie" };
  let quittungDaten = null;

  // Früher im Browser gemerkte Nummer entfernen (wird nicht mehr gespeichert)
  try { localStorage.removeItem("nc_quittung_letzte"); } catch (e) { /* egal */ }

  // Vorschlag aus Datum und Uhrzeit (z. B. 20261015-1142) – ohne etwas zu speichern
  function naechsteQuittungsNr() {
    const n = new Date();
    return NC.todayIso().replace(/-/g, "") + "-" + String(n.getHours()).padStart(2, "0") + String(n.getMinutes()).padStart(2, "0");
  }

  function quittungVorlage() {
    return { nr: naechsteQuittungsNr(), datum: NC.todayIso(), modell: "", imei: "", imei2: "", zustand: "Gebraucht",
      garantie: GARANTIE.Gebraucht, steuer: "25a", preis: "", kunde: "", bemerkung: "" };
  }

  // IMEI prüfen (15 Ziffern, Prüfziffer nach Luhn)
  function imeiHinweis(v) {
    const d = String(v || "").replace(/\s/g, "");
    if (!d) return "";
    if (!/^\d+$/.test(d)) return "Die IMEI besteht nur aus Ziffern.";
    if (d.length !== 15) return "Eine IMEI hat 15 Ziffern – hier sind es " + d.length + ".";
    let sum = 0;
    for (let i = 0; i < 15; i++) { let x = Number(d[i]); if (i % 2 === 1) { x *= 2; if (x > 9) x -= 9; } sum += x; }
    return sum % 10 === 0 ? "" : "Die Prüfziffer passt nicht – bitte die IMEI noch einmal vergleichen.";
  }

  function tabReceipt(panel) {
    if (!quittungDaten) quittungDaten = quittungVorlage();
    const d = quittungDaten;
    const radio = function (name, opts) {
      return opts.map(function (o) {
        return '<label class="check"><input type="radio" name="q-' + name + '" value="' + esc(o[0]) + '"' + (d[name] === o[0] ? " checked" : "") + "> " + esc(o[1]) + "</label>";
      }).join("");
    };
    panel.innerHTML =
      '<div class="card form-stack"><h3>' + icon("receipt") + "Quittung (Verkauf)</h3>" +
      '<p class="muted small" style="margin:0">Für verkaufte Handys: ausfüllen und auf A4 drucken – mit Logo, Adresse und dem Logo groß und ganz hell im Hintergrund. <strong>Es wird nichts gespeichert</strong> – sobald du diesen Bereich verlässt oder die Seite neu lädst, ist die Quittung gelöscht.</p></div>' +

      '<div class="card form-stack"><h3>' + icon("smartphone") + 'Gerät</h3><div class="form-grid">' +
      field("Modell / Name", inp("q-modell", d.modell, "text", ' placeholder="z. B. Samsung A26 5G" autocomplete="off"')) +
      field("IMEI", inp("q-imei", d.imei, "text", ' inputmode="numeric" autocomplete="off" placeholder="15 Ziffern"'), "Steht unter *#06# oder auf der Verpackung") +
      field("IMEI 2 (optional)", inp("q-imei2", d.imei2, "text", ' inputmode="numeric" autocomplete="off"'), "Nur bei Dual-SIM-Geräten") +
      "</div>" + '<p class="err" id="q-imei-hint" style="margin:0"></p>' +
      '<fieldset class="kv-wahl"><legend>Zustand</legend>' + radio("zustand", [["Neu", "Neu"], ["Gebraucht", "Gebraucht"]]) + "</fieldset>" +
      field("Garantie", inp("q-garantie", d.garantie), "Neu = 24 Monate, Gebraucht = 3 Monate – wird beim Wechsel automatisch eingesetzt und kann geändert werden") +
      "</div>" +

      '<div class="card form-stack"><h3>' + icon("euro") + 'Betrag</h3><div class="form-grid">' +
      field("Gesamtbetrag (EUR)", inp("q-preis", d.preis, "number", ' min="0" step="0.01" inputmode="decimal"')) +
      "</div>" +
      '<fieldset class="kv-wahl"><legend>Steuer-Hinweis auf der Quittung</legend>' +
      radio("steuer", [["25a", "Differenzbesteuerung gem. § 25a UStG (Gebrauchtware)"], ["19", "Im Betrag sind 19 % MwSt. enthalten"], ["", "Kein Steuer-Hinweis"]]) + "</fieldset>" +
      '<p class="muted small" style="margin:0">§ 25a gilt nur für Ware, die ohne Mehrwertsteuer eingekauft wurde (z. B. Ankauf von Privatpersonen). Im Zweifel bitte den Steuerberater fragen.</p></div>' +

      '<div class="card form-stack"><h3>' + icon("description") + 'Quittung</h3><div class="form-grid">' +
      field("Quittungs-Nr.", inp("q-nr", d.nr), "Vorschlag aus Datum und Uhrzeit, kann geändert werden") +
      field("Datum", inp("q-datum", d.datum, "date")) +
      field("Käufer/-in (optional)", inp("q-kunde", d.kunde, "text", ' autocomplete="off"'), "Wird nicht gespeichert") + "</div>" +
      field("Bemerkung (optional)", area("q-bemerkung", d.bemerkung, 2)) +
      '<div class="btn-row"><button class="btn primary" type="button" id="q-print">' + icon("print") + 'Quittung drucken</button>' +
      '<button class="btn" type="button" id="q-reset">' + icon("refresh") + "Neue Quittung</button></div></div>";

    function lesen() {
      ["nr", "datum", "modell", "imei", "imei2", "garantie", "preis", "kunde", "bemerkung"].forEach(function (k) { d[k] = val("q-" + k); });
      ["zustand", "steuer"].forEach(function (k) { const r = panel.querySelector('input[name="q-' + k + '"]:checked'); d[k] = r ? r.value : ""; });
    }
    function zeigeImei() {
      const h = [imeiHinweis(val("q-imei")), imeiHinweis(val("q-imei2"))].filter(Boolean);
      document.getElementById("q-imei-hint").textContent = h.length ? h[0] : "";
    }
    panel.addEventListener("input", function () { lesen(); zeigeImei(); });
    panel.addEventListener("change", function (e) {
      if (e.target.name === "q-zustand") {
        const g = document.getElementById("q-garantie");
        // Garantie nur ersetzen, wenn sie noch einem Standardtext entspricht
        if (!g.value || Object.values(GARANTIE).indexOf(g.value) !== -1) g.value = GARANTIE[e.target.value];
        // Steuer-Hinweis passend vorschlagen – aber nur, solange er nicht selbst gewählt wurde
        if (!d.steuerManuell) {
          const st = panel.querySelector('input[name="q-steuer"][value="' + (e.target.value === "Neu" ? "19" : "25a") + '"]');
          if (st) st.checked = true;
        }
      }
      if (e.target.name === "q-steuer") d.steuerManuell = true;
      lesen(); zeigeImei();
    });
    zeigeImei();
    document.getElementById("q-print").addEventListener("click", function () {
      lesen();
      if (!d.modell.trim()) { toast("Bitte Modell / Name eintragen.", true); return; }
      if (!(Number(String(d.preis).replace(",", ".")) > 0)) { toast("Bitte den Gesamtbetrag eintragen.", true); return; }
      if (imeiHinweis(d.imei) && !confirm(imeiHinweis(d.imei) + "\n\nTrotzdem drucken?")) return;
      quittungDrucken(d);
    });
    document.getElementById("q-reset").addEventListener("click", function () {
      quittungDaten = quittungVorlage(); renderPanel();
    });
  }


  // Hintergrund der Quittung als Vektorgrafik (druckt scharf, braucht kaum Tinte):
  // Netz-Globus wie im Logo, orange Lichtbogen, Sicherheits-Wellenband mit Mikroschrift
  function quittungHintergrund() {
    const O = "#E8620C", G = "#8A9099";
    const cx = 105, cy = 166, r = 74;
    let g = "";
    // Globus: Längen- und Breitengrade
    g += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + G + '" stroke-width=".4" stroke-opacity=".26"/>';
    [20, 40, 60, 75].forEach(function (a) {
      const rx = r * Math.cos(a * Math.PI / 180);
      g += '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx.toFixed(2) + '" ry="' + r + '" fill="none" stroke="' + G + '" stroke-width=".28" stroke-opacity=".18"/>';
    });
    [-60, -40, -20, 0, 20, 40, 60].forEach(function (a) {
      const y = cy + r * Math.sin(a * Math.PI / 180), rx = r * Math.cos(a * Math.PI / 180);
      g += '<ellipse cx="' + cx + '" cy="' + y.toFixed(2) + '" rx="' + rx.toFixed(2) + '" ry="' + (rx * 0.16).toFixed(2) + '" fill="none" stroke="' + G + '" stroke-width=".28" stroke-opacity=".18"/>';
    });
    // Netzwerk: Knoten und Verbindungen auf dem Globus
    const pts = [[-40, -38], [-8, -52], [30, -30], [52, 4], [18, 20], [-26, 6], [-50, 34], [6, 52], [40, 44], [-4, -12]];
    const links = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [5, 6], [6, 7], [7, 8], [8, 3], [9, 1], [9, 4], [9, 5], [2, 9], [4, 7]];
    links.forEach(function (l) {
      const a = pts[l[0]], b = pts[l[1]];
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2 - 6;
      g += '<path d="M' + (cx + a[0]) + " " + (cy + a[1]) + " Q" + (cx + mx) + " " + (cy + my) + " " + (cx + b[0]) + " " + (cy + b[1]) +
        '" fill="none" stroke="' + O + '" stroke-width=".35" stroke-opacity=".26"/>';
    });
    pts.forEach(function (q) {
      g += '<circle cx="' + (cx + q[0]) + '" cy="' + (cy + q[1]) + '" r="2.2" fill="' + O + '" fill-opacity=".07"/>' +
        '<circle cx="' + (cx + q[0]) + '" cy="' + (cy + q[1]) + '" r=".9" fill="' + O + '" fill-opacity=".32"/>';
    });
    // Orangener Lichtbogen mit Pfeilspitze um den Globus (wie im Logo)
    g += '<path d="M' + (cx - 98) + " " + (cy + 30) + " C" + (cx - 110) + " " + (cy - 70) + " " + (cx + 40) + " " + (cy - 118) + " " + (cx + 96) + " " + (cy - 46) +
      " L" + (cx + 104) + " " + (cy - 54) + " L" + (cx + 103) + " " + (cy - 30) + " L" + (cx + 82) + " " + (cy - 38) + " L" + (cx + 89) + " " + (cy - 41) +
      " C" + (cx + 38) + " " + (cy - 104) + " " + (cx - 96) + " " + (cy - 62) + " " + (cx - 88) + " " + (cy + 30) +
      ' Z" fill="url(#qbogen)"/>';
    g += '<path d="M' + (cx - 92) + " " + (cy + 56) + " C" + (cx - 40) + " " + (cy + 112) + " " + (cx + 70) + " " + (cy + 100) + " " + (cx + 102) + " " + (cy + 28) +
      '" fill="none" stroke="' + O + '" stroke-width="1.6" stroke-opacity=".09" stroke-linecap="round"/>';
    // Name „NetworkCity“ groß und ganz hell über dem Globus (Schrift wie im Logo: kräftig, schräg)
    g += '<g transform="translate(' + cx + " " + (cy + 14) + ') skewX(-12)">' +
      '<text x="0" y="0" text-anchor="middle" font-family="Arial Black, Arial, Helvetica, sans-serif" font-weight="900" font-size="34" textLength="176" lengthAdjust="spacingAndGlyphs">' +
      '<tspan fill="#2A2C33" fill-opacity=".07">Network</tspan><tspan fill="' + O + '" fill-opacity=".11">City</tspan></text>' +
      '<text x="0" y="13" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="7.5" letter-spacing="6" fill="' + O + '" fill-opacity=".12">VOR-ORT</text></g>';
    // Sicherheits-Wellenband (Guilloche) über der Fußzeile
    const y0 = 285;
    for (let k = 0; k < 6; k++) {
      let d = "M0 " + y0;
      for (let x = 0; x <= 210; x += 1) {
        const y = y0 + Math.sin((x / 9) + k * 0.9) * 1.6 + Math.sin((x / 23) + k * 1.7) * 1.0;
        d += " L" + x + " " + y.toFixed(2);
      }
      g += '<path d="' + d + '" fill="none" stroke="' + (k % 2 ? G : O) + '" stroke-width=".16" stroke-opacity="' + (k % 2 ? ".28" : ".4") + '"/>';
    }
    // Mikroschrift unter dem Wellenband
    const micro = new Array(14).join("NETWORKCITY 2 · ");
    g += '<text x="0" y="290" font-family="Arial, sans-serif" font-size="1.6" letter-spacing=".25" fill="' + G + '" fill-opacity=".55">' + micro + "</text>";
    // Feine orange Ecklinie oben links
    g += '<path d="M0 34 Q0 0 34 0" fill="none" stroke="' + O + '" stroke-width=".6" stroke-opacity=".35"/>';
    return '<svg class="q-bg" viewBox="0 0 210 296" preserveAspectRatio="none" aria-hidden="true">' +
      '<defs><linearGradient id="qbogen" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="' + O + '" stop-opacity=".02"/>' +
      '<stop offset=".55" stop-color="' + O + '" stop-opacity=".08"/><stop offset="1" stop-color="#FF9A4D" stop-opacity=".13"/></linearGradient></defs>' + g + "</svg>";
  }

  function quittungDrucken(d) {
    const b = settings.business || {};
    const l = settings.legal || {};
    const fmt = function (n) { return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    const preis = Number(String(d.preis).replace(",", "."));
    const datum = d.datum ? d.datum.split("-").reverse().join(".") : "";
    const mwst = d.steuer === "19" ? preis - preis / 1.19 : 0;
    const kontakt = [
      "<strong>" + esc(l.company_name || b.name || "Networkcity") + "</strong>",
      l.owner_name ? "Inhaber: " + esc(l.owner_name) : "",
      esc(b.street), esc(b.zip_city),
      b.phone ? "Tel.: " + esc(b.phone) : "",
      b.email ? esc(b.email) : "",
      "sd031988.github.io/networkcity2",
    ].filter(Boolean).join("<br>");
    let sheet = document.getElementById("print-sheet");
    if (!sheet) { sheet = document.createElement("div"); sheet.id = "print-sheet"; document.body.appendChild(sheet); }
    sheet.innerHTML = '<div class="q-seite">' +
      quittungHintergrund() +
      '<div class="q-absender">' + esc([b.name || "Networkcity", b.street, b.zip_city].filter(Boolean).join(" · ")) + "</div>" +
      '<div class="q-kopf"><div class="q-titel"><h1>Quittung</h1>' +
        '<table class="q-meta"><tr><td>Quittungs-Nr.</td><td><strong>' + esc(d.nr) + "</strong></td></tr>" +
        "<tr><td>Datum</td><td><strong>" + esc(datum) + "</strong></td></tr>" +
        (d.kunde ? "<tr><td>Käufer/-in</td><td><strong>" + esc(d.kunde) + "</strong></td></tr>" : "") + "</table></div>" +
        '<div class="q-logo"><img src="assets/logo-papier.png" alt="Networkcity 2"><div class="q-kontakt">' + kontakt + "</div></div></div>" +
      '<table class="q-posten"><thead><tr><th>Artikel</th><th class="r">Betrag</th></tr></thead><tbody><tr><td>' +
        '<div class="q-modell">' + esc(d.modell) + "</div>" +
        (d.imei ? '<div class="q-imei">IMEI: <strong>' + esc(d.imei.replace(/\s/g, "")) + "</strong></div>" : "") +
        (d.imei2 ? '<div class="q-imei">IMEI 2: <strong>' + esc(d.imei2.replace(/\s/g, "")) + "</strong></div>" : "") +
        '<div class="q-zustand">Zustand: ' + esc(d.zustand) + "</div>" +
        '</td><td class="r q-betrag">' + fmt(preis) + " €</td></tr></tbody></table>" +
      '<div class="q-summe"><span>Gesamtbetrag</span><strong>' + fmt(preis) + " €</strong></div>" +
      (d.steuer === "19" ? '<p class="q-hinweis">Im Gesamtbetrag sind 19 % MwSt. (' + fmt(mwst) + " €) enthalten.</p>" : "") +
      (d.steuer === "25a" ? '<p class="q-hinweis">Differenzbesteuerung gem. § 25a UStG – die Umsatzsteuer wird nicht gesondert ausgewiesen (kein Vorsteuerabzug möglich).</p>' : "") +
      (l.vat_id ? '<p class="q-hinweis">USt-IdNr.: ' + esc(l.vat_id) + "</p>" : "") +
      (d.garantie ? '<p class="q-garantie">' + esc(d.garantie) + "</p>" : "") +
      (d.bemerkung ? '<p class="q-hinweis">' + esc(d.bemerkung).replace(/\n/g, "<br>") + "</p>" : "") +
      '<div class="q-unterschrift"><span></span>Stempel / Unterschrift</div>' +
      '<div class="q-fuss">Vielen Dank für Ihren Einkauf! · ' + esc([b.name || "Networkcity", b.street, b.zip_city, b.phone ? "Tel. " + b.phone : ""].filter(Boolean).join(" · ")) + "</div>" +
      "</div>";
    const bilder = Array.prototype.slice.call(sheet.querySelectorAll("img"));
    Promise.all(bilder.map(function (img) { return img.decode ? img.decode().catch(function () {}) : null; }))
      .then(function () { window.print(); });
  }

  /* ---------------- Start ---------------- */

  (async function start() {
    try {
      const res = await fetch("api/me", { cache: "no-store", credentials: "same-origin" });
      const info = res.ok && /json/.test(res.headers.get("Content-Type") || "") ? await res.json() : null;
      if (info && info.mode === "server") {
        serverMode = true;
        serverConfigError = info.configError || "";
        if (info.loggedIn) {
          try { await loadAll(); return; } catch (e) { return renderLogin(e.message); }
        }
        return renderLogin();
      }
    } catch (e) { /* kein Server vorhanden (z. B. GitHub Pages) */ }
    const saved = storedToken();
    if (saved) login(saved, !!(function () { try { return localStorage.getItem("nc_token"); } catch (e) { return null; } })());
    else renderLogin();
  })();
})();
