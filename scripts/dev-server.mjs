// Local stand-in for Vercel: serves the static files and routes /api/<name>
// to the same handlers Vercel runs. Defaults to a SQLite file next to the repo.
import { createReadStream, existsSync, statSync } from "node:fs"
import { createServer } from "node:http"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
process.env.TURSO_DATABASE_URL ??= `file:${join(root, "braintap.local.db")}`
process.env.ORGA_PASSWORD ??= "quiz"

const port = Number(process.env.PORT ?? 3000)
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json",
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`)

  const api = url.pathname.match(/^\/api\/([a-z][a-z-]*)$/)
  if (api) {
    const file = join(root, "api", `${api[1]}.js`)
    const mod = existsSync(file) ? await import(file) : {}
    const fn = mod[req.method]
    if (!fn) {
      res.writeHead(405).end()
      return
    }
    const chunks = []
    for await (const c of req) chunks.push(c)
    const body = chunks.length ? Buffer.concat(chunks) : undefined
    const response = await fn(new Request(url, { method: req.method, headers: req.headers, body }))
    const headers = Object.fromEntries(response.headers)
    const cookies = response.headers.getSetCookie()
    if (cookies.length) headers["set-cookie"] = cookies
    res.writeHead(response.status, headers)
    res.end(Buffer.from(await response.arrayBuffer()))
    return
  }

  const path = normalize(join(root, url.pathname === "/" ? "index.html" : url.pathname))
  if (!path.startsWith(root) || !existsSync(path) || !statSync(path).isFile()) {
    res.writeHead(404).end("Not found")
    return
  }
  res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" })
  createReadStream(path).pipe(res)
}).listen(port, () => {
  console.log(`BrainTap: http://localhost:${port}  (Passwort: ${process.env.ORGA_PASSWORD})`)
})
