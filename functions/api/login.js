import { configError, json, makeSession, safeEqual, sameOrigin, sessionCookie } from "../../server/auth.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!sameOrigin(request)) return json(403, { error: "Ungültige Herkunft." });
  const cfg = configError(env);
  if (cfg) return json(500, { error: cfg });

  let body = {};
  try { body = await request.json(); } catch (e) { /* leer */ }
  const user = String(body.user || "").trim();
  const pass = String(body.password || "");

  const okUser = await safeEqual(user, env.ADMIN_USER, env.SESSION_SECRET);
  const okPass = await safeEqual(pass, env.ADMIN_PASSWORD, env.SESSION_SECRET);
  if (!okUser || !okPass) {
    // kleine Bremse gegen massenhaftes Durchprobieren
    await new Promise(function (r) { setTimeout(r, 1200); });
    return json(401, { error: "Benutzername oder Passwort falsch." });
  }
  const days = body.remember ? 30 : 0.5; // 30 Tage oder 12 Stunden
  const token = await makeSession(env, env.ADMIN_USER, days);
  return json(200, { ok: true }, { "Set-Cookie": sessionCookie(token, Math.round(days * 86400)) });
}
