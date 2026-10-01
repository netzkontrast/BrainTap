import { createClient } from "@libsql/client"
import { createHmac, timingSafeEqual } from "node:crypto"

export const COOKIE = "bt_auth"
const SESSION_DAYS = 30
const COOKIE_MAX_AGE = 60 * 60 * 24 * SESSION_DAYS

// Collections stored as JSON rows in `items`. Answers and solutions get their
// own tables so they can be queried and exported as plain SQL.
export const ITEM_COLLECTIONS = new Set([
  "meta",
  "roles",
  "decisions",
  "tasks",
  "rounds",
  "tech",
  "teams",
  "scores",
  "questions",
  "expenses",
])

let ready = null

// Storage backends, in order of preference:
// - TURSO_DATABASE_URL: libSQL/Turso (also `file:` URLs for local dev/tests)
// - BLOB_READ_WRITE_TOKEN: the SQLite file as a private Vercel Blob, written
//   transactionally with ETag checks (no third-party database needed)
async function connect() {
  if (process.env.TURSO_DATABASE_URL) {
    return createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN })
  }
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { createSnapshotClient, vercelBlobStorage } = await import("./_snapshot.js")
    return createSnapshotClient(await vercelBlobStorage())
  }
  throw new HttpError(503, "Keine Datenbank konfiguriert (TURSO_DATABASE_URL oder BLOB_READ_WRITE_TOKEN)")
}

export function db() {
  ready ??= connect()
    .then(async (c) => {
      await migrate(c)
      return c
    })
    .catch((err) => {
      ready = null
      throw err
    })
  return ready
}

// Tests can run the API against another client (e.g. the snapshot backend).
export function useClientForTests(c) {
  ready = migrate(c).then(() => c)
}

export function storageKind() {
  if (process.env.TURSO_DATABASE_URL) return "turso"
  if (process.env.BLOB_READ_WRITE_TOKEN) return "vercel-blob"
  return "none"
}

// Columns added after the first release. Each sync batch bumps sync_rev once
// and stamps every row it actually changes, so clients can ask for
// "everything after revision N" instead of the whole state.
const TRACKING_COLUMNS = [
  ["rev", "INTEGER NOT NULL DEFAULT 0"],
  ["changed_by", "TEXT"],
  ["changed_at", "INTEGER"],
]
export const TABLES = ["items", "answers", "solutions"]

