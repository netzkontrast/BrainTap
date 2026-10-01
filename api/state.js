import { currentRev, db, handle, json, requireAuth } from "./_lib.js"

// Without `since`: the full live state. With `since=N`: every row changed
// after revision N, deleted items included so clients can drop them.
export const GET = handle(async (request) => {
  requireAuth(request)
  const since = Number(new URL(request.url).searchParams.get("since"))
  const delta = Number.isInteger(since) && since > 0
  const c = await db()
  const [items, answers, solutions, rev] = await c.batch(
    delta
      ? [
          { sql: "SELECT collection, id, data, updated_at, deleted FROM items WHERE rev > ?", args: [since] },
          { sql: "SELECT team_id, round_id, question, answer, points, updated_at FROM answers WHERE rev > ?", args: [since] },
          { sql: "SELECT round_id, question, solution, updated_at FROM solutions WHERE rev > ?", args: [since] },
          "SELECT v FROM sync_rev WHERE id = 1",
        ]
      : [
          "SELECT collection, id, data, updated_at, deleted FROM items WHERE deleted = 0",
          "SELECT team_id, round_id, question, answer, points, updated_at FROM answers",
          "SELECT round_id, question, solution, updated_at FROM solutions",
          "SELECT v FROM sync_rev WHERE id = 1",
        ],
    "read",
  )

  return json({
    serverTime: Date.now(),
    delta,
    rev: Number(rev.rows[0]?.v ?? (await currentRev(c))),
    items: items.rows.map((r) => ({
      collection: r.collection,
      id: r.id,
      data: Number(r.deleted) ? null : JSON.parse(r.data),
      deleted: Number(r.deleted) === 1,
      ts: Number(r.updated_at),
    })),
    answers: answers.rows.map((r) => ({
      team_id: r.team_id,
      round_id: r.round_id,
      question: Number(r.question),
      answer: r.answer,
      points: r.points == null ? null : Number(r.points),
      ts: Number(r.updated_at),
    })),
    solutions: solutions.rows.map((r) => ({
      round_id: r.round_id,
      question: Number(r.question),
      solution: r.solution,
      ts: Number(r.updated_at),
    })),
  })
})
