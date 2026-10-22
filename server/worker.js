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
    if (p.startsWith("/data/") && request.method === "GET") return dataLive(request, env);
    return env.ASSETS.fetch(request);
  },
};

// Inhaltsdateien (Produkte, Einstellungen, Bilder) kommen FRISCH aus GitHub –
// strategisch knapper Zwischenspeicher (60 Sekunden), damit "Speichern" in der
// Verwaltung nach spätestens einer Minute auf der Website ankommt, ohne Bereitstellung.
async function dataLive(request, env) {
  const repo = String(env.GITHUB_REPO || "Sd031988/networkcity2");
  const url = new URL(request.url);
  const raw = "https://raw.githubusercontent.com/" + repo + "/main" + url.pathname;
  const res = await fetch(raw, { cf: { cacheTtl: 60, cacheEverything: true } });
  if (!res.ok) return env.ASSETS.fetch(request);
  return new Response(res.body, {
    status: 200,
    headers: {
      "Content-Type": res.headers.get("Content-Type") || guessType(url.pathname),
      "Cache-Control": "public, max-age=60, s-maxage=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
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
