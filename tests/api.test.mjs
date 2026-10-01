import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, describe, test } from "node:test"

const dir = mkdtempSync(join(tmpdir(), "braintap-"))
process.env.TURSO_DATABASE_URL = `file:${join(dir, "test.db")}`
process.env.ORGA_PASSWORD = "geheim"

const { POST: login } = await import("../api/login.js")
const { GET: state } = await import("../api/state.js")
const { POST: sync } = await import("../api/sync.js")
const { GET: history } = await import("../api/history.js")

const base = "http://localhost"
let cookie = ""

const post = (fn, path, body, headers = {}) =>
  fn(new Request(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, ...headers },
    body: JSON.stringify(body),
  }))
const getState = async (query = "") => {
  const res = await state(new Request(base + "/api/state" + query, { headers: { cookie } }))
  return { status: res.status, body: await res.json() }
}
const getHistory = async (query) => {
  const res = await history(new Request(base + "/api/history" + query, { headers: { cookie } }))
  return res.json()
}

before(async () => {
  const res = await post(login, "/api/login", { password: "geheim" })
  assert.equal(res.status, 200)
  cookie = res.headers.get("set-cookie").split(";")[0]
})
after(() => rmSync(dir, { recursive: true, force: true }))

describe("auth", () => {
  test("wrong password is rejected", async () => {
    const res = await post(login, "/api/login", { password: "falsch" })
    assert.equal(res.status, 401)
  })

  test("state and sync require the session cookie", async () => {
    const s = await state(new Request(base + "/api/state"))
    assert.equal(s.status, 401)
    const w = await sync(new Request(base + "/api/sync", {
      method: "POST", body: JSON.stringify({ ops: [] }),
    }))
    assert.equal(w.status, 401)
  })

  test("a forged cookie is rejected", async () => {
    const s = await state(new Request(base + "/api/state", { headers: { cookie: "bt_auth=abc" } }))
    assert.equal(s.status, 401)
  })
})

describe("sync", () => {
  test("put, read back, newer wins, older is ignored", async () => {
    let res = await post(sync, "/api/sync", { ops: [
      { op: "put", collection: "tasks", id: "t1", data: { text: "A" }, ts: 100 },
    ] })
    assert.equal(res.status, 200)
    await post(sync, "/api/sync", { ops: [
      { op: "put", collection: "tasks", id: "t1", data: { text: "B" }, ts: 200 },
      { op: "put", collection: "tasks", id: "t1", data: { text: "stale" }, ts: 150 },
    ] })
    const { body } = await getState()
    const t1 = body.items.find((i) => i.collection === "tasks" && i.id === "t1")
    assert.deepEqual(t1.data, { text: "B" })
    assert.equal(t1.ts, 200)
  })

  test("seed does not overwrite existing rows", async () => {
    await post(sync, "/api/sync", { ops: [
      { op: "seed", collection: "tasks", id: "t1", data: { text: "default" }, ts: 999 },
      { op: "seed", collection: "tasks", id: "t2", data: { text: "default 2" }, ts: 999 },
    ] })
    const { body } = await getState()
    assert.equal(body.items.find((i) => i.id === "t1").data.text, "B")
    assert.equal(body.items.find((i) => i.id === "t2").data.text, "default 2")
  })

  test("delete hides a row; an older put does not resurrect it", async () => {
    await post(sync, "/api/sync", { ops: [{ op: "del", collection: "tasks", id: "t2", ts: 1000 }] })
    await post(sync, "/api/sync", { ops: [
      { op: "put", collection: "tasks", id: "t2", data: { text: "zombie" }, ts: 500 },
    ] })
    const { body } = await getState()
    assert.equal(body.items.some((i) => i.id === "t2"), false)
  })

  test("answers and solutions use their own tables", async () => {
    await post(sync, "/api/sync", { ops: [
      { op: "put", collection: "answers", data: { team_id: "a", round_id: "r1", question: 1, answer: "Rhein", points: 1 }, ts: 10 },
      { op: "put", collection: "answers", data: { team_id: "a", round_id: "r1", question: 1, answer: "Rhein", points: 0.5 }, ts: 20 },
      { op: "put", collection: "solutions", data: { round_id: "r1", question: 1, solution: "Rhein" }, ts: 10 },
    ] })
    const { body } = await getState()
    assert.deepEqual(
      body.answers.map(({ ts, ...a }) => a),
      [{ team_id: "a", round_id: "r1", question: 1, answer: "Rhein", points: 0.5 }],
    )
    assert.equal(body.solutions[0].solution, "Rhein")
  })

  test("questions are a stored collection", async () => {
    const q = { id: "q1", round: "r03", text: "Wie hoch ist der Dom?", mc: true, options: ["157 m", "120 m"], correct: 0, status: "fertig" }
    const res = await post(sync, "/api/sync", { ops: [{ op: "put", collection: "questions", id: "q1", data: q, ts: 5 }] })
    assert.equal(res.status, 200)
    const { body } = await getState()
    assert.deepEqual(body.items.find((i) => i.collection === "questions").data, q)
  })

  test("invalid ops reject the whole batch", async () => {
    const res = await post(sync, "/api/sync", { ops: [
      { op: "put", collection: "tasks", id: "t3", data: {}, ts: 1 },
      { op: "put", collection: "nope", id: "x", data: {}, ts: 1 },
    ] })
    assert.equal(res.status, 400)
    const { body } = await getState()
    assert.equal(body.items.some((i) => i.id === "t3"), false)
  })
})

