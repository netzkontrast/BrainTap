import {
  checkPassword,
  handle,
  HttpError,
  json,
  readJson,
  sessionCookie,
  sessionToken,
} from "./_lib.js"

export const POST = handle(async (request) => {
  const { password } = await readJson(request)
  if (!checkPassword(password)) {
    throw new HttpError(401, "Falsches Passwort")
  }
  return json({ ok: true }, { headers: { "set-cookie": sessionCookie(sessionToken()) } })
})
