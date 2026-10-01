// Browser regression tests for the PR #2 review findings. They start the
// local dev server on a temporary database and drive two Chromium contexts
// (two organisers). Run with `npm run test:e2e`; set CHROMIUM_PATH if
// Playwright's own browser is not installed.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, describe, test } from "node:test"
import { chromium } from "playwright"

const PORT = 8900 + Math.floor(Math.random() * 90)
const URL = `http://localhost:${PORT}`
const dir = mkdtempSync(join(tmpdir(), "braintap-e2e-"))
let server, browser

before(async () => {
  server = spawn(process.execPath, ["scripts/dev-server.mjs"], {
    env: { ...process.env, PORT: String(PORT), ORGA_PASSWORD: "quiz", TURSO_DATABASE_URL: `file:${join(dir, "e2e.db")}` },
    stdio: "ignore",
  })
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(URL + "/index.html")).ok) break } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100))
  }
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
})
after(async () => {
  await browser?.close()
  server?.kill()
  rmSync(dir, { recursive: true, force: true })
})

async function organiser(name, { clockOffset = 0, beforeLoad } = {}) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))
  page.on("dialog", (d) => d.accept())
  if (clockOffset) await page.clock.install({ time: Date.now() + clockOffset })
  if (clockOffset) await page.clock.resume()
  if (beforeLoad) await beforeLoad(page)
  await page.goto(URL + "/planung.html")
  await page.waitForSelector("#login:not([hidden])")
  await page.fill("#loginName", name)
  await page.fill("#loginPw", "quiz")
  await page.click("#loginForm button[type=submit]")
  await synced(page)
  return { ctx, page, errors }
}
const synced = (page) =>
  page.waitForFunction(() => document.getElementById("syncState").textContent.includes("Server gespeichert"), null, { timeout: 15000 })
const pullNow = async (page) => {
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
  await page.waitForTimeout(800)
}
const apiState = async (page) => page.evaluate(() => fetch("api/state").then((r) => r.json()))

