import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, describe, test } from "node:test"

const dir = mkdtempSync(join(tmpdir(), "braintap-demo-"))
process.env.TURSO_DATABASE_URL = `file:${join(dir, "demo.db")}`
process.env.ORGA_PASSWORD = "geheim"
delete process.env.DEMO_MODE

const { GET: state } = await import("../api/state.js")
const { POST: sync } = await import("../api/sync.js")
const { GET: health } = await import("../api/health.js")
const { GET: speedGet, POST: speedPost } = await import("../api/speed.js")

const base = "http://localhost"
const req = (path, { cookie = "", body } = {}) =>
  new Request(base + path, body === undefined
    ? { headers: { cookie } }
    : { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) })

after(() => { delete process.env.DEMO_MODE; rmSync(dir, { recursive: true, force: true }) })

describe("demo mode", () => {
  test("without DEMO_MODE everything stays behind the login", async () => {
    assert.equal((await state(req("/api/state"))).status, 401)
    const pick = await speedPost(req("/api/speed", { body: { action: "join", teamId: "t1" } }))
    assert.equal(pick.status, 404, "picking a team without a code is not allowed")
  })

  test("with DEMO_MODE=1 the planning data is open without a login", async () => {
    process.env.DEMO_MODE = "1"
    assert.equal((await state(req("/api/state"))).status, 200)
    const ops = [{ op: "put", collection: "teams", id: "t1", base: 0, data: { id: "t1", pos: 1, name: "Die Kölschen" } }]
    assert.equal((await sync(req("/api/sync", { body: { ops, by: "Demo" } }))).status, 200)
    const h = await (await health(req("/api/health"))).json()
    assert.equal(h.status, "ok")
    assert.match(h.login, /Demo/)
  })

  test("a phone picks its team from the list instead of typing a code", async () => {
    process.env.DEMO_MODE = "1"
    const first = await speedGet(req("/api/speed"))
    assert.equal(first.status, 401)
    const body = await first.json()
    assert.equal(body.demo, true)
    assert.deepEqual(body.teams.map((t) => t.name), ["Die Kölschen"])
    const joined = await speedPost(req("/api/speed", { body: { action: "join", teamId: "t1" } }))
    assert.equal(joined.status, 200)
    const cookie = joined.headers.get("set-cookie").split(";")[0]
    const view = await (await speedGet(req("/api/speed", { cookie }))).json()
    assert.equal(view.team.name, "Die Kölschen")
    // The organiser side (and the beamer view) needs no login either.
    assert.equal((await speedGet(req("/api/speed?view=orga"))).status, 200)
  })

  test("removing DEMO_MODE closes everything again", async () => {
    delete process.env.DEMO_MODE
    assert.equal((await state(req("/api/state"))).status, 401)
    assert.equal((await speedGet(req("/api/speed?view=orga"))).status, 401)
  })
})
