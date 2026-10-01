import { db, handle, json, requireAuth } from "./_lib.js"

export const GET = handle(async (request) => {
  requireAuth(request)
  const c = await db()
  const [items, answers, solutions] = await c.batch(
    [
      "SELECT collection, id, data, updated_at FROM items WHERE deleted = 0",
      "SELECT team_id, round_id, question, answer, points, updated_at FROM answers",
      "SELECT round_id, question, solution, updated_at FROM solutions",
    ],
    "read",
  )

  return json({
    serverTime: Date.now(),
    items: items.rows.map((r) => ({
      collection: r.collection,
      id: r.id,
      data: JSON.parse(r.data),
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
