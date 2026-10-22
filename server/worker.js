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
    return env.ASSETS.fetch(request);
  },
};
