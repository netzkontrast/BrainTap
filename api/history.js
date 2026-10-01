import { db, handle, json, requireAuth } from "./_lib.js"

// view=activity: latest changes across planning items and answers.
// view=trash: deleted planning items that still carry their last data.
export const GET = handle(async (request) => {
  requireAuth(request)
  const params = new URL(request.url).searchParams
  const view = params.get("view") === "trash" ? "trash" : "activity"
  const limit = Math.min(200, Math.max(1, Number(params.get("limit")) || 50))
  const c = await db()

  if (view === "trash") {
    const r = await c.execute({
      sql: `SELECT collection, id, data, changed_by, changed_at, rev FROM items
            WHERE deleted = 1 AND data IS NOT NULL AND data != 'null' AND collection != 'scores'
            ORDER BY changed_at DESC LIMIT ?`,
      args: [limit],
    })
    return json({
      trash: r.rows.map((x) => ({
        collection: x.collection,
        id: x.id,
        data: JSON.parse(x.data),
        by: x.changed_by,
        at: x.changed_at == null ? null : Number(x.changed_at),
        rev: Number(x.rev),
      })),
    })
  }

  const r = await c.execute({
    sql: `SELECT * FROM (
            SELECT collection AS kind, id, data, deleted, changed_by, changed_at FROM items
              WHERE changed_at IS NOT NULL AND collection != 'scores'
            UNION ALL
            SELECT 'answers', team_id || '|' || round_id || '|' || question,
              json_object('team_id', team_id, 'round_id', round_id, 'question', question, 'answer', answer, 'points', points),
              0, changed_by, changed_at FROM answers WHERE changed_at IS NOT NULL
          ) ORDER BY changed_at DESC LIMIT ?`,
    args: [limit],
  })
  return json({
    activity: r.rows.map((x) => ({
      collection: x.kind,
      id: x.id,
      data: x.data == null ? null : JSON.parse(x.data),
      deleted: Number(x.deleted) === 1,
      by: x.changed_by,
      at: Number(x.changed_at),
    })),
  })
})
