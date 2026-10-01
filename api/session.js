import { handle, json, loginMethods, session } from "./_lib.js"

// Who is signed in (if anyone) and which login methods the server offers.
export const GET = handle(async (request) => {
  let user = null
  try {
    const s = session(request)
    if (s) {
      try { user = JSON.parse(s.subject) } catch { user = { name: null, email: null } }
    }
  } catch {
    user = null
  }
  return json({ user, methods: loginMethods() })
})
