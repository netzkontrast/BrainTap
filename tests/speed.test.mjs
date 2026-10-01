import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, describe, test } from "node:test"

const dir = mkdtempSync(join(tmpdir(), "braintap-speed-"))
process.env.TURSO_DATABASE_URL = `file:${join(dir, "speed.db")}`
process.env.ORGA_PASSWORD = "geheim"

if (process.env.BACKEND === "snapshot") {
  const { useClientForTests } = await import("../api/_lib.js")
  const { createSnapshotClient } = await import("../api/_snapshot.js")
  const { memoryStorage } = await import("./memory-storage.mjs")
  useClientForTests(createSnapshotClient(memoryStorage()))
}

const { POST: login } = await import("../api/login.js")
const { POST: sync } = await import("../api/sync.js")
const { GET: state } = await import("../api/state.js")
const { GET: speedGet, POST: speedPost } = await import("../api/speed.js")
const { teamCode } = await import("../api/_lib.js")

const base = "http://localhost"
let orga = ""

const req = (path, { cookie = "", body } = {}) =>
  new Request(base + path, body === undefined
    ? { headers: { cookie } }
    : { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) })
const orgaDo = async (body) => {
  const res = await speedPost(req("/api/speed", { cookie: orga, body }))
  return { status: res.status, body: await res.json() }
}
const teamGet = async (cookie) => {
  const res = await speedGet(req("/api/speed", { cookie }))
  return { status: res.status, body: await res.json() }
}
const teamDo = async (cookie, body) => {
  const res = await speedPost(req("/api/speed", { cookie, body }))
  return { status: res.status, body: await res.json() }
}
async function joinAs(teamId) {
  const res = await speedPost(req("/api/speed", { body: { action: "join", code: teamCode(teamId).toLowerCase() } }))
  assert.equal(res.status, 200)
  return res.headers.get("set-cookie").split(";")[0]
}

const MC = { kind: "mc", text: "Welcher Fluss fließt durch Köln?", options: ["Main", "Rhein", "Elbe", "Mosel"] }

before(async () => {
  const res = await login(req("/api/login", { body: { password: "geheim" } }))
  orga = res.headers.get("set-cookie").split(";")[0]
  const ops = [
    { op: "put", collection: "teams", id: "t1", base: 0, data: { id: "t1", pos: 1, name: "Die Kölschen" } },
    { op: "put", collection: "teams", id: "t2", base: 0, data: { id: "t2", pos: 2, name: "Bonner Bande" } },
  ]
  const s = await sync(req("/api/sync", { cookie: orga, body: { ops, by: "Test" } }))
  assert.equal(s.status, 200)
})
after(() => rmSync(dir, { recursive: true, force: true }))

