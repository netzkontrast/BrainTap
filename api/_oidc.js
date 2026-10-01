import { createHash, randomBytes } from "node:crypto"
import { createRemoteJWKSet, jwtVerify } from "jose"
import { HttpError, oidcConfig } from "./_lib.js"

export const TX_COOKIE = "bt_oidc"
const discovery = new Map()
const jwks = new Map()

export function requireOidc() {
  const cfg = oidcConfig()
  if (!cfg) throw new HttpError(404, "Kein Login-Anbieter konfiguriert")
  return cfg
}

export async function metadata(issuer) {
  if (!discovery.has(issuer)) {
    const p = fetch(new URL(".well-known/openid-configuration", issuer)).then((r) => {
      if (!r.ok) throw new HttpError(502, "Login-Anbieter nicht erreichbar")
      return r.json()
    })
    discovery.set(issuer, p)
    p.catch(() => discovery.delete(issuer))
  }
  return discovery.get(issuer)
}

export function keySet(uri) {
  if (!jwks.has(uri)) jwks.set(uri, createRemoteJWKSet(new URL(uri)))
  return jwks.get(uri)
}

export const randomToken = () => randomBytes(32).toString("base64url")
export const challenge = (verifier) => createHash("sha256").update(verifier).digest("base64url")

export function callbackUrl(request) {
  return new URL("/api/oidc-callback", request.url).toString()
}

// Verifies signature, issuer, audience, expiry and nonce of the ID token.
export async function verifyIdToken(idToken, cfg, meta, nonce) {
  try {
    const { payload } = await jwtVerify(idToken, keySet(meta.jwks_uri), {
      issuer: meta.issuer ?? cfg.issuer,
      audience: cfg.clientId,
    })
    if (payload.nonce !== nonce) throw new Error("nonce")
    return payload
  } catch {
    throw new HttpError(401, "Anmeldung konnte nicht bestätigt werden")
  }
}
