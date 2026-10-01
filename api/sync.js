import {
  db,
  handle,
  HttpError,
  ITEM_COLLECTIONS,
  json,
  readJson,
  requireAuth,
} from "./_lib.js"

const MAX_OPS = 2000

// Each op carries the client's timestamp. A write only lands if it is at least
// as new as the stored row, so concurrent editors win or lose per row instead
// of overwriting each other's whole state.
function toStatement(op) {
  const ts = Number(op.ts)
  if (!Number.isFinite(ts) || ts <= 0) {
    throw new HttpError(400, "Ungültiger Zeitstempel")
  }

  if (op.collection === "answers") {
    const { team_id, round_id, question, answer, points } = op.data ?? {}
    if (!team_id || !round_id || !Number.isInteger(question)) {
      throw new HttpError(400, "Ungültige Antwort")
    }
    return {
      sql: `INSERT INTO answers (team_id, round_id, question, answer, points, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (team_id, round_id, question) DO UPDATE SET
              answer = excluded.answer, points = excluded.points, updated_at = excluded.updated_at
            WHERE excluded.updated_at >= answers.updated_at`,
      args: [team_id, round_id, question, answer ?? null, points ?? null, ts],
    }
  }

  if (op.collection === "solutions") {
    const { round_id, question, solution } = op.data ?? {}
    if (!round_id || !Number.isInteger(question)) {
      throw new HttpError(400, "Ungültige Lösung")
    }
    return {
      sql: `INSERT INTO solutions (round_id, question, solution, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (round_id, question) DO UPDATE SET
              solution = excluded.solution, updated_at = excluded.updated_at
            WHERE excluded.updated_at >= solutions.updated_at`,
      args: [round_id, question, solution ?? null, ts],
    }
  }

  if (!ITEM_COLLECTIONS.has(op.collection)) {
    throw new HttpError(400, `Unbekannte Sammlung: ${op.collection}`)
  }
  if (typeof op.id !== "string" || !op.id || op.id.length > 200) {
    throw new HttpError(400, "Ungültige ID")
  }

  if (op.op === "seed") {
    return {
      sql: `INSERT OR IGNORE INTO items (collection, id, data, updated_at) VALUES (?, ?, ?, ?)`,
      args: [op.collection, op.id, JSON.stringify(op.data ?? null), ts],
    }
  }

  if (op.op === "del") {
    return {
      sql: `INSERT INTO items (collection, id, data, updated_at, deleted) VALUES (?, ?, 'null', ?, 1)
            ON CONFLICT (collection, id) DO UPDATE SET deleted = 1, updated_at = excluded.updated_at
            WHERE excluded.updated_at >= items.updated_at`,
      args: [op.collection, op.id, ts],
    }
  }

  if (op.op === "put") {
    return {
      sql: `INSERT INTO items (collection, id, data, updated_at, deleted) VALUES (?, ?, ?, ?, 0)
            ON CONFLICT (collection, id) DO UPDATE SET
              data = excluded.data, updated_at = excluded.updated_at, deleted = 0
            WHERE excluded.updated_at >= items.updated_at`,
      args: [op.collection, op.id, JSON.stringify(op.data ?? null), ts],
    }
  }

  throw new HttpError(400, `Unbekannte Operation: ${op.op}`)
}

export const POST = handle(async (request) => {
  requireAuth(request)
  const { ops } = await readJson(request)
  if (!Array.isArray(ops) || ops.length > MAX_OPS) {
    throw new HttpError(400, "ops muss ein Array mit höchstens 2000 Einträgen sein")
  }
  const statements = ops.map(toStatement)
  if (statements.length) {
    const c = await db()
    await c.batch(statements, "write")
  }
  return json({ ok: true, applied: statements.length })
})
