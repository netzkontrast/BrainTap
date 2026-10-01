import { createClient } from "@libsql/client"
import { createHmac, timingSafeEqual } from "node:crypto"

export const COOKIE = "bt_auth"
const COOKIE_MAX_AGE = 60 * 60 * 24 * 60

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
    ],
    "write",
  )
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

export function sessionToken() {
  return createHmac("sha256", password())
    .update("braintap-session-v1")
    .digest("hex")
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
      return decodeURIComponent(v.join("="))
    }
  }
  return null
}

export function requireAuth(request) {
  const token = readCookie(request, COOKIE)
  if (!token || !safeEqual(token, sessionToken())) {
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
