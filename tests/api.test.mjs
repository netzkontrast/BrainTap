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

const base = "http://localhost"
let cookie = ""

const post = (fn, path, body, headers = {}) =>
  fn(new Request(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, ...headers },
    body: JSON.stringify(body),
  }))
const getState = async () => {
  const res = await state(new Request(base + "/api/state", { headers: { cookie } }))
  return { status: res.status, body: await res.json() }
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
