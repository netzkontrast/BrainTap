import { handle, json, sessionCookie } from "./_lib.js"

export const POST = handle(async () =>
  json({ ok: true }, { headers: { "set-cookie": sessionCookie("", 0) } }),
)
