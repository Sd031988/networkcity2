import { json, sameOrigin, sessionCookie } from "../../server/auth.js";

export async function onRequestPost(context) {
  if (!sameOrigin(context.request)) return json(403, { error: "Ungültige Herkunft." });
  return json(200, { ok: true }, { "Set-Cookie": sessionCookie("", 0) });
}
