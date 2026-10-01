// A libsql-compatible client (execute/batch) that keeps the whole SQLite
// database as one file in object storage. Reads open the current snapshot;
// write batches run as one transaction and are saved with an ETag check, so
// two functions writing at the same time cannot overwrite each other: the
// loser re-reads the newer snapshot and replays its batch.
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import initSqlJs from "sql.js"

export class SnapshotConflict extends Error {}

let sqlReady = null
function sqlJs() {
  sqlReady ??= initSqlJs({
    wasmBinary: readFileSync(createRequire(import.meta.url).resolve("sql.js/dist/sql-wasm.wasm")),
  })
  return sqlReady
}

function normalizeArg(v) {
  if (v === undefined) return null
  if (typeof v === "boolean") return v ? 1 : 0
  return v
}

function run(db, stmt) {
  const { sql, args = [] } = typeof stmt === "string" ? { sql: stmt } : stmt
  const prepared = db.prepare(sql)
  try {
    prepared.bind(args.map(normalizeArg))
    const rows = []
    while (prepared.step()) rows.push(prepared.getAsObject())
    return { rows, columns: prepared.getColumnNames(), rowsAffected: db.getRowsModified() }
  } finally {
    prepared.free()
  }
}

const sameBytes = (a, b) => a && b && a.length === b.length && a.every((x, i) => x === b[i])

/**
 * @param {{ load: () => Promise<{ bytes: Uint8Array, etag: string } | null>,
 *           save: (bytes: Uint8Array, etag: string | null) => Promise<void> }} storage
 *   `save` must throw SnapshotConflict when the stored file is no longer `etag`
 *   (or, for `etag === null`, when a file already exists).
 */
export function createSnapshotClient(storage, { attempts = 16 } = {}) {
  async function batch(stmts, mode = "read") {
    const SQL = await sqlJs()
    for (let attempt = 0; attempt < attempts; attempt++) {
      const snap = await storage.load()
      const db = snap ? new SQL.Database(snap.bytes) : new SQL.Database()
      let results
      try {
        if (mode === "write") db.exec("BEGIN")
        results = stmts.map((s) => run(db, s))
        if (mode === "write") db.exec("COMMIT")
      } catch (err) {
        db.close()
        throw err
      }
      if (mode !== "write") {
        db.close()
        return results
      }
      const bytes = db.export()
      db.close()
      // Nothing changed (e.g. migrations that were already applied): no save.
      if (snap && sameBytes(bytes, snap.bytes)) return results
      try {
        await storage.save(bytes, snap ? snap.etag : null)
        return results
      } catch (err) {
        if (!(err instanceof SnapshotConflict)) throw err
        await new Promise((r) => setTimeout(r, 20 + Math.random() * 80 * (attempt + 1)))
      }
    }
    throw new Error("Datenbank ist gerade stark beschäftigt, bitte erneut versuchen")
  }
  return {
    batch,
    execute: async (stmt) => (await batch([stmt], "read"))[0],
  }
}

/** Storage in a private Vercel Blob (needs BLOB_READ_WRITE_TOKEN). */
export async function vercelBlobStorage(pathname = "braintap/braintap.db") {
  const { get, put, BlobPreconditionFailedError } = await import("@vercel/blob")
  return {
    async load() {
      const res = await get(pathname, { access: "private", useCache: false })
      if (!res || !res.stream) return null
      const bytes = new Uint8Array(await new Response(res.stream).arrayBuffer())
      return { bytes, etag: res.blob.etag }
    },
    async save(bytes, etag) {
      try {
        await put(pathname, Buffer.from(bytes), {
          access: "private",
          addRandomSuffix: false,
          contentType: "application/vnd.sqlite3",
          ...(etag ? { allowOverwrite: true, ifMatch: etag } : { allowOverwrite: false }),
        })
      } catch (err) {
        if (err instanceof BlobPreconditionFailedError) throw new SnapshotConflict(err.message)
        // Creating the first snapshot raced with another function.
        if (!etag && /exist/i.test(String(err?.message))) throw new SnapshotConflict(err.message)
        throw err
      }
    },
  }
}
