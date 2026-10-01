import { db, handle, json, storageKind } from "./_lib.js"

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
  return json({
    status: database === "ok" && process.env.ORGA_PASSWORD ? "ok" : "setup",
    storage,
    database,
    password: process.env.ORGA_PASSWORD ? "gesetzt" : "fehlt (ORGA_PASSWORD)",
  })
})
