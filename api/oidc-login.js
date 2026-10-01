import { callbackUrl, challenge, metadata, randomToken, requireOidc, TX_COOKIE } from "./_oidc.js"
import { cookie, handle, sign } from "./_lib.js"

// Starts the Authorization Code flow with PKCE. State, nonce and verifier
// travel in a short-lived signed cookie (Lax, so it survives the redirect
// back from the provider).
export const GET = handle(async (request) => {
  const cfg = requireOidc()
  const meta = await metadata(cfg.issuer)
  const tx = { state: randomToken(), nonce: randomToken(), verifier: randomToken(), at: Date.now() }
  const value = Buffer.from(JSON.stringify(tx)).toString("base64url")
  const url = new URL(meta.authorization_endpoint)
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: callbackUrl(request),
    scope: "openid profile email",
    state: tx.state,
    nonce: tx.nonce,
    code_challenge: challenge(tx.verifier),
    code_challenge_method: "S256",
  }).toString()
  return new Response(null, {
    status: 302,
    headers: {
      location: url.toString(),
      "set-cookie": cookie(TX_COOKIE, `${value}.${sign("oidc-tx|" + value)}`, { maxAge: 600, sameSite: "Lax", path: "/api/" }),
      "cache-control": "no-store",
    },
  })
})
