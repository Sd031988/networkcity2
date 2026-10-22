/* Networkcity – gemeinsame Hilfsfunktionen (öffentliche Seite + Verwaltung) */
(function (global) {
  "use strict";

  const THEMES = {
    orange: {
      label: "Hell & Orange – 3D-Erlebnis (Vollbild-Start mit Scroll-Effekten)",
      swatch: ["#E8620C", "#07080B", "#F3F4F6"],
      primary: "#BF4A08", primary_hover: "#A63F05", primary_soft: "#FFF3EA",
      bg: "#F3F4F6", bg_grad: "none",
      surface: "#FFFFFF", surface2: "#F7F7F9", text: "#121317", muted: "#5F6672",
      border: "#E3E5EA", header: "rgba(7,8,11,0.94)",
      shadow: "0 14px 34px rgba(17,19,24,0.08)", on_primary: "#FFFFFF",
    },
    blue: {
      label: "Hell & Blau (schwarze Kopfzeile)",
      swatch: ["#2563EB", "#07080B", "#F2F5FA"],
      primary: "#2563EB", primary_hover: "#1D4ED8", primary_soft: "#EDF3FF",
      bg: "#F2F5FA", bg_grad: "none",
      surface: "#FFFFFF", surface2: "#F5F8FD", text: "#0F172A", muted: "#5B6679",
      border: "#DDE4F0", header: "rgba(7,8,11,0.94)",
      shadow: "0 14px 34px rgba(15,23,42,0.08)", on_primary: "#FFFFFF",
    },
    dark: {
      label: "Graphit & Chrom",
      swatch: ["#FF8A3D", "#17181D", "#C9CDD3"],
      primary: "#FF8A3D", primary_hover: "#FFA060", primary_soft: "#33200F",
      bg: "#17181D", bg_grad: "none",
      surface: "rgba(36,37,44,0.92)", surface2: "#24252C", text: "#EEF0F3", muted: "#A3A8B2",
      border: "rgba(255,255,255,0.09)", header: "rgba(18,19,23,0.88)",
      shadow: "0 16px 36px rgba(0,0,0,0.45)", on_primary: "#1A1005",
    },
    nacht: {
      label: "Networkcity Nacht (passend zum Logo)",
      swatch: ["#FF7A1A", "#07080B", "#C9CDD3"],
      primary: "#FF7A1A", primary_hover: "#FF9440", primary_soft: "#2B1708",
      bg: "#07080B",
      bg_grad: "none",
      surface: "rgba(20,21,27,0.86)", surface2: "#181920", text: "#F2F3F5", muted: "#A6AAB3",
      border: "rgba(255,255,255,0.09)", header: "rgba(7,8,11,0.82)",
      shadow: "0 18px 40px rgba(0,0,0,0.55)", on_primary: "#140A02",
    },
  };
  const DEFAULT_THEME = "orange";

  function applyTheme(key) {
    const t = THEMES[key] || THEMES[DEFAULT_THEME];
    const s = document.documentElement.style;
    s.setProperty("--nc-primary", t.primary);
    s.setProperty("--nc-primary-hover", t.primary_hover);
    s.setProperty("--nc-primary-soft", t.primary_soft);
    s.setProperty("--nc-bg", t.bg);
    s.setProperty("--nc-bg-grad", t.bg_grad);
    s.setProperty("--nc-surface", t.surface);
    s.setProperty("--nc-surface-2", t.surface2);
    s.setProperty("--nc-text", t.text);
    s.setProperty("--nc-muted", t.muted);
    s.setProperty("--nc-border", t.border);
    s.setProperty("--nc-header", t.header);
    s.setProperty("--nc-shadow", t.shadow);
    s.setProperty("--nc-on-primary", t.on_primary);
    document.documentElement.dataset.theme = key in THEMES ? key : DEFAULT_THEME;
  }

  const WEEKDAYS_DE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function fmtPrice(value) {
    const v = Number(value);
    if (!isFinite(v) || v <= 0) return "";
    return v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  }

  function discountText(p) {
    const price = Number(p.price) || 0;
    const old = Number(p.old_price) || 0;
    if (old <= 0 || price <= 0 || old <= price) return "";
    const diff = old - price;
    return "−" + fmtPrice(diff) + " (−" + Math.round((diff / old) * 100) + " %)";
  }

  // Datum als lokales "YYYY-MM-DD"
  function todayIso() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function parseIso(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  function daysBetween(a, b) {
    return Math.round((b - a) / 86400000);
  }

  function upcomingSpecialHours(settings, windowDays) {
    windowDays = windowDays == null ? 35 : windowDays;
    const today = parseIso(todayIso());
    const out = [];
    (settings.special_hours || []).forEach(function (row) {
      const d = parseIso(row.date);
      if (!d) return;
      const days = daysBetween(today, d);
      if (days < 0 || days > windowDays) return;
      const label = String(d.getDate()).padStart(2, "0") + "." + String(d.getMonth() + 1).padStart(2, "0") + "." +
        d.getFullYear() + " (" + WEEKDAYS_DE[(d.getDay() + 6) % 7] + ")";
      out.push({ date: d, days: days, label: label, row: row });
    });
    out.sort(function (a, b) { return a.date - b.date; });
    return out;
  }

  // Aktuelle Uhrzeit in Heidelberg (unabhängig von der Zeitzone des Besuchers)
  function berlinNow() {
    try {
      const parts = {};
      new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
        .formatToParts(new Date()).forEach(function (x) { parts[x.type] = x.value; });
      return new Date(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    } catch (e) { return new Date(); }
  }
  function isoOf(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function toMin(t) { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || "")); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }

  // Öffnungszeiten für ein Datum (Sonderöffnungszeiten haben Vorrang)
  function hoursFor(settings, d) {
    const iso = isoOf(d);
    const sp = (settings.special_hours || []).find(function (r) { return String(r.date || "").slice(0, 10) === iso; });
    const row = sp || (settings.hours || []).find(function (r) { return r.day === WEEKDAYS_DE[(d.getDay() + 6) % 7]; });
    if (!row || !row.open) return null;
    const o = toMin(row.open), c = toMin(row.close);
    if (o == null || c == null) return null;
    return { open: o, close: c <= o ? c + 1440 : c, openText: row.open, closeText: row.close };
  }

  // „Jetzt geöffnet“ / „Geschlossen – öffnet …“
  function openStatus(settings) {
    const now = berlinNow();
    const mins = now.getHours() * 60 + now.getMinutes();
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    const y = hoursFor(settings, yesterday);
    if (y && y.close > 1440 && mins < y.close - 1440) return { open: true, soon: y.close - 1440 - mins <= 60, text: "bis " + y.closeText + " Uhr" };
    const t = hoursFor(settings, now);
    if (t && mins >= t.open && mins < t.close) return { open: true, soon: t.close - mins <= 60, text: "bis " + t.closeText + " Uhr" };
    if (t && mins < t.open) return { open: false, text: "öffnet heute um " + t.openText + " Uhr" };
    for (let i = 1; i <= 14; i++) {
      const d = new Date(now); d.setDate(now.getDate() + i);
      const h = hoursFor(settings, d);
      if (h) return { open: false, text: "öffnet " + (i === 1 ? "morgen" : WEEKDAYS_DE[(d.getDay() + 6) % 7]) + " um " + h.openText + " Uhr" };
    }
    return { open: false, text: "" };
  }

  function productIsHidden(p, soldRemoveDays) {
    if (p.available === false) return true;
    if (!p.sold) return false;
    const soldAt = parseIso(p.sold_at);
    if (!soldAt) return false;
    let limit = parseInt(soldRemoveDays, 10);
    if (isNaN(limit)) limit = 7;
    return daysBetween(soldAt, parseIso(todayIso())) >= limit;
  }

  function enabledPaymentMethods(settings) {
    return (settings.payment_methods || []).filter(function (m) { return m.enabled !== false; });
  }
  function paymentMethodsFor(p, settings) {
    const enabled = enabledPaymentMethods(settings);
    const sel = p.payment_methods || [];
    if (!sel.length) return enabled;
    return enabled.filter(function (m) { return sel.indexOf(m.id) !== -1; });
  }

  function digitsOnly(phone) { return String(phone || "").replace(/\D/g, ""); }
  function waLink(phone, text) {
    const d = digitsOnly(phone);
    if (!d) return "";
    return "https://wa.me/" + d + (text ? "?text=" + encodeURIComponent(text) : "");
  }
  function telLink(phone) {
    const d = digitsOnly(phone);
    return d ? "tel:" + d : "";
  }
  function imageUrl(filename) {
    if (!filename) return "";
    return "data/images/" + encodeURIComponent(String(filename).split("/").pop());
  }
  function icon(name, extra) {
    return '<span class="ms' + (extra ? " " + extra : "") + '" aria-hidden="true">' + esc(name || "sell") + "</span>";
  }
  function uid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "");
    return Date.now().toString(16) + Math.random().toString(16).slice(2);
  }

  global.NC = {
    THEMES: THEMES, DEFAULT_THEME: DEFAULT_THEME, WEEKDAYS_DE: WEEKDAYS_DE,
    applyTheme: applyTheme, esc: esc, fmtPrice: fmtPrice, discountText: discountText,
    todayIso: todayIso, upcomingSpecialHours: upcomingSpecialHours, openStatus: openStatus, berlinNow: berlinNow, productIsHidden: productIsHidden,
    enabledPaymentMethods: enabledPaymentMethods, paymentMethodsFor: paymentMethodsFor,
    digitsOnly: digitsOnly, waLink: waLink, telLink: telLink, imageUrl: imageUrl, icon: icon, uid: uid,
  };
})(window);
