// Weiterleitung zur GitHub-API – nur für angemeldete Verwalter und nur für die Inhaltsdateien.
import { configError, json, readSession, sameOrigin } from "../../../server/auth.js";

const DEFAULT_REPO = "Sd031988/networkcity";

export async function onRequest(context) {
  const { request, env } = context;
  const cfg = configError(env);
  if (cfg) return json(500, { message: cfg });
  if (!sameOrigin(request)) return json(403, { message: "Ungültige Herkunft." });
  if (!(await readSession(request, env))) return json(401, { message: "Nicht angemeldet." });

  const repo = env.GITHUB_REPO || DEFAULT_REPO;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/gh/, "");
  const esc = repo.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const method = request.method;

  const isRepo = new RegExp("^/repos/" + esc + "$", "i").test(path);
  const m = new RegExp("^/repos/" + esc + "/contents/(data/(?:settings\\.json|products\\.json|images|images/[A-Za-z0-9._-]+))$", "i").exec(path);
  const file = m ? m[1] : "";
  const isImageFile = /^data\/images\/[A-Za-z0-9_-]+\.(jpe?g|png|webp)$/i.test(file);

  let allowed = false;
  if (method === "GET") allowed = isRepo || !!m;
  else if (method === "PUT") allowed = file === "data/settings.json" || file === "data/products.json" || isImageFile;
  if (!allowed) return json(403, { message: "Diese Aktion ist nicht erlaubt." });

  const target = "https://api.github.com" + path + url.search;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: "Bearer " + env.GITHUB_TOKEN,
    "User-Agent": "networkcity-verwaltung",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  let body;
  if (method === "PUT") {
    headers["Content-Type"] = "application/json";
    body = await request.text();
    if (body.length > 15 * 1024 * 1024) return json(413, { message: "Datei zu groß." });
  }
  const res = await fetch(target, { method: method, headers: headers, body: body });
  // Abgelehnter GitHub-Token ist KEIN Anmeldeproblem des Verwalters → eigener Status
  if (res.status === 401) {
    return json(502, { message: "Der GitHub-Token in Cloudflare (GITHUB_TOKEN) ist ungültig oder abgelaufen. Bitte einen neuen Token erstellen und in Cloudflare ersetzen." });
  }
  if (res.status === 403 && method !== "GET") {
    return json(502, { message: "Der GitHub-Token in Cloudflare hat keine Schreibrechte. Er braucht „Contents: Read and write“ für dieses Repository." });
  }
  return new Response(res.body, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") || "application/json", "Cache-Control": "no-store" },
  });
}