async function migrate(c) {
  await c.batch(
    [
      `CREATE TABLE IF NOT EXISTS items (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT,
        updated_at INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (collection, id))`,
      `CREATE TABLE IF NOT EXISTS answers (
        team_id TEXT NOT NULL,
        round_id TEXT NOT NULL,
        question INTEGER NOT NULL,
        answer TEXT,
        points REAL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (team_id, round_id, question))`,
      `CREATE TABLE IF NOT EXISTS solutions (
        round_id TEXT NOT NULL,
        question INTEGER NOT NULL,
        solution TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (round_id, question))`,
      `CREATE TABLE IF NOT EXISTS sync_rev (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        v INTEGER NOT NULL)`,
      "INSERT OR IGNORE INTO sync_rev (id, v) VALUES (1, 0)",
      // Speed round: the live game state (key "state", and the solution of the
      // running question under "solution", never sent to teams) and which
      // team devices have joined.
      `CREATE TABLE IF NOT EXISTS speed (
        key TEXT PRIMARY KEY,
        data TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS speed_joins (
        team_id TEXT PRIMARY KEY,
        joined_at INTEGER NOT NULL)`,
    ],
    "write",
  )

  const alters = []
  for (const table of TABLES) {
    const info = await c.execute(`PRAGMA table_info(${table})`)
    const have = new Set(info.rows.map((r) => r.name))
    for (const [name, type] of TRACKING_COLUMNS) {
      if (!have.has(name)) alters.push(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`)
    }
  }
  alters.push(
    "CREATE INDEX IF NOT EXISTS items_rev ON items (rev)",
    "CREATE INDEX IF NOT EXISTS answers_rev ON answers (rev)",
    "CREATE INDEX IF NOT EXISTS solutions_rev ON solutions (rev)",
    "CREATE INDEX IF NOT EXISTS items_changed ON items (changed_at)",
  )
  await c.batch(alters, "write")
}

export async function currentRev(c) {
  const r = await c.execute("SELECT v FROM sync_rev WHERE id = 1")
  return Number(r.rows[0]?.v ?? 0)
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...init.headers,
    },
  })
}

export function handle(fn) {
  return async (request) => {
    try {
      return await fn(request)
    } catch (err) {
      if (err instanceof HttpError) {
        return json({ error: err.message }, { status: err.status })
      }
      console.error(err)
      return json({ error: "Interner Fehler" }, { status: 500 })
    }
  }
}

function password() {
  const pw = process.env.ORGA_PASSWORD
  if (!pw) {
    throw new HttpError(503, "ORGA_PASSWORD ist nicht gesetzt")
  }
  return pw
}

// Login methods: the shared organiser password and/or an OIDC provider such
// as Auth0. Sessions of both kinds are signed with AUTH_SECRET (falling back
// to ORGA_PASSWORD); rotating it signs everybody out.
// AUTH0_ISSUER_BASE_URL and AUTH0_SECRET are the names the Auth0 integration
// from the Vercel Marketplace sets, so installing it needs no renaming.
export function oidcConfig() {
  const domain = process.env.AUTH0_DOMAIN || process.env.AUTH0_ISSUER_BASE_URL
  const clientId = process.env.AUTH0_CLIENT_ID
  const clientSecret = process.env.AUTH0_CLIENT_SECRET
  if (!domain || !clientId || !clientSecret) {
    return null
  }
  const issuer = domain.startsWith("http") ? domain.replace(/\/?$/, "/") : `https://${domain}/`
  return { issuer, clientId, clientSecret }
}

export function loginMethods() {
  return { password: Boolean(process.env.ORGA_PASSWORD), oidc: Boolean(oidcConfig()) }
}

export function allowedEmails() {
  return (process.env.AUTH_ALLOWED_EMAILS ?? "")
    .split(/[,\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

function secret() {
  const s = process.env.AUTH_SECRET || process.env.AUTH0_SECRET || process.env.ORGA_PASSWORD
  if (!s) {
    throw new HttpError(503, "Weder ORGA_PASSWORD noch AUTH_SECRET ist gesetzt")
  }
  return s
}

export function sign(message) {
  return createHmac("sha256", secret()).update(message).digest("hex")
}

const b64 = (s) => Buffer.from(s, "utf8").toString("base64url")
const unb64 = (s) => Buffer.from(s, "base64url").toString("utf8")

// "<expiry ms>.<base64url subject>.<hmac>": expiry and subject are signed, so
// neither can be changed by hand. Tokens are stateless. `purpose` keeps token
// kinds apart: a team token from the speed round is never an organiser session.
function signToken(purpose, subject, expiresAt) {
  const body = `${expiresAt}.${b64(subject)}`
  return `${body}.${sign(`${purpose}|${body}`)}`
}

function readSigned(purpose, token) {
  const parts = String(token).split(".")
  if (parts.length !== 3) return null
  const [exp, sub, sig] = parts
  const expiresAt = Number(exp)
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return null
  if (!safeEqual(sig, sign(`${purpose}|${exp}.${sub}`))) return null
  try {
    return { subject: unb64(sub) }
  } catch {
    return null
  }
}

const SESSION_PURPOSE = "braintap-session-v3"

export function sessionToken(subject = "orga", expiresAt = Date.now() + COOKIE_MAX_AGE * 1000) {
  return signToken(SESSION_PURPOSE, subject, expiresAt)
}

function readToken(token) {
  return readSigned(SESSION_PURPOSE, token)
}

// Speed round: one device per team, signed in with the team's join code.
export const TEAM_COOKIE = "bt_team"
const TEAM_PURPOSE = "braintap-team-v1"
export const TEAM_MAX_AGE = 60 * 60 * 12

export function teamToken(teamId, expiresAt = Date.now() + TEAM_MAX_AGE * 1000) {
  return signToken(TEAM_PURPOSE, teamId, expiresAt)
}

export function teamSession(request) {
  const token = readCookie(request, TEAM_COOKIE)
  const t = token ? readSigned(TEAM_PURPOSE, token) : null
  return t ? { teamId: t.subject } : null
}

// Five characters without look-alikes (no 0/O, 1/I/L), derived from the team
// id with the server secret: nothing to store, printable on the table cards.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
export function teamCode(teamId) {
  const digest = createHmac("sha256", secret()).update(`team-code|${teamId}`).digest()
  let code = ""
  for (let i = 0; i < 5; i++) code += CODE_ALPHABET[digest[i] % CODE_ALPHABET.length]
  return code
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

export function checkPassword(candidate) {
  return safeEqual(candidate ?? "", password())
}

function readCookie(request, name) {
  const header = request.headers.get("cookie") ?? ""
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=")
    if (k === name) {
      try {
        return decodeURIComponent(v.join("="))
      } catch {
        return null
      }
    }
  }
  return null
}

export { readCookie }

export function session(request) {
  const token = readCookie(request, COOKIE)
  return token ? readToken(token) : null
}

export function requireAuth(request) {
  const s = session(request)
  if (!s) {
    throw new HttpError(401, "Nicht angemeldet")
  }
  return s
}

export function cookie(name, value, { maxAge, sameSite = "Strict", path = "/" }) {
  const secure = process.env.VERCEL ? "; Secure" : ""
  return `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}${secure}`
}

export function sessionCookie(value, maxAge = COOKIE_MAX_AGE) {
  return cookie(COOKIE, value, { maxAge })
}

export async function readJson(request) {
  try {
    return await request.json()
  } catch {
    throw new HttpError(400, "Ungültiges JSON")
  }
}