describe("revisions, authors and history", () => {
  test("since returns only rows changed after that revision, tombstones included", async () => {
    const { body: before } = await getState()
    await post(sync, "/api/sync", { by: "Anna", ops: [
      { op: "put", collection: "decisions", id: "d1", data: { text: "Beamer?" }, ts: 3000 },
      { op: "del", collection: "tasks", id: "t1", ts: 3000 },
    ] })
    const { body: delta } = await getState("?since=" + before.rev)
    assert.equal(delta.delta, true)
    assert.equal(delta.rev, before.rev + 1)
    assert.deepEqual(delta.items.map((i) => [i.collection, i.id, i.deleted]).sort(), [["decisions", "d1", false], ["tasks", "t1", true]])
    const { body: none } = await getState("?since=" + delta.rev)
    assert.equal(none.items.length + none.answers.length + none.solutions.length, 0)
  })

  test("a stale write does not bump the row's revision", async () => {
    const { body: before } = await getState()
    await post(sync, "/api/sync", { ops: [{ op: "put", collection: "decisions", id: "d1", data: { text: "alt" }, ts: 10 }] })
    const { body: delta } = await getState("?since=" + before.rev)
    assert.equal(delta.items.length, 0)
  })

  test("activity lists changes with author, newest first", async () => {
    await post(sync, "/api/sync", { by: "  Ben  ", ops: [{ op: "put", collection: "rounds", id: "r9", data: { name: "Finale" }, ts: 4000 }] })
    const { activity } = await getHistory("?view=activity&limit=5")
    assert.equal(activity[0].collection, "rounds")
    assert.equal(activity[0].by, "Ben")
    assert.ok(activity.some((a) => a.collection === "decisions" && a.by === "Anna"))
    assert.ok(activity.every((a, i) => i === 0 || activity[i - 1].at >= a.at))
  })

  test("trash keeps deleted data for restore", async () => {
    const { trash } = await getHistory("?view=trash")
    const t1 = trash.find((t) => t.collection === "tasks" && t.id === "t1")
    assert.deepEqual(t1.data, { text: "B" })
    assert.equal(t1.by, "Anna")
    await post(sync, "/api/sync", { ops: [{ op: "put", collection: "tasks", id: "t1", data: t1.data, ts: 5000 }] })
    const { body } = await getState()
    assert.ok(body.items.some((i) => i.collection === "tasks" && i.id === "t1"))
    const { trash: after } = await getHistory("?view=trash")
    assert.equal(after.some((t) => t.id === "t1"), false)
  })

  test("seeded template rows are not attributed to anyone", async () => {
    await post(sync, "/api/sync", { by: "Anna", ops: [{ op: "seed", collection: "tech", id: "x99", data: { text: "Kabel" }, ts: 6000 }] })
    const { activity } = await getHistory("?view=activity&limit=200")
    assert.equal(activity.some((a) => a.id === "x99"), false)
    const { body } = await getState()
    assert.ok(body.items.some((i) => i.id === "x99"))
  })

  test("history requires login", async () => {
    const res = await history(new Request(base + "/api/history"))
    assert.equal(res.status, 401)
  })
})
