import { db, handle, json, loginMethods, storageKind } from "./_lib.js"

// Public setup check: says which storage is configured and whether it works,
// never any planning data.
export const GET = handle(async () => {
  const storage = storageKind()
  let database = "nicht konfiguriert"
  if (storage !== "none") {
    try {
      await db()
      database = "ok"
    } catch (err) {
      database = "Fehler: " + (err?.message ?? "unbekannt")
    }
  }
  const methods = loginMethods()
  return json({
    status: database === "ok" && (methods.password || methods.oidc) ? "ok" : "setup",
    storage,
    database,
    password: methods.password ? "gesetzt" : "fehlt (ORGA_PASSWORD)",
    login: methods.oidc ? "Auth0/OIDC" : methods.password ? "Passwort" : "keiner eingerichtet",
  })
})
