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

// Conflicts are decided by server revisions, never by device clocks. Each op
// names the row revision it was based on (`base`); it only lands if nobody
// changed the row since, or if this same batch wrote it (seed, then edit).
// Otherwise it is rejected and the client gets the server row back.
// Ops without `base` (pages cached before this change) overwrite.
const WINS = (table, baseArg) =>
  baseArg === null ? "1" : `(${table}.rev <= ${baseArg} OR ${table}.rev = excluded.rev)`

function baseOf(op) {
  if (op.base === undefined || op.base === null) {
    return null
  }
  const base = Number(op.base)
  if (!Number.isInteger(base) || base < 0) {
    throw new HttpError(400, "Ungültige Basisrevision")
  }
  return base
}

const TARGETS = {
  answers: {
    table: "answers",
    key: (d) => [d.team_id, d.round_id, d.question],
    where: "team_id = ? AND round_id = ? AND question = ?",
    valid: (d) => d.team_id && d.round_id && Number.isInteger(d.question),
    error: "Ungültige Antwort",
    columns: ["answer", "points"],
    conflict: "team_id, round_id, question",
    read: "SELECT team_id, round_id, question, answer, points, rev FROM answers",
  },
  solutions: {
    table: "solutions",
    key: (d) => [d.round_id, d.question],
    where: "round_id = ? AND question = ?",
    valid: (d) => d.round_id && Number.isInteger(d.question),
    error: "Ungültige Lösung",
    columns: ["solution"],
    conflict: "round_id, question",
    read: "SELECT round_id, question, solution, rev FROM solutions",
  },
}

function rowStatement(op, by, now) {
  const t = TARGETS[op.collection]
  const d = op.data ?? {}
  if (!t.valid(d)) {
    throw new HttpError(400, t.error)
  }
  const keyCols = t.conflict.split(", ")
  const cols = [...keyCols, ...t.columns]
  const values = [...t.key(d), ...t.columns.map((c) => d[c] ?? null)]
  const read = { sql: `${t.read} WHERE ${t.where}`, args: t.key(d) }

  if (op.op === "seed") {
    return {
      write: {
        sql: `INSERT OR IGNORE INTO ${t.table} (${cols.join(", ")}, updated_at, rev, changed_by, changed_at)
              VALUES (${cols.map(() => "?").join(", ")}, ?, ${REV}, ?, ?)`,
        args: [...values, now, by, now],
      },
      read,
    }
  }
  if (op.op !== "put") {
    throw new HttpError(400, `Unbekannte Operation: ${op.op}`)
  }
  const base = baseOf(op)
  return {
    write: {
      sql: `INSERT INTO ${t.table} (${cols.join(", ")}, updated_at, rev, changed_by, changed_at)
            VALUES (${cols.map(() => "?").join(", ")}, ?, ${REV}, ?, ?)
            ON CONFLICT (${t.conflict}) DO UPDATE SET
              ${t.columns.map((c) => `${c} = excluded.${c}`).join(", ")},
              updated_at = excluded.updated_at, rev = excluded.rev,
              changed_by = excluded.changed_by, changed_at = excluded.changed_at
            WHERE ${WINS(t.table, base === null ? null : "?")}`,
      args: [...values, now, by, now, ...(base === null ? [] : [base])],
    },
    read,
  }
}

