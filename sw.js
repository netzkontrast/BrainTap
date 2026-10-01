// Keeps the planning pages loadable without network (e.g. when the pub's
// internet drops). HTML is network-first so updates arrive as soon as we are
// online; the API is never cached, the page buffers writes itself.
const CACHE = "braintap-shell-v2"
const SHELL = ["./", "index.html", "planung.html", "speed.html", "vendor/sqljs/sql-wasm.js", "vendor/sqljs/sql-wasm.wasm"]

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) {
    return
  }
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(event.request, copy))
        }
        return res
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true })),
  )
})
