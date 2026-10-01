import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, describe, test } from "node:test"
import { exportJWK, generateKeyPair, SignJWT } from "jose"

// A minimal OIDC provider standing in for Auth0: discovery, JWKS, an
// authorize endpoint that remembers the nonce, and a token endpoint that
// checks the PKCE verifier and issues a signed ID token.
const dir = mkdtempSync(join(tmpdir(), "braintap-oidc-"))
let provider, issuer, keys, rogueKeys
const codes = new Map()
let nextEmail = "anna@example.com"
let tamper = null

before(async () => {
  keys = await generateKeyPair("RS256")
  rogueKeys = await generateKeyPair("RS256")
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: "k1", alg: "RS256", use: "sig" }
  provider = createServer(async (req, res) => {
    const url = new URL(req.url, issuer)
    const send = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)) }
    if (url.pathname === "/.well-known/openid-configuration") {
      return send(200, { issuer, authorization_endpoint: issuer + "authorize", token_endpoint: issuer + "oauth/token", jwks_uri: issuer + "jwks" })
    }
    if (url.pathname === "/jwks") return send(200, { keys: [jwk] })
    if (url.pathname === "/oauth/token") {
      let body = ""
      for await (const c of req) body += c
      const p = new URLSearchParams(body)
      const entry = codes.get(p.get("code"))
      const { createHash } = await import("node:crypto")
      if (!entry || p.get("client_secret") !== "secret" || createHash("sha256").update(p.get("code_verifier")).digest("base64url") !== entry.challenge) {
        return send(400, { error: "invalid_grant" })
      }
      const claims = { email: entry.email, email_verified: true, name: "Anna Orga", nonce: tamper === "nonce" ? "other" : entry.nonce }
      const signer = tamper === "key" ? rogueKeys.privateKey : keys.privateKey
      const idToken = await new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(issuer).setAudience("client-1").setSubject("auth0|1").setIssuedAt().setExpirationTime("5m").sign(signer)
      return send(200, { id_token: idToken, access_token: "x", token_type: "Bearer" })
    }
    send(404, {})
  })
  await new Promise((r) => provider.listen(0, r))
  issuer = `http://localhost:${provider.address().port}/`

  process.env.TURSO_DATABASE_URL = `file:${join(dir, "oidc.db")}`
  delete process.env.ORGA_PASSWORD
  process.env.AUTH_SECRET = "s".repeat(40)
  process.env.AUTH0_DOMAIN = issuer
  process.env.AUTH0_CLIENT_ID = "client-1"
  process.env.AUTH0_CLIENT_SECRET = "secret"
  process.env.AUTH_ALLOWED_EMAILS = "anna@example.com, ben@example.com"
})
after(() => { provider.close(); rmSync(dir, { recursive: true, force: true }) })

const base = "http://braintap.test"
const cookieOf = (res, name) => res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith(name + "="))

// Runs login → provider authorize → callback, returning the callback response.
async function signIn({ email = "anna@example.com", stateOverride } = {}) {
  const { GET: login } = await import("../api/oidc-login.js")
  const { GET: callback } = await import("../api/oidc-callback.js")
  const start = await login(new Request(base + "/api/oidc-login"))
  assert.equal(start.status, 302)
  const auth = new URL(start.headers.get("location"))
  assert.equal(auth.origin + "/", issuer)
  assert.equal(auth.searchParams.get("code_challenge_method"), "S256")
  assert.equal(auth.searchParams.get("redirect_uri"), base + "/api/oidc-callback")
  const code = "code-" + Math.random()
  codes.set(code, { email, nonce: auth.searchParams.get("nonce"), challenge: auth.searchParams.get("code_challenge") })
  const tx = cookieOf(start, "bt_oidc")
  const state = stateOverride ?? auth.searchParams.get("state")
  return callback(new Request(`${base}/api/oidc-callback?code=${code}&state=${encodeURIComponent(state)}`, { headers: { cookie: tx } }))
}

describe("OIDC login (Auth0-compatible)", () => {
  test("an allowed account signs in and gets a session with its name", async () => {
    const res = await signIn()
    assert.equal(res.status, 302)
    assert.equal(res.headers.get("location"), "/planung.html")
    const session = cookieOf(res, "bt_auth")
    assert.ok(session)
    const { GET: state } = await import("../api/state.js")
    assert.equal((await state(new Request(base + "/api/state", { headers: { cookie: session } }))).status, 200)
    const { GET: who } = await import("../api/session.js")
    const body = await (await who(new Request(base + "/api/session", { headers: { cookie: session } }))).json()
    assert.deepEqual(body.user, { email: "anna@example.com", name: "Anna Orga" })
    assert.deepEqual(body.methods, { password: false, oidc: true })
  })

  test("an account that is not on the list is sent back without a session", async () => {
    const res = await signIn({ email: "stranger@example.com" })
    assert.equal(res.status, 302)
    assert.match(decodeURIComponent(res.headers.get("location")), /nicht für das Orga-Team freigeschaltet/)
    assert.equal(cookieOf(res, "bt_auth"), undefined)
  })

  test("a mismatching state is rejected", async () => {
    const res = await signIn({ stateOverride: "forged" })
    assert.equal(res.status, 400)
  })

  test("an ID token signed with a foreign key is rejected", async () => {
    tamper = "key"
    try { assert.equal((await signIn()).status, 401) } finally { tamper = null }
  })

  test("an ID token with a different nonce is rejected", async () => {
    tamper = "nonce"
    try { assert.equal((await signIn()).status, 401) } finally { tamper = null }
  })

  test("the callback needs the signed transaction cookie", async () => {
    const { GET: callback } = await import("../api/oidc-callback.js")
    const res = await callback(new Request(base + "/api/oidc-callback?code=x&state=y"))
    assert.equal(res.status, 400)
  })

  test("without a session the API stays closed", async () => {
    const { GET: state } = await import("../api/state.js")
    assert.equal((await state(new Request(base + "/api/state"))).status, 401)
  })

  test("the variable names of the Vercel Auth0 integration work too", async () => {
    const saved = { domain: process.env.AUTH0_DOMAIN, secret: process.env.AUTH_SECRET }
    delete process.env.AUTH0_DOMAIN
    delete process.env.AUTH_SECRET
    process.env.AUTH0_ISSUER_BASE_URL = issuer
    process.env.AUTH0_SECRET = "s".repeat(40)
    try {
      const done = await signIn()
      assert.equal(done.status, 302)
      assert.equal(done.headers.get("location"), "/planung.html")
    } finally {
      process.env.AUTH0_DOMAIN = saved.domain
      process.env.AUTH_SECRET = saved.secret
      delete process.env.AUTH0_ISSUER_BASE_URL
      delete process.env.AUTH0_SECRET
    }
  })
})