describe("speed round", () => {
  test("a wrong code is rejected and a right one signs the device in as that team", async () => {
    const bad = await speedPost(req("/api/speed", { body: { action: "join", code: "ZZZZZ" } }))
    assert.equal(bad.status, 404)
    const cookie = await joinAs("t1")
    const view = await teamGet(cookie)
    assert.equal(view.status, 200)
    assert.equal(view.body.team.name, "Die Kölschen")
    assert.equal(view.body.state.status, "off")
  })

  test("a team device is no organiser: planning data and orga actions stay closed", async () => {
    const cookie = await joinAs("t1")
    const forged = cookie.replace("bt_team=", "bt_auth=")
    assert.equal((await state(req("/api/state", { cookie: forged }))).status, 401)
    assert.equal((await state(req("/api/state", { cookie }))).status, 401)
    assert.equal((await speedGet(req("/api/speed?view=orga", { cookie }))).status, 401)
    assert.equal((await teamDo(cookie, { action: "open", roundId: "r1" })).status, 401)
  })

  test("teams see the open question without its solution and multiple choice is scored", async () => {
    const t1 = await joinAs("t1")
    const t2 = await joinAs("t2")
    assert.equal((await orgaDo({ action: "open", roundId: "r1", roundName: "Speed", of: 3 })).status, 200)
    const early = await teamDo(t1, { action: "answer", n: 1, choice: 1 })
    assert.equal(early.status, 409, "no answers before a question is shown")

    const shown = await orgaDo({ action: "show", n: 1, secs: 20, question: MC, solution: { correct: 1, text: "" } })
    assert.equal(shown.status, 200)
    const view = await teamGet(t1)
    assert.equal(view.body.state.status, "question")
    assert.deepEqual(view.body.state.question.options, MC.options)
    assert.equal(JSON.stringify(view.body).includes("correct"), false, "the solution never reaches a team")
    assert.equal(view.body.state.solution, null)

    assert.equal((await teamDo(t1, { action: "answer", n: 1, choice: 1 })).status, 200)
    assert.equal((await teamDo(t2, { action: "answer", n: 1, choice: 0 })).status, 200)
    assert.equal((await teamDo(t2, { action: "answer", n: 1, choice: 2 })).status, 200, "an answer can change until time is up")

    const o = await orgaDo({ action: "close" })
    assert.equal(o.body.state.status, "closed")
    assert.equal((await teamDo(t1, { action: "answer", n: 1, choice: 0 })).status, 409, "closed means closed")
    const pts = Object.fromEntries(o.body.answers.map((a) => [a.team_id, a]))
    assert.equal(pts.t1.points, 1)
    assert.equal(pts.t1.answer, "B) Rhein")
    assert.equal(pts.t2.points, 0)
    assert.equal(pts.t2.answer, "C) Elbe")

    await orgaDo({ action: "reveal" })
    const after = await teamGet(t1)
    assert.equal(after.body.state.solution, "B) Rhein")
    assert.deepEqual(after.body.mine, { answer: "B) Rhein", points: 1 })
  })

  test("speed answers reach the regular answers table and the organisers' delta sync", async () => {
    const before = (await (await state(req("/api/state", { cookie: orga }))).json()).rev
    const t1 = await joinAs("t1")
    await orgaDo({ action: "show", n: 2, secs: 20, question: { kind: "text", text: "Hauptstadt von NRW?" }, solution: { text: "Düsseldorf" } })
    await teamDo(t1, { action: "answer", n: 2, answer: "  dusseldorf " })
    const delta = await (await state(req(`/api/state?since=${before}`, { cookie: orga }))).json()
    const row = delta.answers.find((a) => a.team_id === "t1" && a.question === 2)
    assert.ok(row, "the answer arrives with a new revision")
    assert.equal(row.round_id, "r1")
    assert.equal(row.points, 1, "free text matches regardless of case, spaces and umlauts")
  })

  test("free text that does not match stays for an organiser to judge, who can override", async () => {
    const t2 = await joinAs("t2")
    await teamDo(t2, { action: "answer", n: 2, answer: "Köln" })
    let o = await orgaDo({ action: "close" })
    assert.equal(o.body.answers.find((a) => a.team_id === "t2" && a.question === 2).points, null)
    o = await orgaDo({ action: "score", teamId: "t2", n: 2, points: 0.5 })
    const row = o.body.answers.find((a) => a.team_id === "t2" && a.question === 2)
    assert.equal(row.points, 0.5)
    assert.equal(row.answer, "Köln", "overriding points keeps the answer")
  })

  test("the orga view lists codes and joined devices; ending clears the question", async () => {
    const o = await orgaDo({ action: "end" })
    assert.equal(o.body.state.status, "done")
    assert.deepEqual(o.body.teams.map((t) => t.code), [teamCode("t1"), teamCode("t2")])
    assert.ok(o.body.joins.t1 && o.body.joins.t2)
    const view = await teamGet(await joinAs("t1"))
    assert.equal(view.body.state.question, null)
  })

  test("answers after the deadline are rejected", async () => {
    const t1 = await joinAs("t1")
    await orgaDo({ action: "open", roundId: "r2", roundName: "Speed 2", of: 1 })
    await orgaDo({ action: "show", n: 1, secs: 3, question: MC, solution: { correct: 1 } })
    await new Promise((r) => setTimeout(r, 4600))
    const view = await teamGet(t1)
    assert.equal(view.body.state.status, "closed", "the question closes by the server clock")
    assert.equal((await teamDo(t1, { action: "answer", n: 1, choice: 1 })).status, 409)
  })

  test("ten teams answering in the same moment all land", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => "c" + i)
    const ops = ids.map((id, i) => ({ op: "put", collection: "teams", id, base: 0, data: { id, pos: 10 + i, name: "Team " + i } }))
    assert.equal((await sync(req("/api/sync", { cookie: orga, body: { ops, by: "Test" } }))).status, 200)
    const cookies = []
    for (const id of ids) cookies.push(await joinAs(id))
    await orgaDo({ action: "open", roundId: "r3", roundName: "Ansturm", of: 1 })
    await orgaDo({ action: "show", n: 1, secs: 30, question: MC, solution: { correct: 1 } })
    const res = await Promise.all(cookies.map((c, i) => teamDo(c, { action: "answer", n: 1, choice: i % 4 })))
    assert.deepEqual(res.map((r) => r.status), ids.map(() => 200))
    const o = await orgaDo({ action: "close" })
    const got = o.body.answers.filter((a) => ids.includes(a.team_id))
    assert.equal(got.length, 10)
    assert.equal(got.filter((a) => a.points === 1).length, 3, "teams 1, 5 and 9 chose B")
  })

  test("orga actions require a login and validate input", async () => {
    const res = await speedPost(req("/api/speed", { body: { action: "open", roundId: "r1" } }))
    assert.equal(res.status, 401)
    assert.equal((await orgaDo({ action: "show", n: 1, secs: 10, question: { kind: "mc", text: "x", options: ["nur eine"] } })).status, 400)
    assert.equal((await orgaDo({ action: "kaputt" })).status, 400)
  })
})
