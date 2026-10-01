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

let client = null
let ready = null

export function db() {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL
    if (!url) {
      throw new HttpError(503, "TURSO_DATABASE_URL ist nicht gesetzt")
    }
    client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })
  }
  ready ??= migrate(client).catch((err) => {
    ready = null
    throw err
  })
  return ready.then(() => client)
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

// "<expiry ms>.<hmac>": the expiry is part of the signed message, so it can't
// be extended by hand. Tokens are stateless; changing ORGA_PASSWORD revokes
// every session at once.
export function sessionToken(expiresAt = Date.now() + COOKIE_MAX_AGE * 1000) {
  const sig = createHmac("sha256", password())
    .update(`braintap-session-v2|${expiresAt}`)
    .digest("hex")
  return `${expiresAt}.${sig}`
}

function validToken(token) {
  const [exp, sig] = String(token).split(".")
  const expiresAt = Number(exp)
  if (!sig || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) {
    return false
  }
  return safeEqual(token, sessionToken(expiresAt))
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

export function requireAuth(request) {
  const token = readCookie(request, COOKIE)
  if (!token || !validToken(token)) {
    throw new HttpError(401, "Nicht angemeldet")
  }
}

export function sessionCookie(value, maxAge = COOKIE_MAX_AGE) {
  const secure = process.env.VERCEL ? "; Secure" : ""
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`
}

export async function readJson(request) {
  try {
    return await request.json()
  } catch {
    throw new HttpError(400, "Ungültiges JSON")
  }
}
