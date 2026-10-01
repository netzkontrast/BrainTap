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

const syncOps = async (ops, by) => {
  const res = await post(sync, "/api/sync", { ops, by })
  return { status: res.status, body: await res.json() }
}
const row = async (collection, id) => {
  const { body } = await getState()
  return body.items.find((i) => i.collection === collection && i.id === id)
}

describe("sync", () => {
  test("a write based on the current revision is applied and reports its new revision", async () => {
    const { status, body } = await syncOps([{ op: "put", collection: "tasks", id: "t1", data: { text: "A" }, base: 0 }])
    assert.equal(status, 200)
    assert.equal(body.results[0].status, "applied")
    const r = await row("tasks", "t1")
    assert.deepEqual(r.data, { text: "A" })
    assert.equal(r.rev, body.results[0].rev)
    const next = await syncOps([{ op: "put", collection: "tasks", id: "t1", data: { text: "B" }, base: r.rev }])
    assert.equal(next.body.results[0].status, "applied")
    assert.deepEqual((await row("tasks", "t1")).data, { text: "B" })
  })

  test("a write based on an outdated revision is rejected and returns the server row", async () => {
    const seen = (await row("tasks", "t1")).rev
    await syncOps([{ op: "put", collection: "tasks", id: "t1", data: { text: "remote winner" }, base: seen }])
    const { body } = await syncOps([{ op: "put", collection: "tasks", id: "t1", data: { text: "local stale" }, base: seen }])
    assert.equal(body.results[0].status, "rejected")
    assert.deepEqual(body.results[0].row.data, { text: "remote winner" })
    assert.deepEqual((await row("tasks", "t1")).data, { text: "remote winner" })
  })

  test("device clocks do not decide conflicts", async () => {
    const seen = (await row("tasks", "t1")).rev
    const fast = await syncOps([{ op: "put", collection: "tasks", id: "t1", data: { text: "clock +1h" }, base: seen, ts: Date.now() + 3600000 }])
    assert.equal(fast.body.results[0].status, "applied")
    const later = await syncOps([{ op: "put", collection: "tasks", id: "t1", data: { text: "later, correct clock" }, base: fast.body.results[0].rev, ts: Date.now() }])
    assert.equal(later.body.results[0].status, "applied")
    assert.deepEqual((await row("tasks", "t1")).data, { text: "later, correct clock" })
  })

  test("seed then edit of the same new row in one batch both land", async () => {
    const { body } = await syncOps([
      { op: "seed", collection: "tasks", id: "t5", data: { text: "Vorlage" } },
      { op: "put", collection: "tasks", id: "t5", data: { text: "gleich bearbeitet" }, base: 0 },
    ])
    assert.equal(body.results[1].status, "applied")
    assert.deepEqual((await row("tasks", "t5")).data, { text: "gleich bearbeitet" })
  })

  test("seed does not overwrite existing rows", async () => {
    await syncOps([
      { op: "seed", collection: "tasks", id: "t1", data: { text: "default" } },
      { op: "seed", collection: "tasks", id: "t2", data: { text: "default 2" } },
    ])
    assert.equal((await row("tasks", "t1")).data.text, "later, correct clock")
    assert.equal((await row("tasks", "t2")).data.text, "default 2")
  })

  test("delete hides a row; a put based on the pre-delete revision is rejected", async () => {
    const seen = (await row("tasks", "t2")).rev
    await syncOps([{ op: "del", collection: "tasks", id: "t2", base: seen }])
    const { body } = await syncOps([{ op: "put", collection: "tasks", id: "t2", data: { text: "zombie" }, base: seen }])
    assert.equal(body.results[0].status, "rejected")
    assert.equal(body.results[0].row.deleted, true)
    assert.equal(await row("tasks", "t2"), undefined)
  })

  test("answers and solutions use their own tables and the same revision rule", async () => {
    const a1 = await syncOps([
      { op: "put", collection: "answers", id: "a|r1|1", data: { team_id: "a", round_id: "r1", question: 1, answer: "Rhein", points: 1 }, base: 0 },
      { op: "put", collection: "solutions", id: "r1|1", data: { round_id: "r1", question: 1, solution: "Rhein" }, base: 0 },
    ])
    const rev = a1.body.results[0].rev
    await syncOps([{ op: "put", collection: "answers", id: "a|r1|1", data: { team_id: "a", round_id: "r1", question: 1, answer: "Rhein", points: 0.5 }, base: rev }])
    const stale = await syncOps([{ op: "put", collection: "answers", id: "a|r1|1", data: { team_id: "a", round_id: "r1", question: 1, answer: "Rhein", points: 0 }, base: rev }])
    assert.equal(stale.body.results[0].status, "rejected")
    assert.equal(stale.body.results[0].row.points, 0.5)
    const { body } = await getState()
    assert.deepEqual(body.answers.map(({ ts, rev, ...a }) => a), [{ team_id: "a", round_id: "r1", question: 1, answer: "Rhein", points: 0.5 }])
    assert.equal(body.solutions[0].solution, "Rhein")
  })

  test("seeded answers never overwrite existing ones", async () => {
    const { body } = await syncOps([
      { op: "seed", collection: "answers", id: "a|r1|1", data: { team_id: "a", round_id: "r1", question: 1, answer: "alt", points: 9 } },
      { op: "seed", collection: "answers", id: "a|r1|2", data: { team_id: "a", round_id: "r1", question: 2, answer: "neu", points: 1 } },
    ])
    assert.deepEqual(body.results.map((r) => r.status), ["ignored", "applied"])
    const { body: st } = await getState()
    assert.equal(st.answers.find((x) => x.question === 1).points, 0.5)
    assert.equal(st.answers.find((x) => x.question === 2).answer, "neu")
  })

  test("two organisers scoring different questions both keep their points", async () => {
    const both = await Promise.all([
      syncOps([{ op: "put", collection: "answers", id: "b|r1|1", data: { team_id: "b", round_id: "r1", question: 1, answer: "x", points: 1 }, base: 0 }], "Anna"),
      syncOps([{ op: "put", collection: "answers", id: "b|r1|2", data: { team_id: "b", round_id: "r1", question: 2, answer: "y", points: 1 }, base: 0 }], "Ben"),
    ])
    assert.deepEqual(both.map((r) => r.body.results[0].status), ["applied", "applied"])
    const { body } = await getState()
    assert.equal(body.answers.filter((x) => x.team_id === "b").reduce((s, x) => s + x.points, 0), 2)
  })

  test("questions are a stored collection", async () => {
    const q = { id: "q1", round: "r03", text: "Wie hoch ist der Dom?", mc: true, options: ["157 m", "120 m"], correct: 0, status: "fertig" }
    const { status } = await syncOps([{ op: "put", collection: "questions", id: "q1", data: q, base: 0 }])
    assert.equal(status, 200)
    assert.deepEqual((await row("questions", "q1")).data, q)
  })

  test("invalid ops reject the whole batch", async () => {
    const { status } = await syncOps([
      { op: "put", collection: "tasks", id: "t3", data: {}, base: 0 },
      { op: "put", collection: "nope", id: "x", data: {}, base: 0 },
    ])
    assert.equal(status, 400)
    assert.equal(await row("tasks", "t3"), undefined)
  })
})