describe("PR #2 review regressions", () => {
  test("P1: a write that lost a conflict converges to the server row instead of staying stale", async () => {
    const a = await organiser("Anna")
    const b = await organiser("Ben")
    await a.page.click("[data-tab=tasks]")
    await b.page.click("[data-tab=tasks]")
    const field = (p) => p.locator("#taskWeeks textarea[aria-label=Aufgabe]").first()

    // Anna edits offline, Ben edits the same task online meanwhile.
    await a.ctx.setOffline(true)
    await field(a.page).fill("local stale")
    await field(a.page).blur()
    await field(b.page).fill("remote winner")
    await field(b.page).blur()
    await synced(b.page)
    await a.ctx.setOffline(false)
    await a.page.evaluate(() => window.dispatchEvent(new Event("online")))
    await synced(a.page)
    await pullNow(a.page)

    assert.equal(await field(a.page).inputValue(), "remote winner")
    assert.match(await a.page.textContent("#notice"), /Gleichzeitig von jemand anderem geändert/)
    const server = await apiState(a.page)
    assert.ok(server.items.some((i) => i.collection === "tasks" && i.data.text === "remote winner"))

    // A later edit from Anna (now based on the current revision) goes through.
    await field(a.page).fill("Anna again")
    await field(a.page).blur()
    await synced(a.page)
    await pullNow(b.page)
    assert.equal(await field(b.page).inputValue(), "Anna again")
    assert.deepEqual([...a.errors, ...b.errors], [])
    await a.ctx.close(); await b.ctx.close()
  })

  test("P1: two organisers scoring different questions of one team see the full round total", async () => {
    const a = await organiser("Anna")
    const b = await organiser("Ben")
    await a.page.click("[data-tab=score]")
    await a.page.fill("#newTeam", "Die Kölschen")
    await a.page.click("#addTeam")
    await synced(a.page)
    await pullNow(b.page)
    await b.page.click("[data-tab=score]")
    for (const p of [a.page, b.page]) {
      const team = (await p.$$eval("#ansTeam option", (o) => o.map((x) => x.value)))[1]
      await p.selectOption("#ansTeam", team)
    }
    // Both score before either has seen the other's write.
    await Promise.all([
      a.page.click('[aria-label="Frage 1 richtig"]'),
      b.page.click('[aria-label="Frage 2 richtig"]'),
    ])
    await synced(a.page); await synced(b.page)
    await pullNow(a.page); await pullNow(b.page)
    for (const p of [a.page, b.page]) {
      assert.equal(await p.textContent("#ansSum"), "2")
      assert.equal(await p.inputValue("#scoreBody tr:first-child input[data-score]"), "2")
    }
    await a.ctx.close(); await b.ctx.close()
  })

  test("P2: projector, answer grid and solutions use the same question slots", async () => {
    const a = await organiser("Anna")
    await a.page.click("[data-tab=rounds]")
    const qCount = a.page.locator("#roundTable tr").first().locator('input[aria-label="questions"]')
    await qCount.fill("1")
    await a.page.click("[data-tab=questions]")
    const round = (await a.page.$$eval("#qRound option", (o) => o.map((x) => x.value)))[0]
    await a.page.selectOption("#qRound", round)
    for (const [text, sol] of [["", "leer"], ["Main", "Lösung Main"], ["Reserve-Frage", "Lösung Reserve"]]) {
      await a.page.click("#addQuestion")
      const li = a.page.locator("#qList li.q").last()
      if (text) await li.locator("textarea").fill(text)
      await li.locator('input[aria-label^="Lösung Frage"]').fill(sol)
    }
    await a.page.click("#presentQuestions")
    await a.page.keyboard.press("ArrowRight")
    assert.equal(await a.page.textContent("#showCount"), "Frage 1 / 1")
    assert.match(await a.page.textContent("#showMain"), /fehlt noch/)
    await a.page.keyboard.press("ArrowRight")
    assert.match(await a.page.textContent("#showMain"), /Ende von Runde/, "reserve question is not presented")
    await a.page.keyboard.press("Escape")

    await a.page.click("[data-tab=score]")
    await a.page.fill("#newTeam", "Slot-Team"); await a.page.click("#addTeam")
    await a.page.selectOption("#ansRound", round)
    const team = (await a.page.$$eval("#ansTeam option", (o) => o.map((x) => x.value)))[1]
    await a.page.selectOption("#ansTeam", team)
    assert.equal(await a.page.$$eval("#ansBody tr", (r) => r.length), 1)
    assert.equal(await a.page.textContent("#ansBody tr:first-child td:nth-child(2)"), "leer")
    await a.ctx.close()
  })

  test("P2: answers from the old IndexedDB database are taken over once, without overwriting", async () => {
    const a = await organiser("Anna")
    await a.page.click("[data-tab=score]")
    await a.page.fill("#newTeam", "Altes Team"); await a.page.click("#addTeam")
    await synced(a.page)
    const roundName = await a.page.$eval("#ansRound option", (o) => o.textContent.replace(/^\d+ – /, ""))
    // Build the old browser-only database exactly like the previous release did.
    await a.page.addScriptTag({ url: "vendor/sqljs/sql-wasm.js" })
    await a.page.evaluate(async (roundName) => {
      const SQL = await window.initSqlJs({ locateFile: (f) => "vendor/sqljs/" + f })
      const d = new SQL.Database()
      d.run("CREATE TABLE answers (team_id TEXT, team_name TEXT, round_id TEXT, round_name TEXT, question INTEGER, answer TEXT, points REAL, updated_at TEXT, PRIMARY KEY (team_id, round_id, question))")
      d.run("CREATE TABLE solutions (round_id TEXT, question INTEGER, solution TEXT, PRIMARY KEY (round_id, question))")
      d.run("INSERT INTO answers VALUES ('old-id', 'Altes Team', 'old-round', ?, 3, 'Rhein', 1, '')", [roundName])
      const bytes = d.export()
      await new Promise((res, rej) => {
        const req = indexedDB.open("braintap", 1)
        req.onupgradeneeded = () => req.result.createObjectStore("files")
        req.onsuccess = () => {
          const tx = req.result.transaction("files", "readwrite")
          tx.objectStore("files").put(bytes, "answers.sqlite")
          tx.oncomplete = () => { req.result.close(); res() }
          tx.onerror = () => rej(tx.error)
        }
      })
      localStorage.removeItem("braintap-idb-migrated")
    }, roundName)

    await a.page.reload()
    await synced(a.page)
    await a.page.waitForFunction(() => /alten Browser-Datenbank übernommen/.test(document.getElementById("notice").textContent), null, { timeout: 15000 })
    const server = await apiState(a.page)
    const migrated = server.answers.find((x) => x.question === 3)
    assert.ok(migrated, "old answer reached the server")
    assert.equal(migrated.answer, "Rhein")
    assert.ok(await a.page.evaluate(() => localStorage.getItem("braintap-idb-migrated")))
    await a.ctx.close()
  })

  test("P2: a device clock one hour ahead does not swallow a later edit from a correct clock", async () => {
    const fast = await organiser("Uhr vor", { clockOffset: 3600000 })
    const ok = await organiser("Uhr richtig")
    await fast.page.click("[data-tab=overview]")
    await ok.page.click("[data-tab=overview]")
    const venue = (p) => p.locator("[data-meta=venue]")
    await venue(fast.page).fill("Kneipe A")
    await venue(fast.page).blur()
    await synced(fast.page)
    await pullNow(ok.page)
    await venue(ok.page).fill("Kneipe B (später)")
    await venue(ok.page).blur()
    await synced(ok.page)
    const server = await apiState(ok.page)
    assert.equal(server.items.find((i) => i.collection === "meta" && i.id === "venue").data.value, "Kneipe B (später)")
    await fast.ctx.close(); await ok.ctx.close()
  })
})
