import { timingSafeEqual } from "node:crypto"
import { callbackUrl, metadata, requireOidc, TX_COOKIE, verifyIdToken } from "./_oidc.js"
import { allowedEmails, cookie, handle, HttpError, readCookie, sessionCookie, sessionToken, sign } from "./_lib.js"

const same = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

function transaction(request) {
  const raw = readCookie(request, TX_COOKIE) ?? ""
  const [value, sig] = raw.split(".")
  if (!value || !sig || !same(sig, sign("oidc-tx|" + value))) throw new HttpError(400, "Anmeldung abgelaufen, bitte neu starten")
  const tx = JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
  if (Date.now() - tx.at > 600_000) throw new HttpError(400, "Anmeldung abgelaufen, bitte neu starten")
  return tx
}

function back(message) {
  const q = message ? "?login_error=" + encodeURIComponent(message) : ""
  return { location: "/planung.html" + q }
}

export const GET = handle(async (request) => {
  const cfg = requireOidc()
  const params = new URL(request.url).searchParams
  const clear = cookie(TX_COOKIE, "", { maxAge: 0, sameSite: "Lax", path: "/api/" })
  if (params.get("error")) {
    return new Response(null, { status: 302, headers: { ...back(params.get("error_description") || params.get("error")), "set-cookie": clear } })
  }
  const tx = transaction(request)
  if (!params.get("state") || !same(params.get("state"), tx.state)) throw new HttpError(400, "Ungültiger Anmeldestatus")

  const meta = await metadata(cfg.issuer)
  const res = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.get("code") ?? "",
      redirect_uri: callbackUrl(request),
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code_verifier: tx.verifier,
    }),
  })
  if (!res.ok) throw new HttpError(401, "Anmeldung wurde vom Anbieter abgelehnt")
  const { id_token: idToken } = await res.json()
  const claims = await verifyIdToken(idToken, cfg, meta, tx.nonce)

  const email = String(claims.email ?? "").toLowerCase()
  if (!email || claims.email_verified === false || !allowedEmails().includes(email)) {
    return new Response(null, { status: 302, headers: { ...back(`${email || "Dieses Konto"} ist nicht für das Orga-Team freigeschaltet`), "set-cookie": clear } })
  }
  const name = String(claims.name || claims.given_name || email.split("@")[0]).slice(0, 40)
  const headers = new Headers({ ...back(), "cache-control": "no-store" })
  headers.append("set-cookie", clear)
  headers.append("set-cookie", sessionCookie(sessionToken(JSON.stringify({ email, name }))))
  return new Response(null, { status: 302, headers })
})
