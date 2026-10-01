import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { createSnapshotClient } from "../api/_snapshot.js"
import { memoryStorage } from "./memory-storage.mjs"

describe("snapshot client (Vercel Blob backend)", () => {
  test("reads see committed writes; parameters and rows behave like libSQL", async () => {
    const c = createSnapshotClient(memoryStorage())
    await c.batch(["CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER, ok INTEGER)", { sql: "INSERT INTO t VALUES (?, ?, ?)", args: ["a", 1, true] }], "write")
    const r = await c.execute({ sql: "SELECT id, n, ok FROM t WHERE id = ?", args: ["a"] })
    assert.deepEqual(r.rows, [{ id: "a", n: 1, ok: 1 }])
  })

  test("a failing statement rolls back the whole batch and saves nothing", async () => {
    const storage = memoryStorage()
    const c = createSnapshotClient(storage)
    await c.batch(["CREATE TABLE t (id TEXT PRIMARY KEY)"], "write")
    const saves = storage.stats.saves
    await assert.rejects(c.batch(["INSERT INTO t VALUES ('x')", "INSERT INTO nope VALUES (1)"], "write"))
    assert.equal(storage.stats.saves, saves)
    assert.deepEqual((await c.execute("SELECT COUNT(*) AS n FROM t")).rows, [{ n: 0 }])
  })

  test("unchanged write batches (re-run migrations) do not save again", async () => {
    const storage = memoryStorage()
    const c = createSnapshotClient(storage)
    await c.batch(["CREATE TABLE IF NOT EXISTS t (id TEXT)"], "write")
    const saves = storage.stats.saves
    await c.batch(["CREATE TABLE IF NOT EXISTS t (id TEXT)"], "write")
    assert.equal(storage.stats.saves, saves)
  })

  test("concurrent writers from separate functions never lose an update", async () => {
    const storage = memoryStorage({ delay: 15 })
    // Separate clients = separate function instances sharing one stored file.
    const clients = Array.from({ length: 6 }, () => createSnapshotClient(storage, { attempts: 40 }))
    await clients[0].batch(["CREATE TABLE c (id INTEGER PRIMARY KEY, v INTEGER)", "INSERT INTO c VALUES (1, 0)"], "write")
    await Promise.all(
      clients.flatMap((c) => [1, 2, 3].map(() => c.batch(["UPDATE c SET v = v + 1 WHERE id = 1"], "write"))),
    )
    const { rows } = await clients[0].execute("SELECT v FROM c WHERE id = 1")
    assert.equal(rows[0].v, 18)
    assert.ok(storage.stats.conflicts > 0, "the test really produced conflicting writes")
  })
})
