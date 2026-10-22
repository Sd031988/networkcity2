/* Networkcity – öffentliche Website */
(function () {
  "use strict";
  const { esc, icon, fmtPrice, discountText, waLink, telLink, imageUrl } = NC;

  const app = document.getElementById("app");
  const footer = document.getElementById("footer");
  const nav = document.getElementById("nav");
  const menuBtn = document.getElementById("menu-btn");
  const dialog = document.getElementById("buy-dialog");

  let settings = null;
  let products = [];
  let promoTimer = null;
  // Getrennte Filter für Handy-Shop und Zubehör
  const shopStates = {
    shop: { q: "", condition: "Alle", cats: null, sort: "Empfohlen" },
    zubehoer: { q: "", condition: "Alle", cats: null, sort: "Empfohlen" },
  };
  function isAccessory(p) { return /zubeh/i.test(String(p.category || "")); }

  async function loadJson(path) {
    // Zeitstempel umgeht den Zwischenspeicher, damit Änderungen schnell sichtbar sind
    const res = await fetch(path + "?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error(path + ": HTTP " + res.status);
    return res.json();
  }

  /* ---------- Bausteine ---------- */

  function callButtons(b) {
    const parts = [];
    if (telLink(b.phone)) parts.push('<a class="btn" href="' + esc(telLink(b.phone)) + '">' + icon("call") + "Anrufen</a>");
    if (waLink(b.whatsapp)) parts.push('<a class="btn primary" href="' + esc(waLink(b.whatsapp)) + '" target="_blank" rel="noopener">' + icon("chat") + "WhatsApp</a>");
    return parts.join("");
  }

  function cta(textHtml) {
    return '<section class="card cta"><p>' + textHtml + '</p><div class="btn-row">' + callButtons(settings.business) + "</div></section>";
  }

  // Live-Anzeige „Jetzt geöffnet“ (wird jede Minute aktualisiert)
  function statusInner() {
    const st = NC.openStatus(settings);
    const cls = st.open ? (st.soon ? "soon" : "open") : "closed";
    const label = st.open ? (st.soon ? "Schließt bald" : "Jetzt geöffnet") : "Geschlossen";
    return '<span class="dot ' + cls + '"></span><strong>' + label + "</strong>" + (st.text ? '<span class="os-text"> · ' + esc(st.text) + "</span>" : "");
  }
  function statusPill(extra) {
    return '<span class="open-status' + (extra ? " " + extra : "") + '" role="status">' + statusInner() + "</span>";
  }
  setInterval(function () {
    if (!settings) return;
    document.querySelectorAll(".open-status").forEach(function (el) { el.innerHTML = statusInner(); });
  }, 60000);

  function hoursList() {
    const todayName = NC.WEEKDAYS_DE[(NC.berlinNow().getDay() + 6) % 7];
    return statusPill("in-card") + '<ul class="hours">' + (settings.hours || []).map(function (r) {
      const t = r.open ? esc(r.open) + " – " + esc(r.close) + " Uhr" : "Geschlossen";
      const today = r.day === todayName;
      return '<li class="' + (today ? "today" : "") + '"><span>' + esc(r.day) + (today ? ' <em class="today-tag">Heute</em>' : "") + "</span><span>" + t + "</span></li>";
    }).join("") + "</ul>";
  }

  function specialHoursBox() {
    const entries = NC.upcomingSpecialHours(settings);
    if (!entries.length) return "";
    const items = entries.map(function (e) {
      let extra = "";
      if (e.days === 0) extra = " – <strong>heute</strong>";
      else if (e.days === 1) extra = " – <strong>morgen</strong>";
      let line = esc(e.label) + extra + ": " + (e.row.open
        ? esc(e.row.open) + " – " + esc(e.row.close) + " Uhr"
        : "<strong>geschlossen</strong>");
      const note = String(e.row.note || "").trim();
      if (note) line += '<br><span class="muted small">' + esc(note) + "</span>";
      return "<li>" + line + "</li>";
    }).join("");
    return '<div class="card notice">' + icon("event") + "<div><strong>Sonderöffnungszeiten</strong><ul>" + items + "</ul></div></div>";
  }

  function productCard(p) {
    const sold = !!p.sold;
    let badge = "";
    if (sold) badge = '<span class="badge sold">' + icon("sell") + "Verkauft</span>";
    else if (p.condition === "Neu") badge = '<span class="badge new">' + icon("new_releases") + "Neu</span>";
    else if (p.condition === "Gebraucht") badge = '<span class="badge used">' + icon("history") + "Gebraucht</span>";

    const img = p.image
      ? '<img src="' + esc(imageUrl(p.image)) + '" alt="Produktbild: ' + esc(p.name) + '" loading="lazy">'
      : icon(isAccessory(p) ? "headphones" : "phone_iphone");

    const price = fmtPrice(p.price);
    let priceHtml = "";
    if (price) {
      if (sold) priceHtml = '<div class="price-old">' + price + "</div>";
      else {
        priceHtml = '<div class="price">' + price + "</div>";
        const old = fmtPrice(p.old_price);
        const disc = discountText(p);
        if (old && disc) priceHtml += '<div><span class="price-old">' + old + '</span><span class="price-discount">' + disc + "</span></div>";
      }
    }

    let foot = "";
    if (sold) foot = '<span class="muted small">' + icon("block") + " Bereits verkauft.</span>";
    else if (p.online_sale && settings.business.whatsapp) {
      const methods = NC.paymentMethodsFor(p, settings);
      if (methods.length) foot += '<span class="muted small">' + icon("payments") + " Bezahlung: " + methods.map(function (m) { return esc(m.label); }).join(" · ") + "</span>";
      foot += '<button class="btn primary" type="button" data-buy="' + esc(p.id) + '">' + icon("shopping_cart") + "Online kaufen / anfragen</button>";
    } else foot = '<span class="muted small">' + icon("storefront") + " Nur im Laden erhältlich.</span>";

    const desc = String(p.description || "").trim();
    return '<article class="card product' + (sold ? " is-sold" : "") + '">' +
      (p.image ? '<button class="product-img zoomable" type="button" data-zoom="' + esc(p.id) + '" aria-label="Bild vergrößern: ' + esc(p.name) + '">' + img + '<span class="zoom-hint">' + icon("visibility") + "</span></button>"
        : '<div class="product-img">' + img + "</div>") +
      '<div class="product-body">' + badge +
      '<div class="product-name">' + esc(p.name) + "</div>" + priceHtml +
      (desc ? '<p class="product-desc">' + esc(desc) + "</p>" : "") +
      '<div class="product-foot">' + foot + "</div></div></article>";
  }

  // Seitenkopf mit 3D-Icon-Plakette
  function pageHead(iconName, title, leadText) {
    return '<header class="page-head">' + icon(iconName, "badge3d") + '<div><h1>' + esc(title) + "</h1>" +
      (leadText ? '<p class="lead">' + esc(leadText) + "</p>" : "") + "</div></header>";
  }

  // Passendes Icon anhand des Leistungsnamens (Namen sind in der Verwaltung frei änderbar)
  const SERVICE_ICONS = [
    [/display|touch|glas|bildschirm/i, "smartphone"], [/akku|batter/i, "battery_charging_full"],
    [/lade|buchse|mikro|kabel/i, "cable"], [/wasser|feucht|flüssig/i, "water_drop"],
    [/software|update|virus|system/i, "memory"], [/daten|rettung|backup/i, "sd_card"],
    [/kamera|foto/i, "photo_camera"], [/pc|computer|rechner|internet/i, "computer"],
    [/druck/i, "print"], [/kopie|kopier/i, "content_copy"], [/scan/i, "scanner"],
    [/fax/i, "fax"], [/wlan|wifi/i, "wifi"], [/lautspr|hörer|audio/i, "headphones"],
  ];
  function serviceIcon(name) {
    for (let i = 0; i < SERVICE_ICONS.length; i++) if (SERVICE_ICONS[i][0].test(name || "")) return SERVICE_ICONS[i][1];
    return "sell";
  }

  function servicePriceRows(list) {
    return '<div class="list-gap price-list">' + (list || []).map(function (s) {
      return '<div class="card price-row">' + icon(serviceIcon(s.name), "badge3d small") +
        '<div class="pr-text"><strong>' + esc(s.name) + '</strong><span class="muted">' + esc(s.description) + "</span></div>" +
        '<span class="p">' + esc(s.price) + "</span></div>";
    }).join("") + "</div>";
  }

  /* ---------- Werbung (Karussell) ---------- */

  function promoHtml() {
    const cfg = settings.promo || {};
    if (!cfg.enabled) return "";
    const slides = (cfg.slides || []).filter(function (s) { return s.enabled !== false && s.image; });
    // Produkte mit Häkchen „Angebot“ automatisch als Werbebild anhängen (abschaltbar in der Verwaltung)
    if (cfg.include_featured !== false) {
      products.filter(function (p) {
        return p.featured && p.image && !p.sold && !NC.productIsHidden(p, settings.sold_remove_days);
      }).forEach(function (p) {
        const price = fmtPrice(p.price);
        const old = fmtPrice(p.old_price);
        const pct = Number(p.old_price) > Number(p.price) && Number(p.price) > 0
          ? Math.round((1 - Number(p.price) / Number(p.old_price)) * 100) : 0;
        let text = price ? (old && pct ? "Jetzt " + price + " statt " + old + " (−" + pct + " %)" : price) : "";
        slides.push({ image: p.image, badge: "Angebot", title: p.name, text: text, link: isAccessory(p) ? "#zubehoer" : "#shop", link_label: "Im Shop ansehen", product: true });
      });
    }
    if (!slides.length) return "";
    const h = Math.max(180, parseInt(cfg.height, 10) || 520);
    let html = '<div class="promo" id="promo" style="height:clamp(220px, 62vw, ' + h + 'px)" aria-roledescription="Karussell"><div class="promo-track" id="promo-track">';
    slides.forEach(function (s, i) {
      html += '<div class="promo-slide' + (s.product ? " is-product" : "") + '" role="group" aria-label="Bild ' + (i + 1) + " von " + slides.length + '">' +
        '<div class="promo-bg" style="background-image:url(\'' + esc(imageUrl(s.image)) + '\')" aria-hidden="true"></div>' +
        '<img src="' + esc(imageUrl(s.image)) + '" alt="' + esc(s.title || "Werbung") + '"' + (i ? ' loading="lazy"' : "") + ">";
      const parts = [];
      if (s.badge) parts.push('<span class="promo-badge">' + esc(s.badge) + "</span>");
      if (s.title) parts.push('<div class="promo-title">' + esc(s.title) + "</div>");
      if (s.text) parts.push('<p class="promo-text">' + esc(s.text) + "</p>");
      if (s.link && s.link_label && /^(https?:|tel:|mailto:|#)/i.test(s.link)) {
        const ext = /^https?:/i.test(s.link);
        parts.push('<a class="promo-link" href="' + esc(s.link) + '"' + (ext ? ' target="_blank" rel="noopener"' : "") + ">" + esc(s.link_label) + "</a>");
      }
      if (parts.length) html += '<div class="promo-overlay">' + parts.join("") + "</div>";
      html += "</div>";
    });
    html += "</div>";
    if (slides.length > 1) {
      html += '<button class="promo-nav promo-prev" type="button" aria-label="Vorheriges Bild">' + icon("chevron_left") + "</button>" +
        '<button class="promo-nav promo-next" type="button" aria-label="Nächstes Bild">' + icon("chevron_right") + "</button>" +
        '<div class="promo-dots">' + slides.map(function (_, i) { return '<button class="promo-dot" type="button" data-i="' + i + '" aria-label="Bild ' + (i + 1) + '"></button>'; }).join("") + "</div>";
    }
    return html + "</div>";
  }

  function initPromo() {
    const root = document.getElementById("promo");
    if (!root) return;
    const cfg = settings.promo || {};
    const track = document.getElementById("promo-track");
    const count = track.children.length;
    const dots = root.querySelectorAll(".promo-dot");
    const interval = Math.max(2, parseInt(cfg.interval, 10) || 5) * 1000;
    const autoplay = cfg.autoplay !== false && count > 1 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let index = 0;
    function render() {
      track.style.transform = "translateX(" + (-index * 100) + "%)";
      dots.forEach(function (d, i) { d.classList.toggle("active", i === index); });
    }
    function stop() { if (promoTimer) { clearInterval(promoTimer); promoTimer = null; } }
    function start() { stop(); if (autoplay) promoTimer = setInterval(function () { go(index + 1); }, interval); }
    function go(i) { index = ((i % count) + count) % count; render(); start(); }
    const prev = root.querySelector(".promo-prev");
    const next = root.querySelector(".promo-next");
    if (prev) prev.addEventListener("click", function () { go(index - 1); });
    if (next) next.addEventListener("click", function () { go(index + 1); });
    dots.forEach(function (d) { d.addEventListener("click", function () { go(Number(d.dataset.i)); }); });
    root.addEventListener("mouseenter", stop);
    root.addEventListener("mouseleave", start);
    // Wischen auf dem Handy
    let x0 = null;
    root.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; stop(); }, { passive: true });
    root.addEventListener("touchend", function (e) {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0;
      x0 = null;
      if (Math.abs(dx) > 40) go(index + (dx < 0 ? 1 : -1)); else start();
    });
    render();
    start();
  }

  /* ---------- Seiten ---------- */

  /* ---------- 3D-Erlebnis (Design „Hell & Orange“): Vollbild-Start + Scroll-Geschichte ---------- */

  let immersiveOff = null;
  function isImmersive() {
    return document.documentElement.dataset.theme === "orange";
  }

  function immersiveHtml() {
    const b = settings.business;
    const c = settings.internetcafe || {}, r = settings.repair || {};
    const steps = [
      ["computer", "Internetcafé", c.text || "PC-Arbeitsplätze, Drucken, Kopieren, Scannen und WLAN.", "#internetcafe", "Zum Internetcafé"],
      ["smartphone", "Handys", "Neu und geprüft gebraucht – zum fairen Preis, mit Gewährleistung und persönlicher Beratung im Laden.", "#shop", "Zum Handy-Shop"],
      ["build", "Reparatur", r.text || "Display, Akku, Ladebuchse und mehr – schnell und zum fairen Preis.", "#reparatur", "Zur Reparatur"],
      ["headphones", "Zubehör", "Hüllen, Ladegeräte, Kabel, Kopfhörer und mehr – passend zu Ihrem Gerät.", "#zubehoer", "Zum Zubehör"],
    ];
    const scene =
      '<div class="x-scene" aria-hidden="true"><div class="x-tilt">' +
        '<div class="x-glow"></div>' +
        '<div class="x-ring r1"></div><div class="x-ring r2"></div><div class="x-ring r3"></div>' +
        '<div class="x-globe"><div class="x-globe-net"></div></div>' +
        '<div class="x-orbit">' +
          ["computer", "smartphone", "build"].map(function (n, i) {
            return '<div class="x-sat" style="--i:' + i + '"><div class="x-sat-in">' + icon(n, "badge3d") + "</div></div>";
          }).join("") +
        "</div>" +
      "</div></div>";
    const promo = promoHtml();
    let html = promo ? '<div class="x-promo">' + promo + "</div>" : "";
    html +=
      '<section class="x-hero' + (promo ? " after-promo" : "") + '">' +
        '<div class="x-hero-text">' +
          '<p class="x-kicker">' + statusPill() + "</p>" +
          '<h1 class="x-title"><span>Internet.</span><span>Handys.</span><span class="x-accent">Reparatur.</span></h1>' +
          '<p class="x-lead">' + esc(b.hero_subtitle) + "</p>" +
          '<div class="btn-row"><a class="btn primary" href="#shop">' + icon("smartphone") + 'Zum Handy-Shop</a><a class="btn" href="#kontakt">' + icon("route") + "Kontakt & Anfahrt</a></div>" +
        "</div>" + scene +
        '<a class="x-scroll" href="#start" data-xscroll aria-label="Nach unten scrollen"><span></span>Scrollen</a>' +
      "</section>";
    html +=
      '<section class="x-story" style="--n:' + steps.length + '"><div class="x-sticky">' +
        '<div class="x-story-visual" aria-hidden="true">' +
          steps.map(function (st, i) { return '<div class="x-face" data-i="' + i + '">' + icon(st[0], "badge3d") + "</div>"; }).join("") +
        "</div>" +
        '<div class="x-story-text">' +
          steps.map(function (st, i) {
            return '<article class="x-step" data-i="' + i + '"><p class="x-step-num">' + String(i + 1).padStart(2, "0") + " / " + String(steps.length).padStart(2, "0") + "</p>" +
              "<h2>" + esc(st[1]) + "</h2><p>" + esc(st[2]) + '</p><a class="btn primary" href="' + st[3] + '">' + esc(st[4]) + "</a></article>";
          }).join("") +
          '<div class="x-progress">' + steps.map(function (st, i) { return '<span data-i="' + i + '"></span>'; }).join("") + "</div>" +
        "</div>" +
      "</div></section>";
    return html;
  }

  function initImmersive() {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const root = document.documentElement;
    const header = document.querySelector(".site-header");
    function chrome() {
      root.style.setProperty("--chrome-h", Math.round(header.getBoundingClientRect().bottom + window.scrollY) + "px");
      root.style.setProperty("--hdr-h", header.offsetHeight + "px");
    }
    chrome();
    document.body.classList.add("x-on");

    // Inhalte unterhalb beim Hereinscrollen einblenden
    const blocks = app.querySelectorAll(":scope > section:not(.x-hero):not(.x-story), :scope > .promo, :scope > .card");
    let io = null;
    if (!reduce && "IntersectionObserver" in window) {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("x-in"); io.unobserve(e.target); } });
      }, { rootMargin: "0px 0px -10% 0px" });
      blocks.forEach(function (el) { el.classList.add("x-reveal"); io.observe(el); });
    }

    const hero = app.querySelector(".x-hero");
    const story = app.querySelector(".x-story");
    const steps = story.querySelectorAll(".x-step");
    const faces = story.querySelectorAll(".x-face");
    const bars = story.querySelectorAll(".x-progress span");
    let active = -1, ticking = false;
    function setActive(i) {
      if (i === active) return;
      active = i;
      steps.forEach(function (el, k) { el.classList.toggle("on", k === i); el.classList.toggle("past", k < i); });
      faces.forEach(function (el, k) { el.classList.toggle("on", k === i); el.classList.toggle("past", k < i); });
      bars.forEach(function (el, k) { el.classList.toggle("on", k <= i); });
    }
    function update() {
      ticking = false;
      const vh = window.innerHeight;
      const hr = hero.getBoundingClientRect();
      const top0 = parseFloat(getComputedStyle(root).getPropertyValue("--hdr-h")) || 0;
      const hp = Math.min(1, Math.max(0, (top0 - hr.top) / Math.max(1, hr.height)));
      if (hr.top < vh * 0.75) hero.classList.add("x-live");
      hero.style.setProperty("--p", hp.toFixed(3));
      document.body.classList.toggle("x-scrolled", window.scrollY > 40);
      const r = story.getBoundingClientRect();
      const total = Math.max(1, story.offsetHeight - vh);
      const sp = Math.min(1, Math.max(0, -r.top / total));
      story.style.setProperty("--sp", sp.toFixed(3));
      setActive(Math.min(steps.length - 1, Math.floor(sp * steps.length * 0.999)));
    }
    function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(update); } }
    // 3D-Szene folgt der Maus
    const scene = hero.querySelector(".x-scene");
    function onMove(e) {
      if (reduce || e.pointerType !== "mouse") return;
      const x = e.clientX / window.innerWidth - 0.5, y = e.clientY / window.innerHeight - 0.5;
      scene.style.setProperty("--mx", (x * 22).toFixed(2) + "deg");
      scene.style.setProperty("--my", (-y * 16).toFixed(2) + "deg");
    }
    hero.querySelector("[data-xscroll]").addEventListener("click", function (e) {
      e.preventDefault();
      window.scrollTo({ top: story.offsetTop - 60, behavior: reduce ? "auto" : "smooth" });
    });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", chrome);
    window.addEventListener("resize", onScroll);
    window.addEventListener("pointermove", onMove);
    update();
    immersiveOff = function () {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", chrome);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("pointermove", onMove);
      if (io) io.disconnect();
      document.body.classList.remove("x-on", "x-scrolled");
      immersiveOff = null;
    };
  }

  function pageStart() {
    const b = settings.business;
    const immersive = isImmersive();
    let html = "";
    if (immersive) html += immersiveHtml();
    else {
      // Werbung in allen Designs ganz oben als Vollbild
      const promo = promoHtml();
      if (promo) html += '<div class="x-promo">' + promo + "</div>";
      html += '<div class="hero' + (promo ? " after-promo" : "") + '">';
      if (b.hero_image) html += '<img class="hero-img" src="' + esc(imageUrl(b.hero_image)) + '" alt="Logo des Ladens ' + esc(b.name) + '">';
      html += "<h1>" + esc(b.hero_title) + '</h1><p class="lead">' + esc(b.hero_subtitle) + "</p>" +
        '<div class="chips"><a class="chip" href="#shop">Neu & geprüft gebraucht</a><a class="chip" href="#reparatur">Reparatur</a><a class="chip" href="#internetcafe">Internetcafé</a><a class="chip" href="#zubehoer">Zubehör</a></div>' +
        '<div class="btn-row center"><a class="btn primary" href="#shop">' + icon("shopping_bag") + 'Zum Handy-Shop</a><a class="btn" href="#kontakt">' + icon("route") + "Kontakt & Anfahrt</a></div></div>";
    }
    html += specialHoursBox();

    const featured = products.filter(function (p) { return p.featured && !NC.productIsHidden(p, settings.sold_remove_days); }).slice(0, 6);
    if (featured.length) {
      html += '<section><h2 class="section-title">' + icon("local_offer") + 'Aktuelle Angebote</h2><div class="grid c3">' + featured.map(productCard).join("") + "</div></section>";
    }

    const services = [
      ["computer", "Internetcafé", "PC-Arbeitsplätze, Drucken, Kopieren, Scannen und WLAN für alle.", "#internetcafe"],
      ["smartphone", "Handys neu & gebraucht", "Aktuelle Modelle und geprüfte Gebrauchtgeräte zum fairen Preis.", "#shop"],
      ["build", "Reparaturservice", "Schnelle Reparatur von Display, Akku, Ladebuchse und mehr.", "#reparatur"],
      ["headphones", "Zubehör", "Hüllen, Ladegeräte, Kabel, Kopfhörer und vieles mehr im Laden.", "#zubehoer"],
    ];
    html += '<section><h2 class="section-title">' + icon("grid_view") + 'Unsere Services</h2><div class="grid c4">' +
      services.map(function (s) {
        return '<a class="card service-card" href="' + s[3] + '" style="text-decoration:none;color:inherit">' + icon(s[0], "big") + "<h3>" + s[1] + "</h3><p>" + s[2] + "</p></a>";
      }).join("") + "</div></section>";

    const extra = settings.extra_services || [];
    if (extra.length) {
      html += '<section><h2 class="section-title">' + icon("handshake") + 'Weitere Services</h2><div class="grid c4">' +
        extra.map(function (s) {
          return '<div class="card service-card">' + icon(s.icon || "sell", "big") + "<h3>" + esc(s.name) + "</h3>" + (s.description ? "<p>" + esc(s.description) + "</p>" : "") + "</div>";
        }).join("") + "</div></section>";
    }

    // Über uns & Öffnungszeiten ganz unten
    html += '<section class="grid info"><div class="card"><h2 class="section-title">' + icon("info") + "Über uns</h2><p>" + esc(b.about_text) + "</p>" +
      '<p class="muted">' + icon("place") + " " + esc(b.street) + ", " + esc(b.zip_city) + "</p></div>" +
      '<div class="card"><h2 class="section-title">' + icon("schedule") + "Öffnungszeiten</h2>" + hoursList() + "</div></section>";

    html += cta("<strong>Haben Sie Fragen?</strong> Rufen Sie uns an unter <strong>" + esc(b.phone) + "</strong> oder schreiben Sie uns per WhatsApp – wir beraten Sie gerne.");
    app.innerHTML = html;
    initPromo();
    if (immersive) initImmersive();
  }

  function pageCafe() {
    const c = settings.internetcafe || {};
    let html = pageHead("computer", c.title || "Internetcafé", c.text);
    if ((c.bullet_points || []).length) html += '<ul class="feature-chips">' + c.bullet_points.map(function (x) { return "<li>" + icon("check_circle") + "<span>" + esc(x) + "</span></li>"; }).join("") + "</ul>";
    html += '<section><h2 class="section-title">' + icon("receipt_long") + "Leistungen & Preise</h2>" + servicePriceRows(c.services) + "</section>";
    html += cta("<strong>Gerne können Sie einfach vorbeikommen</strong> – meist ist direkt ein Platz frei. Egal ob für die schnelle E-Mail, das Ausdrucken von Tickets oder eine Zeit am Rechner: Wir sind für Sie da.");
    app.innerHTML = html;
  }

  function pageRepair() {
    const r = settings.repair || {};
    let html = pageHead("build", r.title || "Handy-Reparatur", r.text);
    if ((r.steps || []).length) {
      html += '<section><h2 class="section-title">' + icon("checklist") + 'So einfach geht\'s</h2><ol class="steps">' +
        r.steps.map(function (s, i) { return '<li class="card step"><span class="step-num">' + (i + 1) + "</span><span>" + esc(s) + "</span></li>"; }).join("") + "</ol></section>";
    }
    html += '<section><h2 class="section-title">' + icon("receipt_long") + "Leistungen & Preise</h2>" + servicePriceRows(r.services) + "</section>";
    html += cta("<strong>Bringen Sie Ihr Gerät einfach vorbei</strong> oder rufen Sie vorher kurz an. Die Prüfung ist kostenlos und Sie bekommen für alles ein faires Angebot.");
    app.innerHTML = html;
  }

  function pageContact() {
    const b = settings.business;
    let html = pageHead("contact_phone", "Kontakt & Anfahrt", "Rufen Sie an, schreiben Sie per WhatsApp oder kommen Sie direkt im Laden vorbei.") + specialHoursBox();
    const rows = [];
    if (b.street) rows.push(['place', "Adresse", esc(b.street) + "<br>" + esc(b.zip_city), "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(b.street + ", " + b.zip_city), true]);
    if (telLink(b.phone)) rows.push(["call", "Telefon", esc(b.phone), telLink(b.phone)]);
    if (waLink(b.whatsapp)) rows.push(["chat", "WhatsApp", esc(b.whatsapp), waLink(b.whatsapp), true]);
    if (b.email) rows.push(["mail", "E-Mail", esc(b.email), "mailto:" + b.email]);
    html += '<section class="grid c2" style="margin-top:24px"><div class="card"><h2 class="section-title">' + icon("contact_page") + "Kontakt</h2>" +
      '<ul class="contact-list">' + rows.map(function (r) {
        return '<li><a href="' + esc(r[3]) + '"' + (r[4] ? ' target="_blank" rel="noopener"' : "") + ">" + icon(r[0], "badge3d small") +
          '<span><span class="cl-label">' + r[1] + "</span>" + r[2] + "</span></a></li>";
      }).join("") + "</ul>" +
      '<div class="btn-row">' + callButtons(b) + (b.email ? '<a class="btn" href="mailto:' + esc(b.email) + '">' + icon("mail") + "E-Mail</a>" : "") + "</div></div>" +
      '<div class="card"><h2 class="section-title">' + icon("schedule") + "Öffnungszeiten</h2>" + hoursList() + "</div></section>";
    if (b.map_url && /^https:\/\/(www\.)?(google\.[a-z.]+|maps\.google\.[a-z.]+)\//i.test(b.map_url)) {
      // Karte erst nach Klick laden – vorher werden keine Daten an Google übertragen
      html += '<section><h2 class="section-title">' + icon("map") + 'Anfahrt</h2><div class="card map-consent" id="map-box">' +
        "<p>Beim Laden der Karte werden Daten (u. a. Ihre IP-Adresse) an Google übertragen.</p>" +
        '<div class="btn-row center"><button class="btn primary" type="button" id="map-load">' + icon("map") + "Karte laden</button>" +
        '<a class="btn" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(b.street + ", " + b.zip_city) + '" target="_blank" rel="noopener">' + icon("open_in_new") + "In Google Maps öffnen</a></div></div></section>";
    }
    app.innerHTML = html;
    const mapBtn = document.getElementById("map-load");
    if (mapBtn) mapBtn.addEventListener("click", function () {
      document.getElementById("map-box").outerHTML = '<iframe class="map" src="' + esc(b.map_url) +
        '" title="Google-Maps-Karte mit dem Standort von ' + esc(b.name) + '" referrerpolicy="no-referrer-when-downgrade"></iframe>';
    });
  }

  function pageShop() { shopPage("shop"); }
  function pageAccessories() { shopPage("zubehoer"); }

  function shopPage(kind) {
    const acc = kind === "zubehoer";
    const shopState = shopStates[kind];
    const visible = products.filter(function (p) { return !NC.productIsHidden(p, settings.sold_remove_days) && isAccessory(p) === acc; });
    const cats = Array.from(new Set(visible.map(function (p) { return p.category; }).filter(Boolean))).sort();
    if (!shopState.cats) shopState.cats = cats.slice();

    app.innerHTML = (acc
      ? pageHead("headphones", "Zubehör", "Hüllen, Ladegeräte, Kabel, Kopfhörer und mehr – passend zu Ihrem Gerät und mit Beratung direkt im Laden.")
      : pageHead("smartphone", "Handy-Shop", "Neu und geprüft gebraucht – zum fairen Preis, mit Gewährleistung und persönlicher Beratung direkt im Laden.")) +
      '<nav class="shop-switch" aria-label="Bereich wählen"><a href="#shop"' + (acc ? "" : ' class="on" aria-current="page"') + ">" + icon("smartphone") + "Handys & Geräte</a>" +
      '<a href="#zubehoer"' + (acc ? ' class="on" aria-current="page"' : "") + ">" + icon("headphones") + "Zubehör</a></nav>" +
      '<div class="filters card">' +
      '<div class="filters-row"><label class="search"><span class="visually-hidden">Produkt suchen</span><input type="search" id="shop-q" placeholder="' + (acc ? "z. B. Hülle, Ladekabel, Kopfhörer …" : "z. B. iPhone, Samsung, Tablet …") + '" value="' + esc(shopState.q) + '"></label>' +
      '<div class="seg" id="shop-cond" role="group" aria-label="Zustand">' + ["Alle", "Neu", "Gebraucht"].map(function (c) {
        return '<button type="button" data-v="' + c + '" class="' + (shopState.condition === c ? "on" : "") + '" aria-pressed="' + (shopState.condition === c) + '">' + c + "</button>";
      }).join("") + "</div></div>" +
      (cats.length > 1 ? '<div class="filters-row" id="shop-cats" role="group" aria-label="Kategorie">' + cats.map(function (c) {
        const on = shopState.cats.indexOf(c) !== -1;
        return '<button type="button" class="cat-toggle' + (on ? " on" : "") + '" data-c="' + esc(c) + '" aria-pressed="' + on + '">' + esc(c) + "</button>";
      }).join("") + "</div>" : "") +
      '<div class="filters-row"><label class="field" style="flex-direction:row;align-items:center;gap:8px"><span>Sortierung</span>' +
      '<select id="shop-sort" style="width:auto">' + ["Empfohlen", "Preis aufsteigend", "Preis absteigend"].map(function (s) {
        return "<option" + (shopState.sort === s ? " selected" : "") + ">" + s + "</option>";
      }).join("") + "</select></label></div></div>" +
      '<p class="muted small" id="shop-count"></p><div class="grid c3" id="shop-grid"></div>' +
      '<div id="shop-cta"></div>';

    function renderList() {
      const q = shopState.q.trim().toLowerCase();
      let list = visible.filter(function (p) {
        if (q && String(p.name).toLowerCase().indexOf(q) === -1 && String(p.description || "").toLowerCase().indexOf(q) === -1) return false;
        if (shopState.condition !== "Alle" && p.condition !== shopState.condition) return false;
        if (cats.length > 1 && p.category && shopState.cats.indexOf(p.category) === -1) return false;
        return true;
      });
      const price = function (p) { return Number(p.price) || 0; };
      list.sort(function (a, b) {
        const s = (a.sold ? 1 : 0) - (b.sold ? 1 : 0);
        if (s) return s;
        if (shopState.sort === "Preis aufsteigend") return price(a) - price(b);
        if (shopState.sort === "Preis absteigend") return price(b) - price(a);
        const f = (a.featured ? 0 : 1) - (b.featured ? 0 : 1);
        return f || price(a) - price(b);
      });
      document.getElementById("shop-count").textContent = list.length ? list.length + (list.length === 1 ? " Artikel" : " Artikel") : "";
      let empty = "Keine Produkte gefunden. Schauen Sie bald wieder vorbei!";
      if (!visible.length && acc) empty = "Noch kein Zubehör online. Hüllen, Ladegeräte, Kabel, Kopfhörer und mehr finden Sie direkt bei uns im Laden.";
      document.getElementById("shop-grid").innerHTML = list.length ? list.map(productCard).join("")
        : '<div class="empty" style="grid-column:1/-1">' + icon(acc ? "headphones" : "smartphone", "badge3d") + "<p>" + empty + "</p></div>";
    }

    document.getElementById("shop-q").addEventListener("input", function (e) { shopState.q = e.target.value; renderList(); });
    document.getElementById("shop-sort").addEventListener("change", function (e) { shopState.sort = e.target.value; renderList(); });
    document.getElementById("shop-cond").addEventListener("click", function (e) {
      const btn = e.target.closest("button"); if (!btn) return;
      shopState.condition = btn.dataset.v;
      this.querySelectorAll("button").forEach(function (b) { const on = b === btn; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
      renderList();
    });
    const catsEl = document.getElementById("shop-cats");
    if (catsEl) catsEl.addEventListener("click", function (e) {
      const btn = e.target.closest("button"); if (!btn) return;
      const c = btn.dataset.c;
      const i = shopState.cats.indexOf(c);
      if (i === -1) shopState.cats.push(c); else shopState.cats.splice(i, 1);
      btn.classList.toggle("on", i === -1); btn.setAttribute("aria-pressed", i === -1);
      renderList();
    });
    renderList();
    document.getElementById("shop-cta").innerHTML = cta(acc
      ? "<strong>Sie suchen passendes Zubehör?</strong> Fragen Sie uns per Telefon oder WhatsApp – wir sagen Ihnen, was für Ihr Gerät da ist."
      : "<strong>Sie interessieren sich für ein Produkt?</strong> Rufen Sie uns an oder schreiben Sie uns per WhatsApp – wir legen es gerne für Sie zur Seite.");
  }


  /* ---------- Impressum & Datenschutz ---------- */

  function legalData() {
    const b = settings.business || {};
    const l = settings.legal || {};
    return {
      owner: String(l.owner_name || "").trim(),
      company: String(l.company_name || b.name || "").trim(),
      form: String(l.legal_form || "").trim(),
      vat: String(l.vat_id || "").trim(),
      regCourt: String(l.register_court || "").trim(),
      regNo: String(l.register_number || "").trim(),
      contentResp: String(l.content_responsible || "").trim(),
      b: b,
    };
  }

  function addressBlock(d) {
    const lines = [];
    if (d.company) lines.push("<strong>" + esc(d.company) + "</strong>");
    if (d.owner) lines.push("Inhaber: " + esc(d.owner));
    if (d.form) lines.push(esc(d.form));
    lines.push(esc(d.b.street), esc(d.b.zip_city));
    return "<p>" + lines.join("<br>") + "</p>";
  }

  function pageImpressum() {
    const d = legalData(), b = d.b;
    let html = pageHead("badge", "Impressum") + '<div class="card legal">' +
      "<h2>Angaben gemäß § 5 DDG</h2>" + addressBlock(d) +
      "<h2>Kontakt</h2><p>" +
      (b.phone ? "Telefon: " + esc(b.phone) + "<br>" : "") +
      (b.email ? 'E-Mail: <a href="mailto:' + esc(b.email) + '">' + esc(b.email) + "</a>" : "") + "</p>";
    if (d.regCourt || d.regNo) html += "<h2>Registereintrag</h2><p>" + (d.regCourt ? "Registergericht: " + esc(d.regCourt) + "<br>" : "") + (d.regNo ? "Registernummer: " + esc(d.regNo) : "") + "</p>";
    if (d.vat) html += "<h2>Umsatzsteuer-ID</h2><p>Umsatzsteuer-Identifikationsnummer gemäß § 27 a Umsatzsteuergesetz: " + esc(d.vat) + "</p>";
    if (d.contentResp) html += "<h2>Verantwortlich für den Inhalt</h2><p>" + esc(d.contentResp) + "<br>" + esc(b.street) + ", " + esc(b.zip_city) + "</p>";
    html += '<p class="muted small" style="margin:0"><a href="#datenschutz">Zur Datenschutzerklärung</a></p></div>';
    app.innerHTML = html;
  }

  function pageDatenschutz() {
    const d = legalData(), b = d.b;
    const ext = function (href, text) { return '<a href="' + href + '" target="_blank" rel="noopener">' + text + "</a>"; };
    app.innerHTML = pageHead("security", "Datenschutzerklärung") + '<div class="card legal">' +
      "<h2>1. Verantwortlicher</h2>" + addressBlock(d) + "<p>" +
      (b.phone ? "Telefon: " + esc(b.phone) + "<br>" : "") +
      (b.email ? 'E-Mail: <a href="mailto:' + esc(b.email) + '">' + esc(b.email) + "</a>" : "") + "</p>" +

      "<h2>2. Grundsätzliches</h2><p>Auf dieser Website setzen wir <strong>keine Cookies</strong> und <strong>keine Analyse- oder Tracking-Werkzeuge</strong> ein. " +
      "Es gibt keine Benutzerkonten für Besucher, kein Kontaktformular und keinen Newsletter. Schriftarten und Symbole werden von unserem eigenen Webspace geladen, nicht von Drittanbietern.</p>" +

      "<h2>3. Hosting über GitHub Pages</h2><p>Diese Website wird über GitHub Pages bereitgestellt, einen Dienst der GitHub, Inc., 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, USA. " +
      "Beim Aufruf der Website wird Ihre IP-Adresse von GitHub zu Sicherheitszwecken protokolliert und gespeichert, außerdem werden technisch notwendige Daten (z. B. aufgerufene Seite, Zeitpunkt, Browsertyp) verarbeitet. " +
      "Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; unser berechtigtes Interesse liegt in einer sicheren und zuverlässigen Bereitstellung der Website. " +
      "Dabei können Daten in die USA übertragen werden. GitHub ist nach dem EU-US Data Privacy Framework zertifiziert (Art. 45 DSGVO). " +
      "Weitere Informationen: " + ext("https://docs.github.com/de/site-policy/privacy-policies/github-general-privacy-statement", "Datenschutzerklärung von GitHub") + ".</p>" +

      "<h2>4. Kontakt per Telefon, E-Mail oder WhatsApp</h2><p>Wenn Sie uns anrufen, eine E-Mail schreiben oder uns per WhatsApp kontaktieren, verarbeiten wir Ihre Angaben (z. B. Name, Telefonnummer, E-Mail-Adresse, Inhalt Ihrer Nachricht), um Ihre Anfrage zu bearbeiten. " +
      "Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO, soweit es um einen Kauf, eine Reparatur oder eine andere Leistung geht, und im Übrigen Art. 6 Abs. 1 lit. f DSGVO (Beantwortung von Anfragen).</p>" +
      "<p>Die Schaltflächen „WhatsApp“ und „Online kaufen / anfragen“ öffnen WhatsApp. Bei einer Kaufanfrage ist die Nachricht mit Produkt, Preis und gewählter Zahlungsart bereits vorausgefüllt; gesendet wird sie erst, wenn Sie selbst auf „Senden“ tippen. " +
      "WhatsApp wird von der WhatsApp Ireland Limited, Merrion Road, Dublin 4, D04 X2K5, Irland, betrieben; dabei gelten deren " + ext("https://www.whatsapp.com/legal/privacy-policy-eea", "Datenschutzbestimmungen") +
      ". Wenn Sie WhatsApp nicht nutzen möchten, erreichen Sie uns ebenso per Telefon, E-Mail oder persönlich im Laden.</p>" +

      "<h2>5. Google Maps</h2><p>Auf der Kontaktseite können Sie eine Karte von Google Maps anzeigen lassen. Die Karte wird <strong>erst geladen, wenn Sie auf „Karte laden“ klicken</strong>. " +
      "Erst dann werden Daten, insbesondere Ihre IP-Adresse, an Google übertragen. Anbieter ist die Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Irland; eine Übermittlung in die USA ist möglich (Google ist nach dem EU-US Data Privacy Framework zertifiziert). " +
      "Rechtsgrundlage ist Ihre Einwilligung durch den Klick (Art. 6 Abs. 1 lit. a DSGVO, § 25 Abs. 1 TDDDG). Sie gilt nur für den jeweiligen Seitenaufruf. Weitere Informationen: " +
      ext("https://policies.google.com/privacy?hl=de", "Datenschutzerklärung von Google") + ".</p>" +

      "<h2>6. Speicherdauer</h2><p>Wir speichern personenbezogene Daten nur so lange, wie es für den jeweiligen Zweck erforderlich ist. Unterlagen zu Käufen und Reparaturen bewahren wir auf, solange gesetzliche Aufbewahrungsfristen (insbesondere nach Handels- und Steuerrecht) dies verlangen.</p>" +

      "<h2>7. Ihre Rechte</h2><p>Sie haben das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20) sowie auf Widerspruch gegen Verarbeitungen, die auf Art. 6 Abs. 1 lit. f DSGVO beruhen (Art. 21). " +
      "Eine erteilte Einwilligung können Sie jederzeit mit Wirkung für die Zukunft widerrufen. Wenden Sie sich dazu einfach an die oben genannten Kontaktdaten.</p>" +
      "<p>Außerdem können Sie sich bei einer Datenschutz-Aufsichtsbehörde beschweren, zum Beispiel bei der für uns zuständigen " +
      ext("https://www.baden-wuerttemberg.datenschutz.de", "Landesbeauftragten für den Datenschutz und die Informationsfreiheit Baden-Württemberg") + ".</p>" +
      '<p class="muted small" style="margin:0">Stand: Oktober 2026 · <a href="#impressum">Impressum</a></p></div>';
  }

  /* ---------- Kaufanfrage ---------- */

  function openBuy(id) {
    const p = products.find(function (x) { return String(x.id) === String(id); });
    if (!p) return;
    const methods = NC.paymentMethodsFor(p, settings);
    const price = fmtPrice(p.price);
    let body = "";
    if (methods.length) {
      body = '<p class="muted small" style="margin:0">Wählen Sie Ihre Zahlungsart – wir bestätigen die Verfügbarkeit per WhatsApp.</p>' +
        '<fieldset style="border:0;padding:0;margin:0"><legend class="visually-hidden">Zahlungsart</legend><div class="radio-list">' +
        methods.map(function (m, i) {
          return '<label><input type="radio" name="pay" value="' + i + '"' + (i ? "" : " checked") + ">" + icon(m.icon || "payments") + " " + esc(m.label) + "</label>";
        }).join("") + '</div></fieldset><div id="pay-info"></div>' +
        '<a class="btn primary" id="buy-send" target="_blank" rel="noopener">' + icon("send") + "Bestellung per WhatsApp senden</a>";
    } else {
      body = '<div class="info-box">Für dieses Produkt sind aktuell keine Zahlungsarten hinterlegt. Bitte kontaktieren Sie uns direkt.</div><div class="btn-row">' + callButtons(settings.business) + "</div>";
    }
    dialog.innerHTML = '<div class="dialog-head"><h3 id="buy-title">Kaufanfrage</h3><button class="btn icon-only small" type="button" data-close aria-label="Schließen">' + icon("close") + "</button></div>" +
      '<div class="dialog-body"><div><div class="product-name">' + esc(p.name) + "</div>" + (price ? '<div class="price">' + price + "</div>" : "") + "</div>" + body + "</div>";

    function update() {
      const checked = dialog.querySelector("input[name=pay]:checked");
      if (!checked) return;
      const m = methods[Number(checked.value)];
      document.getElementById("pay-info").innerHTML = m.info ? '<div class="info-box">' + icon("info") + " " + esc(m.info) + "</div>" : "";
      const msg = "Hallo, ich möchte folgendes Produkt kaufen: " + p.name + (price ? " (" + price + ")" : "") +
        ".\nZahlungsart: " + m.label + ".\nIst es noch verfügbar?";
      document.getElementById("buy-send").href = waLink(settings.business.whatsapp, msg);
    }
    dialog.querySelectorAll("input[name=pay]").forEach(function (r) { r.addEventListener("change", update); });
    update();
    dialog.showModal();
  }
  dialog.addEventListener("click", function (e) {
    if (e.target === dialog || e.target.closest("[data-close]")) dialog.close();
  });
  app.addEventListener("click", function (e) {
    const btn = e.target.closest("[data-buy]");
    if (btn) return openBuy(btn.dataset.buy);
    const z = e.target.closest("[data-zoom]");
    if (z) openZoom(z.dataset.zoom);
  });

  // Großansicht eines Produktbilds
  const zoomDlg = document.createElement("dialog");
  zoomDlg.className = "zoom-dialog";
  zoomDlg.setAttribute("aria-label", "Produktbild");
  document.body.appendChild(zoomDlg);
  function openZoom(id) {
    const p = products.find(function (x) { return String(x.id) === String(id); });
    if (!p || !p.image) return;
    zoomDlg.innerHTML = '<button class="btn icon-only small zoom-close" type="button" data-close aria-label="Schließen">' + icon("close") + "</button>" +
      '<img src="' + esc(imageUrl(p.image)) + '" alt="Produktbild: ' + esc(p.name) + '">' +
      '<div class="zoom-cap"><strong>' + esc(p.name) + "</strong>" + (fmtPrice(p.price) && !p.sold ? "<span>" + fmtPrice(p.price) + "</span>" : "") + "</div>";
    zoomDlg.showModal();
  }
  zoomDlg.addEventListener("click", function (e) {
    if (e.target === zoomDlg || e.target.closest("[data-close]")) zoomDlg.close();
  });

  /* ---------- Routing ---------- */

  const PAGES = { start: pageStart, internetcafe: pageCafe, shop: pageShop, zubehoer: pageAccessories, reparatur: pageRepair, kontakt: pageContact, impressum: pageImpressum, datenschutz: pageDatenschutz };
  const TITLES = { start: "", internetcafe: "Internetcafé", shop: "Handy-Shop", zubehoer: "Zubehör", reparatur: "Reparatur", kontakt: "Kontakt", impressum: "Impressum", datenschutz: "Datenschutz" };

  function route() {
    if (!settings) return;
    if (promoTimer) { clearInterval(promoTimer); promoTimer = null; }
    if (immersiveOff) immersiveOff();
    let page = (location.hash || "#start").slice(1);
    if (!PAGES[page]) page = "start";
    nav.querySelectorAll("a").forEach(function (a) {
      const on = a.dataset.page === page;
      a.classList.toggle("active", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    nav.classList.remove("open");
    menuBtn.setAttribute("aria-expanded", "false");
    measureChrome();
    PAGES[page]();
    const base = settings.business.name + " " + (settings.business.zip_city || "").replace(/^\d+\s*/, "").split("-")[0];
    document.title = (TITLES[page] ? TITLES[page] + " – " : "") + base.trim();
    window.scrollTo(0, 0);
  }

  menuBtn.addEventListener("click", function () {
    const open = nav.classList.toggle("open");
    menuBtn.setAttribute("aria-expanded", String(open));
  });
  window.addEventListener("hashchange", route);
  function measureChrome() {
    const hdr = document.querySelector(".site-header");
    if (!hdr) return;
    const root = document.documentElement;
    root.style.setProperty("--chrome-h", Math.round(hdr.getBoundingClientRect().bottom + window.scrollY) + "px");
    root.style.setProperty("--hdr-h", hdr.offsetHeight + "px");
  }
  window.addEventListener("resize", measureChrome);
  // „Zum Inhalt springen“ ohne die Seiten-Adresse zu ändern
  document.getElementById("skip-link").addEventListener("click", function (e) { e.preventDefault(); app.focus(); });

  function renderChrome() {
    const b = settings.business;
    NC.applyTheme(settings.theme);
    const brand = document.getElementById("brand");
    brand.innerHTML = (b.logo ? '<img src="' + esc(imageUrl(b.logo)) + '" alt="">' : "") + "<span>" + esc(b.name) + "</span>";

    // Telefon direkt unter dem Namen (bleibt beim Scrollen sichtbar)
    const bp = document.getElementById("brand-phone");
    if (telLink(b.phone)) {
      bp.href = telLink(b.phone);
      bp.innerHTML = icon("call") + " " + esc(b.phone);
      bp.setAttribute("aria-label", "Anrufen: " + b.phone);
      bp.hidden = false;
    }

    // Kontaktleiste ganz oben
    const tb = document.getElementById("topbar");
    const items = [statusPill("in-topbar")];
    if (telLink(b.phone)) items.push('<a href="' + esc(telLink(b.phone)) + '">' + icon("call") + "<span>" + esc(b.phone) + "</span></a>");
    if (waLink(b.whatsapp)) items.push('<a href="' + esc(waLink(b.whatsapp)) + '" target="_blank" rel="noopener" class="tb-wa">' + icon("chat") + "<span>WhatsApp</span></a>");
    if (b.email) items.push('<a href="mailto:' + esc(b.email) + '" class="tb-mail">' + icon("mail") + "<span>" + esc(b.email) + "</span></a>");
    if (b.street) items.push('<a href="#kontakt" class="tb-addr">' + icon("place") + "<span>" + esc(b.street) + ", " + esc(b.zip_city) + "</span></a>");
    if (items.length) { tb.innerHTML = '<div class="wrap">' + items.join("") + "</div>"; tb.hidden = false; }

    // Strukturierte Daten für Google (Adresse, Telefon, Öffnungszeiten) – immer aus den aktuellen Einstellungen
    try {
      const zc = /^(\d{5})\s*(.*)$/.exec(String(b.zip_city || "").trim()) || [];
      const dayEn = { Montag: "Monday", Dienstag: "Tuesday", Mittwoch: "Wednesday", Donnerstag: "Thursday", Freitag: "Friday", Samstag: "Saturday", Sonntag: "Sunday" };
      const ld = {
        "@context": "https://schema.org", "@type": "ElectronicsStore",
        name: (b.name || "Networkcity 2"), url: location.origin + "/",
        image: b.hero_image ? new URL(imageUrl(b.hero_image), location.href).href : undefined,
        logo: b.logo ? new URL(imageUrl(b.logo), location.href).href : undefined,
        telephone: b.phone || undefined, email: b.email || undefined,
        address: { "@type": "PostalAddress", streetAddress: b.street, postalCode: zc[1], addressLocality: zc[2] || b.zip_city, addressCountry: "DE" },
        openingHoursSpecification: (settings.hours || []).filter(function (r) { return r.open && dayEn[r.day]; }).map(function (r) {
          return { "@type": "OpeningHoursSpecification", dayOfWeek: "https://schema.org/" + dayEn[r.day], opens: r.open, closes: r.close };
        }),
      };
      let el = document.getElementById("ld-business");
      if (!el) { el = document.createElement("script"); el.type = "application/ld+json"; el.id = "ld-business"; document.head.appendChild(el); }
      el.textContent = JSON.stringify(ld);
    } catch (e) { /* ohne strukturierte Daten weiter */ }

    // Schwebende Kontakt-Knöpfe (nur Handy-Ansicht)
    const fab = [];
    if (telLink(b.phone)) fab.push('<a class="fab call" href="' + esc(telLink(b.phone)) + '" aria-label="Anrufen">' + icon("call") + "</a>");
    if (waLink(b.whatsapp)) fab.push('<a class="fab wa" href="' + esc(waLink(b.whatsapp)) + '" target="_blank" rel="noopener" aria-label="WhatsApp schreiben">' + icon("chat") + "<span>WhatsApp</span></a>");
    if (fab.length && !document.getElementById("fab")) {
      const f = document.createElement("div"); f.id = "fab"; f.className = "fab-bar"; f.innerHTML = fab.join("");
      document.body.appendChild(f); document.body.classList.add("has-fab");
    }
    // Fußzeile: Marke, Seiten, Kontakt, Öffnungszeiten
    const short = { Montag: "Mo", Dienstag: "Di", Mittwoch: "Mi", Donnerstag: "Do", Freitag: "Fr", Samstag: "Sa", Sonntag: "So" };
    const groups = [];
    (settings.hours || []).forEach(function (r) {
      const t = r.open ? r.open + " – " + r.close + " Uhr" : "geschlossen";
      const g = groups[groups.length - 1];
      if (g && g.t === t) g.to = r.day; else groups.push({ from: r.day, to: r.day, t: t });
    });
    const hoursHtml = groups.map(function (g) {
      return "<li><span>" + esc(short[g.from] || g.from) + (g.to !== g.from ? "–" + esc(short[g.to] || g.to) : "") + "</span><span>" + esc(g.t) + "</span></li>";
    }).join("");
    footer.innerHTML =
      '<div class="f-col f-brand">' + (b.logo ? '<img src="' + esc(imageUrl(b.logo)) + '" alt="' + esc(b.name) + '" loading="lazy">' : "<strong>" + esc(b.name) + "</strong>") +
        (b.tagline ? "<p>" + esc(b.tagline) + "</p>" : "") + statusPill("in-footer") + "</div>" +
      '<nav class="f-col" aria-label="Seiten in der Fußzeile"><h4>Seiten</h4><a href="#internetcafe">Internetcafé</a><a href="#shop">Handy-Shop</a><a href="#zubehoer">Zubehör</a><a href="#reparatur">Reparatur</a><a href="#kontakt">Kontakt & Anfahrt</a></nav>' +
      '<div class="f-col"><h4>Kontakt</h4>' +
        (b.street ? "<p>" + esc(b.street) + "<br>" + esc(b.zip_city) + "</p>" : "") +
        (telLink(b.phone) ? '<a href="' + esc(telLink(b.phone)) + '">' + icon("call") + " " + esc(b.phone) + "</a>" : "") +
        (waLink(b.whatsapp) ? '<a href="' + esc(waLink(b.whatsapp)) + '" target="_blank" rel="noopener">' + icon("chat") + " WhatsApp</a>" : "") +
        (b.email ? '<a href="mailto:' + esc(b.email) + '">' + icon("mail") + " " + esc(b.email) + "</a>" : "") + "</div>" +
      '<div class="f-col"><h4>Öffnungszeiten</h4><ul class="f-hours">' + hoursHtml + "</ul></div>" +
      '<div class="f-bottom"><span>© ' + NC.berlinNow().getFullYear() + " " + esc(b.name) + '</span><span class="footer-links"><a href="#impressum">Impressum</a><a href="#datenschutz">Datenschutz</a></span></div>';
  }

  // 3D-Neigen der Karten – nur mit Maus und wenn Bewegung nicht reduziert ist
  (function setupTilt() {
    if (!window.matchMedia || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const MAX = 7;
    let current = null;
    function reset(el) {
      el.classList.remove("tilting");
      el.style.removeProperty("--rx"); el.style.removeProperty("--ry");
    }
    app.addEventListener("pointermove", function (e) {
      if (e.pointerType !== "mouse") return;
      const el = e.target.closest(".service-card, .product");
      if (current && current !== el) { reset(current); current = null; }
      if (!el) return;
      current = el;
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      el.classList.add("tilting");
      el.style.setProperty("--ry", ((px - 0.5) * 2 * MAX).toFixed(2) + "deg");
      el.style.setProperty("--rx", ((0.5 - py) * 2 * MAX).toFixed(2) + "deg");
      el.style.setProperty("--mx", (px * 100).toFixed(1) + "%");
      el.style.setProperty("--my", (py * 100).toFixed(1) + "%");
    });
    app.addEventListener("pointerleave", function () { if (current) { reset(current); current = null; } });
  })();

  Promise.all([loadJson("data/settings.json"), loadJson("data/products.json")])
    .then(function (res) {
      settings = res[0];
      settings.business = settings.business || {};
      products = Array.isArray(res[1]) ? res[1] : [];
      renderChrome();
      route();
    })
    .catch(function (err) {
      console.error(err);
      app.innerHTML = '<div class="error-box">Die Inhalte konnten nicht geladen werden. Bitte laden Sie die Seite neu.</div>';
    });
})();
