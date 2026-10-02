import {
  cookie,
  db,
  demoMode,
  handle,
  HttpError,
  json,
  readJson,
  requireAuth,
  session,
  TEAM_COOKIE,
  TEAM_MAX_AGE,
  teamCode,
  teamSession,
  teamToken,
} from "./_lib.js"

// Digital speed round without WebSockets: the organisers drive the game state
// here, the team devices (speed.html) poll it. The server clock decides when a
// question opens and closes; answers land in the regular answers table, so the
// scoreboard picks them up like any paper round.

const GRACE_MS = 1500 // network latency of the last-second answer
const LETTERS = "ABCDEF"
const REV = "(SELECT v FROM sync_rev WHERE id = 1)"

function normalize(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

// What a question looks like once it is open: the status reported to teams
// turns from "question" to "closed" as soon as the time is up, no write needed.
function effectiveStatus(st, now) {
  if (!st) return "off"
  return st.status === "question" && now > st.endsAt ? "closed" : st.status
}

function solutionText(question, solution) {
  if (!solution) return ""
  if (question?.kind === "mc" && Number.isInteger(solution.correct)) {
    const opt = question.options?.[solution.correct]
    return opt ? `${LETTERS[solution.correct]}) ${opt}` : ""
  }
  return solution.text ?? ""
}

function publicState(st, solution, now) {
  const status = effectiveStatus(st, now)
  if (status === "off") return { status }
  const showsQuestion = status === "question" || status === "closed" || status === "reveal"
  return {
    status,
    roundId: st.roundId,
    roundName: st.roundName,
    n: st.n,
    of: st.of,
    secs: st.secs,
    endsAt: st.endsAt,
    question: showsQuestion ? st.question : null,
    solution: status === "reveal" ? solutionText(st.question, solution) : null,
    scoring: st.scoring ?? { points: 1, tempo: false },
  }
}

// Whether an answer is right (true), wrong (false) or needs an organiser
// (null): free text that does not match exactly, and estimates, which are
// ranked later.
function verdict(question, solution, entry) {
  if (!solution) return null
  if (question.kind === "mc") return entry.choice === solution.correct
  if (question.kind === "text" && solution.text) return normalize(entry.answer) === normalize(solution.text) ? true : null
  return null
}

// Scoring of the running round: `points` for a right answer; with tempo on,
// a right answer earns between half and all of it, depending on how much of
// the time was left (rounded to tenths).
function scoring(body, fallback = { points: 1, tempo: false }) {
  const points = Number(body.points)
  return {
    points: Number.isFinite(points) && points > 0 && points <= 100 ? points : fallback.points,
    tempo: typeof body.tempo === "boolean" ? body.tempo : fallback.tempo,
  }
}

function pointsFor(right, ms, st) {
  if (right == null) return null
  if (!right) return 0
  const { points, tempo } = st.scoring ?? { points: 1, tempo: false }
  if (!tempo || ms == null || !st.secs) return points
  const left = Math.min(1, Math.max(0, 1 - ms / (st.secs * 1000)))
  return Math.round(points * (0.5 + 0.5 * left) * 10) / 10
}

async function readGame(c, extra = []) {
  const out = await c.batch(
    ["SELECT data FROM speed WHERE key = 'state'", "SELECT data FROM speed WHERE key = 'solution'", ...extra],
    "read",
  )
  const parse = (r) => (r.rows[0] ? JSON.parse(r.rows[0].data) : null)
  return { st: parse(out[0]), solution: parse(out[1]), rest: out.slice(2) }
}

function teamList(rows) {
  return rows
    .map((row) => ({ ...JSON.parse(row.data), id: row.id }))
    .sort((a, b) => (Number(a.pos) || 0) - (Number(b.pos) || 0))
    .map((t) => ({ id: t.id, name: t.name || "Team" }))
}

async function teams(c) {
  const r = await c.execute("SELECT id, data FROM items WHERE collection = 'teams' AND deleted = 0")
  return teamList(r.rows)
}

const asString = (v, max) => (typeof v === "string" ? v.slice(0, max) : "")

/* ---------- Organisers ---------- */

const ROUND_OF_GAME = "(SELECT json_extract(data, '$.roundId') FROM speed WHERE key = 'state')"

async function orgaView(c, now) {
  // One read batch, so a poll costs a single snapshot download.
  const { st, solution, rest } = await readGame(c, [
    "SELECT id, data FROM items WHERE collection = 'teams' AND deleted = 0",
    "SELECT team_id, joined_at FROM speed_joins",
    `SELECT a.team_id, a.question, a.answer, a.points, t.ms FROM answers a
     LEFT JOIN speed_times t ON t.round_id = a.round_id AND t.question = a.question AND t.team_id = a.team_id
     WHERE a.round_id = ${ROUND_OF_GAME}`,
  ])
  const [teamRows, joins, answers] = rest
  return {
    serverTime: now,
    state: st ? { ...st, status: effectiveStatus(st, now) } : { status: "off" },
    solution: st ? solutionText(st.question, solution) : "",
    teams: teamList(teamRows.rows).map((t) => ({ ...t, code: teamCode(t.id) })),
    joins: Object.fromEntries(joins.rows.map((r) => [r.team_id, Number(r.joined_at)])),
    answers: answers.rows.map((r) => ({
      team_id: r.team_id,
      question: Number(r.question),
      answer: r.answer,
      points: r.points == null ? null : Number(r.points),
      ms: r.ms == null ? null : Number(r.ms),
    })),
  }
}

function validQuestion(q) {
  const kind = ["mc", "text", "estimate"].includes(q?.kind) ? q.kind : null
  if (!kind) throw new HttpError(400, "Ungültiger Fragetyp")
  const options = kind === "mc" && Array.isArray(q.options) ? q.options.slice(0, LETTERS.length).map((o) => asString(o, 300)) : undefined
  if (kind === "mc" && (!options || options.filter(Boolean).length < 2)) throw new HttpError(400, "Multiple Choice braucht mindestens zwei Optionen")
  return { kind, text: asString(q.text, 2000), media: asString(q.media, 500) || undefined, options }
}

async function orgaAction(c, body, now) {
  const { st } = await readGame(c)
  const save = (data) => ({ sql: "INSERT INTO speed (key, data) VALUES ('state', ?) ON CONFLICT (key) DO UPDATE SET data = excluded.data", args: [JSON.stringify(data)] })
  const saveSolution = (data) => ({ sql: "INSERT INTO speed (key, data) VALUES ('solution', ?) ON CONFLICT (key) DO UPDATE SET data = excluded.data", args: [JSON.stringify(data)] })

  switch (body.action) {
    case "open": {
      const roundId = asString(body.roundId, 200)
      if (!roundId) throw new HttpError(400, "Runde fehlt")
      const of = Math.max(1, Math.min(100, Number(body.of) || 1))
      await c.batch([save({ roundId, roundName: asString(body.roundName, 200), status: "lobby", n: 0, of, secs: 0, endsAt: 0, question: null, scoring: scoring(body) }), saveSolution(null)], "write")
      return
    }
    case "show": {
      if (!st) throw new HttpError(409, "Erst die Speed-Runde öffnen")
      const n = Number(body.n)
      if (!Number.isInteger(n) || n < 1 || n > st.of) throw new HttpError(400, "Ungültige Fragennummer")
      const secs = Math.max(3, Math.min(600, Math.round(Number(body.secs) || 20)))
      const question = validQuestion(body.question)
      const correct = Number.isInteger(body.solution?.correct) ? body.solution.correct : null
      const solution = { correct, text: asString(body.solution?.text, 500) }
      await c.batch([
        save({ ...st, status: "question", n, secs, startedAt: now, endsAt: now + secs * 1000, question, scoring: scoring(body, st.scoring) }),
        saveSolution(solution),
      ], "write")
      return
    }
    case "close":
      if (!st) throw new HttpError(409, "Keine Speed-Runde aktiv")
      await c.batch([save({ ...st, status: st.status === "question" ? "closed" : st.status, endsAt: Math.min(st.endsAt || now, now) })], "write")
      return
    case "reveal":
      if (!st || !st.question) throw new HttpError(409, "Keine Frage zum Auflösen")
      await c.batch([save({ ...st, status: "reveal", endsAt: Math.min(st.endsAt || now, now) })], "write")
      return
    case "end":
      if (!st) throw new HttpError(409, "Keine Speed-Runde aktiv")
      await c.batch([save({ ...st, status: "done", question: null, endsAt: Math.min(st.endsAt || now, now) }), saveSolution(null)], "write")
      return
    case "reset":
      await c.batch(["DELETE FROM speed", "DELETE FROM speed_joins", "DELETE FROM speed_times"], "write")
      return
    case "score": {
      // An organiser judges one team's answer: verdict "right" / "wrong" /
      // "open" scores it like the automatic check (tempo included); a number
      // in `points` sets the points directly.
      if (!st) throw new HttpError(409, "Keine Speed-Runde aktiv")
      const teamId = asString(body.teamId, 200)
      const n = Number(body.n)
      if (!teamId || !Number.isInteger(n)) throw new HttpError(400, "Ungültige Wertung")
      let points
      if (["right", "wrong", "open"].includes(body.verdict)) {
        const t = await c.execute({ sql: "SELECT ms FROM speed_times WHERE round_id = ? AND question = ? AND team_id = ?", args: [st.roundId, n, teamId] })
        const ms = t.rows[0] ? Number(t.rows[0].ms) : null
        points = pointsFor(body.verdict === "open" ? null : body.verdict === "right", ms, st)
      } else {
        points = body.points == null ? null : Number(body.points)
        if (points != null && !Number.isFinite(points)) throw new HttpError(400, "Ungültige Wertung")
      }
      await c.batch([
        "UPDATE sync_rev SET v = v + 1 WHERE id = 1",
        {
          sql: `INSERT INTO answers (team_id, round_id, question, answer, points, updated_at, rev, changed_by, changed_at)
                VALUES (?, ?, ?, NULL, ?, ?, ${REV}, 'Speed-Runde', ?)
                ON CONFLICT (team_id, round_id, question) DO UPDATE SET
                  points = excluded.points, updated_at = excluded.updated_at, rev = excluded.rev,
                  changed_by = excluded.changed_by, changed_at = excluded.changed_at`,
          args: [teamId, st.roundId, n, points, now, now],
        },
      ], "write")
      return
    }
    default:
      throw new HttpError(400, "Unbekannte Aktion")
  }
}

/* ---------- Teams ---------- */

// Every join attempt is counted globally in the database before its code is
// checked, in the same transaction that reads the count back, so guessing in
// parallel or across function instances cannot slip past the limit.
const JOIN_WINDOW_MS = 60_000
const JOIN_MAX_ATTEMPTS = 60

async function join(c, body) {
  const now = Date.now()
  const out = await c.batch([
    {
      sql: `INSERT INTO speed (key, data) VALUES ('joins', json_object('since', ?, 'count', 1))
            ON CONFLICT (key) DO UPDATE SET data = CASE
              WHEN json_extract(data, '$.since') < ? THEN json_object('since', ?, 'count', 1)
              ELSE json_set(data, '$.count', json_extract(data, '$.count') + 1) END`,
      args: [now, now - JOIN_WINDOW_MS, now],
    },
    "SELECT json_extract(data, '$.count') AS n FROM speed WHERE key = 'joins'",
  ], "write")
  if (Number(out[1].rows[0]?.n ?? 0) > JOIN_MAX_ATTEMPTS) {
    throw new HttpError(429, "Zu viele Anmeldeversuche – bitte eine Minute warten")
  }
  const code = String(body.code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "")
  const list = await teams(c)
  // In demo mode a phone simply picks its team from the list.
  const team = demoMode() && typeof body.teamId === "string"
    ? list.find((t) => t.id === body.teamId)
    : code.length === 5 ? list.find((t) => teamCode(t.id) === code) : null
  if (!team) {
    await new Promise((res) => setTimeout(res, 400)) // slows down sequential guessing
    throw new HttpError(404, demoMode() ? "Unbekanntes Team" : "Unbekannter Team-Code")
  }
  await c.batch([{
    sql: "INSERT INTO speed_joins (team_id, joined_at) VALUES (?, ?) ON CONFLICT (team_id) DO UPDATE SET joined_at = excluded.joined_at",
    args: [team.id, Date.now()],
  }], "write")
  return json(
    { ok: true, team },
    { headers: { "set-cookie": cookie(TEAM_COOKIE, teamToken(team.id), { maxAge: TEAM_MAX_AGE }) } },
  )
}

async function teamView(c, teamId, now) {
  const { st, solution, rest } = await readGame(c, [
    { sql: "SELECT data FROM items WHERE collection = 'teams' AND id = ? AND deleted = 0", args: [teamId] },
    {
      sql: `SELECT a.answer, a.points, t.ms FROM answers a
            LEFT JOIN speed_times t ON t.round_id = a.round_id AND t.question = a.question AND t.team_id = a.team_id
            WHERE a.team_id = ? AND a.round_id = ${ROUND_OF_GAME}
            AND a.question = (SELECT json_extract(data, '$.n') FROM speed WHERE key = 'state')`,
      args: [teamId],
    },
    `SELECT i.id AS team_id, COALESCE(SUM(a.points), 0) AS pts FROM items i
     LEFT JOIN answers a ON a.team_id = i.id AND a.round_id = ${ROUND_OF_GAME}
     WHERE i.collection = 'teams' AND i.deleted = 0 GROUP BY i.id`,
  ])
  const [teamRow, mineRow] = rest.map((r) => r.rows[0])
  if (!teamRow) throw new HttpError(401, "Team nicht mehr vorhanden")
  const view = publicState(st, solution, now)
  const revealed = view.status === "reveal" || view.status === "done"
  const mine = mineRow
    ? {
        answer: mineRow.answer,
        points: view.status === "reveal" && mineRow.points != null ? Number(mineRow.points) : null,
        ms: view.status === "reveal" && mineRow.ms != null ? Number(mineRow.ms) : null,
      }
    : null
  // The team's own standing in this round once a question is resolved; the
  // other teams' points stay on the beamer.
  let standing = null
  if (revealed) {
    const totals = rest[2].rows.map((r) => ({ id: r.team_id, pts: Number(r.pts) }))
    const own = totals.find((t) => t.id === teamId)
    if (own) standing = { points: own.pts, rank: 1 + totals.filter((t) => t.pts > own.pts).length, of: totals.length }
  }
  return { serverTime: now, team: { id: teamId, name: JSON.parse(teamRow.data).name || "Team" }, state: view, mine, standing }
}

async function answer(c, teamId, body, now) {
  const { st, solution } = await readGame(c)
  if (effectiveStatus(st, now - GRACE_MS) !== "question" || Number(body.n) !== st.n) {
    throw new HttpError(409, "Zeit abgelaufen")
  }
  const q = st.question
  let entry
  if (q.kind === "mc") {
    const choice = Number(body.choice)
    if (!Number.isInteger(choice) || !q.options?.[choice]) throw new HttpError(400, "Ungültige Auswahl")
    entry = { choice, answer: `${LETTERS[choice]}) ${q.options[choice]}` }
  } else {
    const text = asString(body.answer, 300).trim()
    if (!text) throw new HttpError(400, "Leere Antwort")
    entry = { answer: text }
  }
  const ms = Math.max(0, Math.min(now, st.endsAt) - st.startedAt)
  const points = pointsFor(verdict(q, solution, entry), ms, st)
  await c.batch([
    "UPDATE sync_rev SET v = v + 1 WHERE id = 1",
    {
      sql: `INSERT INTO speed_times (round_id, question, team_id, ms) VALUES (?, ?, ?, ?)
            ON CONFLICT (round_id, question, team_id) DO UPDATE SET ms = excluded.ms`,
      args: [st.roundId, st.n, teamId, ms],
    },
    {
      sql: `INSERT INTO answers (team_id, round_id, question, answer, points, updated_at, rev, changed_by, changed_at)
            VALUES (?, ?, ?, ?, ?, ?, ${REV}, 'Speed-Runde', ?)
            ON CONFLICT (team_id, round_id, question) DO UPDATE SET
              answer = excluded.answer, points = excluded.points, updated_at = excluded.updated_at,
              rev = excluded.rev, changed_by = excluded.changed_by, changed_at = excluded.changed_at`,
      args: [teamId, st.roundId, st.n, entry.answer, points, now, now],
    },
  ], "write")
  return json({ ok: true, answer: entry.answer, ms })
}

/* ---------- Routes ---------- */

export const GET = handle(async (request) => {
  const now = Date.now()
  const c = await db()
  const view = new URL(request.url).searchParams.get("view")
  if (view === "orga") {
    requireAuth(request)
    return json(await orgaView(c, now))
  }
  const team = teamSession(request)
  if (!team && demoMode()) {
    return json({ error: "Team wählen", demo: true, teams: await teams(c) }, { status: 401 })
  }
  if (!team) {
    throw new HttpError(401, session(request) ? "Dieses Gerät ist als Orga angemeldet, nicht als Team" : "Bitte Team-Code eingeben")
  }
  return json(await teamView(c, team.teamId, now))
})

export const POST = handle(async (request) => {
  const now = Date.now()
  const body = await readJson(request)
  const c = await db()
  if (body.action === "join") return join(c, body)
  if (body.action === "leave") {
    return json({ ok: true }, { headers: { "set-cookie": cookie(TEAM_COOKIE, "", { maxAge: 0 }) } })
  }
  if (body.action === "answer") {
    const team = teamSession(request)
    if (!team) throw new HttpError(401, "Bitte Team-Code eingeben")
    return answer(c, team.teamId, body, now)
  }
  requireAuth(request)
  await orgaAction(c, body, now)
  return json(await orgaView(c, now))
})