describe("revisions, authors and history", () => {
  test("since returns only rows changed after that revision, tombstones included", async () => {
    const { body: before } = await getState()
    await post(sync, "/api/sync", { by: "Anna", ops: [
      { op: "put", collection: "decisions", id: "d1", data: { text: "Beamer?" }, base: 0 },
      { op: "del", collection: "tasks", id: "t1", base: (await row("tasks", "t1")).rev },
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
    await post(sync, "/api/sync", { ops: [{ op: "put", collection: "decisions", id: "d1", data: { text: "alt" }, base: 0 }] })
    const { body: delta } = await getState("?since=" + before.rev)
    assert.equal(delta.items.length, 0)
  })

  test("activity lists changes with author, newest first", async () => {
    await post(sync, "/api/sync", { by: "  Ben  ", ops: [{ op: "put", collection: "rounds", id: "r9", data: { name: "Finale" }, base: 0 }] })
    const { activity } = await getHistory("?view=activity&limit=5")
    assert.equal(activity[0].collection, "rounds")
    assert.equal(activity[0].by, "Ben")
    assert.ok(activity.some((a) => a.collection === "decisions" && a.by === "Anna"))
    assert.ok(activity.every((a, i) => i === 0 || activity[i - 1].at >= a.at))
  })

  test("trash keeps deleted data for restore", async () => {
    const { trash } = await getHistory("?view=trash")
    const t1 = trash.find((t) => t.collection === "tasks" && t.id === "t1")
    assert.deepEqual(t1.data, { text: "later, correct clock" })
    assert.equal(t1.by, "Anna")
    const res = await syncOps([{ op: "put", collection: "tasks", id: "t1", data: t1.data, base: t1.rev }])
    assert.equal(res.body.results[0].status, "applied")
    const { body } = await getState()
    assert.ok(body.items.some((i) => i.collection === "tasks" && i.id === "t1"))
    const { trash: after } = await getHistory("?view=trash")
    assert.equal(after.some((t) => t.id === "t1"), false)
  })

  test("seeded template rows are not attributed to anyone", async () => {
    await post(sync, "/api/sync", { by: "Anna", ops: [{ op: "seed", collection: "tech", id: "x99", data: { text: "Kabel" } }] })
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

describe("robustness and sessions", () => {
  test("a malformed cookie is a 401, not a 500", async () => {
    const res = await state(new Request(base + "/api/state", { headers: { cookie: "bt_auth=%E0%A4%A" } }))
    assert.equal(res.status, 401)
  })

  test("null or primitive ops are a 400, not a 500", async () => {
    for (const ops of [[null], [42], ["x"]]) {
      const res = await post(sync, "/api/sync", { ops })
      assert.equal(res.status, 400, JSON.stringify(ops))
    }
  })

  test("session tokens carry an expiry and expired ones are rejected", async () => {
    const { sessionToken } = await import("../api/_lib.js")
    const fresh = sessionToken()
    assert.notEqual(fresh, sessionToken(Date.now() - 1000), "token depends on its expiry")
    const expired = sessionToken(Date.now() - 1000)
    const res = await state(new Request(base + "/api/state", { headers: { cookie: "bt_auth=" + expired } }))
    assert.equal(res.status, 401)
  })

  test("a token with a tampered expiry is rejected", async () => {
    const [, sig] = cookie.split("=")[1].split(".")
    const forged = (Date.now() + 10 ** 12) + "." + sig
    const res = await state(new Request(base + "/api/state", { headers: { cookie: "bt_auth=" + forged } }))
    assert.equal(res.status, 401)
  })
})
