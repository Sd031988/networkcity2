// Networkcity – Einstiegspunkt für Cloudflare Workers (statische Seite + Server-Anmeldung).
// /api/* wird von den Funktionen in functions/api/ beantwortet, alles andere sind die
// statischen Dateien der Website (Binding ASSETS).
import * as login from "../functions/api/login.js";
import * as logout from "../functions/api/logout.js";
import * as me from "../functions/api/me.js";
import * as gh from "../functions/api/gh/[[path]].js";
import { json } from "./auth.js";

function pick(mod, method) {
  const name = "onRequest" + method.charAt(0) + method.slice(1).toLowerCase();
  return mod[name] || mod.onRequest || null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;
    let mod = null;
    if (p === "/api/login") mod = login;
    else if (p === "/api/logout") mod = logout;
    else if (p === "/api/me") mod = me;
    else if (p === "/api/gh" || p.startsWith("/api/gh/")) mod = gh;
    else if (p.startsWith("/api/")) return json(404, { error: "Nicht gefunden." });

    if (mod) {
      const fn = pick(mod, request.method);
      if (!fn) return json(405, { error: "Methode nicht erlaubt." });
      return fn({ request: request, env: env, waitUntil: ctx && ctx.waitUntil ? ctx.waitUntil.bind(ctx) : function () {} });
    }
    if (p.startsWith("/data/") && request.method === "GET") return dataLive(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
};

// Inhaltsdateien (Einstellungen, Produkte) kommen FRISCH über die GitHub-Api,
// Bilder über den einfachen Roh-Dienst. Eigener Zwischenspeicher: JSON 60 Sekunden,
// Bilder 5 Minuten – damit Speichern in der Verwaltung ohne Bereitstellung ankommt.
async function dataLive(request, env, ctx) {
  const repo = String(env.GITHUB_REPO || "Sd031988/networkcity2");
  const url = new URL(request.url);
  const p = url.pathname;
  const isJson = /\.json$/i.test(p);
  const ttl = isJson ? 60 : 300;
  const target = isJson
    ? "https://api.github.com/repos/" + repo + "/contents" + p + "?ref=main"
    : "https://raw.githubusercontent.com/" + repo + "/main" + p;
  const cacheKey = new Request("https://nc-data.internal" + p, { method: "GET" });
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;
  const headers = {};
  if (isJson) {
    headers.Accept = "application/vnd.github.raw";
    headers.Authorization = "Bearer " + env.GITHUB_TOKEN;
  }
  let res = await fetch(target, { headers: headers });
  if (!res.ok) return env.ASSETS.fetch(request);
  const headersOut = {
    "Content-Type": isJson ? guessType(p) : (res.headers.get("Content-Type") || guessType(p)),
    "Cache-Control": "public, max-age=30, s-maxage=" + ttl,
    "Access-Control-Allow-Origin": "*",
  };
  const out = new Response(res.body, { status: 200, headers: headersOut });
  if (ctx.waitUntil) ctx.waitUntil(caches.default.put(cacheKey, out.clone()));
  return out;
}

function guessType(path) {
  if (/\.json$/i.test(path)) return "application/json; charset=utf-8";
  if (/\.jpe?g$/i.test(path)) return "image/jpeg";
  if (/\.png$/i.test(path)) return "image/png";
  if (/\.webp$/i.test(path)) return "image/webp";
  if (/\.svg$/i.test(path)) return "image/svg+xml";
  if (/\.woff2?$/i.test(path)) return "font/woff2";
  return "application/octet-stream";
}
