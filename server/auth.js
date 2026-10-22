// Networkcity – Hilfsfunktionen für die Server-Anmeldung (Cloudflare Pages Functions).
// Enthält KEINE Geheimnisse: Benutzername, Passwort, Sitzungsschlüssel und GitHub-Token
// liegen als verschlüsselte Umgebungsvariablen in Cloudflare.

const enc = new TextEncoder();
export const COOKIE = "nc_session";

function b64url(bytes) {
  let s = "";
  bytes.forEach(function (b) { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str) {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, function (c) { return c.charCodeAt(0); });
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

// Vergleich in konstanter Zeit (über HMAC beider Werte)
export async function safeEqual(a, b, secret) {
  const x = await hmac(secret, String(a));
  const y = await hmac(secret, String(b));
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export function configError(env) {
  const missing = ["ADMIN_USER", "ADMIN_PASSWORD", "SESSION_SECRET", "GITHUB_TOKEN"].filter(function (k) { return !env[k]; });
  if (missing.length) return "Server nicht vollständig eingerichtet. Fehlende Einstellungen in Cloudflare: " + missing.join(", ");
  if (String(env.SESSION_SECRET).length < 32) return "SESSION_SECRET in Cloudflare ist zu kurz (mindestens 32 Zeichen).";
  return "";
}

export async function makeSession(env, user, days) {
  const payload = b64url(enc.encode(JSON.stringify({ u: user, exp: Date.now() + days * 86400000 })));
  const sig = b64url(await hmac(env.SESSION_SECRET, payload));
  return payload + "." + sig;
}

export async function readSession(request, env) {
  if (!env.SESSION_SECRET) return null;
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)"));
  if (!m) return null;
  const parts = m[1].split(".");
  if (parts.length !== 2) return null;
  const expected = b64url(await hmac(env.SESSION_SECRET, parts[0]));
  if (!(await safeEqual(expected, parts[1], env.SESSION_SECRET))) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
    if (!data.exp || data.exp < Date.now()) return null;
    if (data.u !== env.ADMIN_USER) return null; // Benutzername geändert → alte Sitzungen ungültig
    return data;
  } catch (e) {
    return null;
  }
}

export function sessionCookie(value, maxAgeSeconds) {
  return COOKIE + "=" + value + "; Path=/api; HttpOnly; Secure; SameSite=Strict" +
    (maxAgeSeconds != null ? "; Max-Age=" + maxAgeSeconds : "");
}

export function json(status, obj, headers) {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, headers || {}),
  });
}

// Schutz gegen Anfragen von fremden Websites (CSRF): nur gleiche Herkunft erlaubt
export function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return request.method === "GET";
  return origin === new URL(request.url).origin;
}
