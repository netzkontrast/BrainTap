import { SnapshotConflict } from "../api/_snapshot.js"

// In-memory stand-in for Vercel Blob: an ETag per version, conditional
// writes, and an optional delay so tests can interleave concurrent writers.
export function memoryStorage({ delay = 0 } = {}) {
  let current = null
  let version = 0
  const wait = () => (delay ? new Promise((r) => setTimeout(r, Math.random() * delay)) : null)
  return {
    stats: { saves: 0, conflicts: 0 },
    async load() {
      await wait()
      return current && { bytes: current.bytes.slice(), etag: current.etag }
    },
    async save(bytes, etag) {
      await wait()
      if ((current ? current.etag : null) !== etag) {
        this.stats.conflicts++
        throw new SnapshotConflict("etag mismatch")
      }
      current = { bytes: bytes.slice(), etag: `v${++version}` }
      this.stats.saves++
    },
  }
}