function itemStatement(op, by, now) {
  if (!ITEM_COLLECTIONS.has(op.collection)) {
    throw new HttpError(400, `Unbekannte Sammlung: ${op.collection}`)
  }
  if (typeof op.id !== "string" || !op.id || op.id.length > 200) {
    throw new HttpError(400, "Ungültige ID")
  }
  const read = {
    sql: "SELECT collection, id, data, deleted, rev FROM items WHERE collection = ? AND id = ?",
    args: [op.collection, op.id],
  }

  // Template rows are nobody's edit, so they stay out of the activity feed.
  if (op.op === "seed") {
    return {
      write: {
        sql: `INSERT OR IGNORE INTO items (collection, id, data, updated_at, rev) VALUES (?, ?, ?, ?, ${REV})`,
        args: [op.collection, op.id, JSON.stringify(op.data ?? null), now],
      },
      read,
    }
  }

  const base = baseOf(op)
  const guard = base === null ? [] : [base]
  // A delete keeps the last data so the row can be restored from the trash.
  if (op.op === "del") {
    return {
      write: {
        sql: `INSERT INTO items (collection, id, data, updated_at, deleted, rev, changed_by, changed_at)
              VALUES (?, ?, 'null', ?, 1, ${REV}, ?, ?)
              ON CONFLICT (collection, id) DO UPDATE SET
                deleted = 1, updated_at = excluded.updated_at, rev = excluded.rev,
                changed_by = excluded.changed_by, changed_at = excluded.changed_at
              WHERE ${WINS("items", base === null ? null : "?")}`,
        args: [op.collection, op.id, now, by, now, ...guard],
      },
      read,
    }
  }
  if (op.op === "put") {
    return {
      write: {
        sql: `INSERT INTO items (collection, id, data, updated_at, deleted, rev, changed_by, changed_at)
              VALUES (?, ?, ?, ?, 0, ${REV}, ?, ?)
              ON CONFLICT (collection, id) DO UPDATE SET
                data = excluded.data, updated_at = excluded.updated_at, deleted = 0, rev = excluded.rev,
                changed_by = excluded.changed_by, changed_at = excluded.changed_at
              WHERE ${WINS("items", base === null ? null : "?")}`,
        args: [op.collection, op.id, JSON.stringify(op.data ?? null), now, by, now, ...guard],
      },
      read,
    }
  }
  throw new HttpError(400, `Unbekannte Operation: ${op.op}`)
}

function toStatements(op, by, now) {
  if (typeof op !== "object" || op === null || Array.isArray(op)) {
    throw new HttpError(400, "Ungültige Operation")
  }
  return TARGETS[op.collection] ? rowStatement(op, by, now) : itemStatement(op, by, now)
}

function serverRow(collection, r) {
  if (!r) {
    return null
  }
  if (collection === "answers") {
    return { team_id: r.team_id, round_id: r.round_id, question: Number(r.question), answer: r.answer, points: r.points == null ? null : Number(r.points), rev: Number(r.rev) }
  }
  if (collection === "solutions") {
    return { round_id: r.round_id, question: Number(r.question), solution: r.solution, rev: Number(r.rev) }
  }
  const deleted = Number(r.deleted) === 1
  return { collection: r.collection, id: r.id, data: deleted ? null : JSON.parse(r.data), deleted, rev: Number(r.rev) }
}

export const POST = handle(async (request) => {
  requireAuth(request)
  const { ops, by } = await readJson(request)
  if (!Array.isArray(ops) || ops.length > MAX_OPS) {
    throw new HttpError(400, "ops muss ein Array mit höchstens 2000 Einträgen sein")
  }
  const author = typeof by === "string" && by.trim() ? by.trim().slice(0, 40) : null
  const now = Date.now()
  const prepared = ops.map((op) => toStatements(op, author, now))
  if (!prepared.length) {
    return json({ ok: true, applied: 0, rejected: 0, results: [] })
  }

  const c = await db()
  // One transaction: bump the revision, write, then read back every touched
  // row. A row carrying this batch's revision was written by this batch.
  const out = await c.batch(
    [
      "UPDATE sync_rev SET v = v + 1 WHERE id = 1",
      ...prepared.map((p) => p.write),
      "SELECT v FROM sync_rev WHERE id = 1",
      ...prepared.map((p) => p.read),
    ],
    "write",
  )
  const rev = Number(out[prepared.length + 1].rows[0].v)
  const reads = out.slice(prepared.length + 2)

  const results = ops.map((op, i) => {
    const row = serverRow(op.collection, reads[i].rows[0])
    const written = row && row.rev === rev
    const status = written ? "applied" : op.op === "seed" ? "ignored" : "rejected"
    return { collection: op.collection, id: op.id ?? null, status, rev: row ? row.rev : 0, ...(status === "rejected" ? { row } : {}) }
  })
  const applied = results.filter((r) => r.status === "applied").length
  const rejected = results.filter((r) => r.status === "rejected").length
  return json({ ok: true, rev, applied, rejected, results })
})
