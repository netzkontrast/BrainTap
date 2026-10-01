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
const REV = "(SELECT v FROM sync_rev WHERE id = 1)"

// Each op carries the client's timestamp. A write only lands if it is at least
// as new as the stored row, so concurrent editors win or lose per row instead
// of overwriting each other's whole state. Rows that change get the batch's
// revision, the author's name and the server time.
function toStatement(op, by, now) {
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
      sql: `INSERT INTO answers (team_id, round_id, question, answer, points, updated_at, rev, changed_by, changed_at)
            VALUES (?, ?, ?, ?, ?, ?, ${REV}, ?, ?)
            ON CONFLICT (team_id, round_id, question) DO UPDATE SET
              answer = excluded.answer, points = excluded.points, updated_at = excluded.updated_at,
              rev = excluded.rev, changed_by = excluded.changed_by, changed_at = excluded.changed_at
            WHERE excluded.updated_at >= answers.updated_at`,
      args: [team_id, round_id, question, answer ?? null, points ?? null, ts, by, now],
    }
  }

  if (op.collection === "solutions") {
    const { round_id, question, solution } = op.data ?? {}
    if (!round_id || !Number.isInteger(question)) {
      throw new HttpError(400, "Ungültige Lösung")
    }
    return {
      sql: `INSERT INTO solutions (round_id, question, solution, updated_at, rev, changed_by, changed_at)
            VALUES (?, ?, ?, ?, ${REV}, ?, ?)
            ON CONFLICT (round_id, question) DO UPDATE SET
              solution = excluded.solution, updated_at = excluded.updated_at,
              rev = excluded.rev, changed_by = excluded.changed_by, changed_at = excluded.changed_at
            WHERE excluded.updated_at >= solutions.updated_at`,
      args: [round_id, question, solution ?? null, ts, by, now],
    }
  }

  if (!ITEM_COLLECTIONS.has(op.collection)) {
    throw new HttpError(400, `Unbekannte Sammlung: ${op.collection}`)
  }
  if (typeof op.id !== "string" || !op.id || op.id.length > 200) {
    throw new HttpError(400, "Ungültige ID")
  }

  // Template rows are nobody's edit, so they stay out of the activity feed.
  if (op.op === "seed") {
    return {
      sql: `INSERT OR IGNORE INTO items (collection, id, data, updated_at, rev)
            VALUES (?, ?, ?, ?, ${REV})`,
      args: [op.collection, op.id, JSON.stringify(op.data ?? null), ts],
    }
  }

  // A delete keeps the last data so the row can be restored from the trash.
  if (op.op === "del") {
    return {
      sql: `INSERT INTO items (collection, id, data, updated_at, deleted, rev, changed_by, changed_at)
            VALUES (?, ?, 'null', ?, 1, ${REV}, ?, ?)
            ON CONFLICT (collection, id) DO UPDATE SET
              deleted = 1, updated_at = excluded.updated_at,
              rev = excluded.rev, changed_by = excluded.changed_by, changed_at = excluded.changed_at
            WHERE excluded.updated_at >= items.updated_at`,
      args: [op.collection, op.id, ts, by, now],
    }
  }

  if (op.op === "put") {
    return {
      sql: `INSERT INTO items (collection, id, data, updated_at, deleted, rev, changed_by, changed_at)
            VALUES (?, ?, ?, ?, 0, ${REV}, ?, ?)
            ON CONFLICT (collection, id) DO UPDATE SET
              data = excluded.data, updated_at = excluded.updated_at, deleted = 0,
              rev = excluded.rev, changed_by = excluded.changed_by, changed_at = excluded.changed_at
            WHERE excluded.updated_at >= items.updated_at`,
      args: [op.collection, op.id, JSON.stringify(op.data ?? null), ts, by, now],
    }
  }

  throw new HttpError(400, `Unbekannte Operation: ${op.op}`)
}

export const POST = handle(async (request) => {
  requireAuth(request)
  const { ops, by } = await readJson(request)
  if (!Array.isArray(ops) || ops.length > MAX_OPS) {
    throw new HttpError(400, "ops muss ein Array mit höchstens 2000 Einträgen sein")
  }
  const author = typeof by === "string" && by.trim() ? by.trim().slice(0, 40) : null
  const now = Date.now()
  const statements = ops.map((op) => toStatement(op, author, now))
  if (statements.length) {
    const c = await db()
    // A write batch runs as one transaction, so the bump and the rows that
    // read it stay consistent even with several organisers syncing at once.
    await c.batch(["UPDATE sync_rev SET v = v + 1 WHERE id = 1", ...statements], "write")
  }
  return json({ ok: true, applied: statements.length })
})
