import { configError, json, readSession } from "../../server/auth.js";

// Sagt der Verwaltung, dass hier eine Server-Anmeldung verfügbar ist, und ob man angemeldet ist.
export async function onRequestGet(context) {
  const { request, env } = context;
  const session = await readSession(request, env);
  return json(200, { mode: "server", loggedIn: !!session, configError: configError(env) || undefined });
}
