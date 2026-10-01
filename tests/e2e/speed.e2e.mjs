// Browser test for the digital speed round: an organiser drives the round in
// planung.html, a team phone plays it in speed.html, the points end up in the
// scoreboard. Run with `npm run test:e2e` (CHROMIUM_PATH if needed).
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { chromium, devices } from "playwright"

const PORT = 8800 + Math.floor(Math.random() * 90)
const URL = `http://localhost:${PORT}`
const dir = mkdtempSync(join(tmpdir(), "braintap-speed-e2e-"))
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

const synced = (page) =>
  page.waitForFunction(() => document.getElementById("syncState").textContent.includes("Server gespeichert"), null, { timeout: 15000 })

test("a team phone plays the speed round and the points reach the scoreboard", async () => {
  const orgaCtx = await browser.newContext()
  const orga = await orgaCtx.newPage()
  const errors = []
  orga.on("pageerror", (e) => errors.push(e.message))
  orga.on("dialog", (d) => d.accept())
  await orga.goto(URL + "/planung.html")
  await orga.waitForSelector("#login:not([hidden])")
  await orga.fill("#loginName", "Anna")
  await orga.fill("#loginPw", "quiz")
  await orga.click("#loginForm button[type=submit]")
  await synced(orga)

  // A team and two questions for the template's speed round.
  await orga.click("[data-tab=score]")
  await orga.fill("#newTeam", "Die Kölschen")
  await orga.click("#addTeam")
  await synced(orga)
  await orga.evaluate(async () => {
    const st = await (await fetch("api/state")).json()
    const round = st.items.find((i) => i.collection === "rounds" && /speed/i.test(i.data.name)).data
    const q = (id, pos, data) => ({ op: "put", collection: "questions", id, base: 0, data: { id, pos, round: round.id, status: "fertig", ...data } })
    await fetch("api/sync", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ by: "Test", ops: [
        q("sq1", 1, { text: "Welcher Fluss fließt durch Köln?", mc: true, options: ["Main", "Rhein", "Elbe", "Mosel"], correct: 1 }),
        q("sq2", 2, { text: "Wie heißt der Kölner Dom-Platz?", solution: "Roncalliplatz" }),
      ] }),
    })
  })
  await orga.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
  await orga.waitForTimeout(800)

  await orga.click("[data-tab=speed]")
  await orga.waitForFunction(() => /[A-Z0-9]{5}/.test(document.querySelector("#spTeams code")?.textContent || ""), null, { timeout: 10000 })
  const code = await orga.textContent("#spTeams code")
  assert.match(await orga.$eval("#spRound", (s) => s.options[s.selectedIndex].textContent), /Speed/)

  // The team phone joins via the QR link with the code.
  const phoneCtx = await browser.newContext({ ...devices["iPhone 13"] })
  const phone = await phoneCtx.newPage()
  const phoneErrors = []
  phone.on("pageerror", (e) => phoneErrors.push(e.message))
  await phone.goto(URL + "/speed.html?code=" + code.toLowerCase())
  await phone.waitForSelector("text=Noch keine Speed-Runde", { timeout: 10000 })
  assert.equal(await phone.textContent("#who"), "Die Kölschen")
  await orga.waitForSelector("#spTeams .tag.ok", { timeout: 10000 })

  // Question 1: multiple choice, scored automatically.
  await orga.fill("#spSecs", "30")
  await orga.click("#spNext")
  await phone.waitForSelector("text=Welcher Fluss fließt durch Köln?", { timeout: 10000 })
  await phone.click("button.opt:has-text('Rhein')")
  await phone.waitForSelector("#answerStatus.ok", { timeout: 10000 })
  await orga.waitForFunction(() => /B\) Rhein/.test(document.getElementById("spTeams").textContent), null, { timeout: 10000 })
  await orga.click("#spReveal")
  await phone.waitForSelector("text=Richtig! +1", { timeout: 10000 })

  // Question 2: free text that does not match is judged by the organiser.
  await orga.click("#spNext")
  await phone.waitForSelector("text=Dom-Platz", { timeout: 10000 })
  await phone.fill("input.field", "Domplatte")
  await phone.click("button[type=submit]")
  await phone.waitForSelector("#answerStatus.ok", { timeout: 10000 })
  await orga.waitForFunction(() => /Domplatte/.test(document.getElementById("spTeams").textContent), null, { timeout: 10000 })
  await orga.click("#spClose")
  await phone.waitForSelector("input.field[disabled]", { timeout: 10000 })
  assert.match(await phone.textContent("#answerStatus"), /Zeit um\. Eure Antwort: Domplatte/)
  await orga.click("button[aria-label='Richtig – Die Kölschen']")
  await orga.waitForFunction(() => document.querySelector("#spTeams td.num")?.textContent === "1", null, { timeout: 10000 })
  await orga.click("#spEnd")
  await phone.waitForSelector("text=Speed-Runde vorbei", { timeout: 10000 })

  // Both points count in the scoreboard.
  await orga.click("[data-tab=score]")
  await orga.waitForFunction(() => {
    const row = [...document.querySelectorAll("#scoreBody tr")].find((r) => r.textContent.includes("Die Kölschen"))
    return row && [...row.querySelectorAll("input[data-score]")].some((i) => i.value === "2")
  }, null, { timeout: 15000 })

  // The team device has no organiser access.
  const st = await phone.evaluate(() => fetch("api/state").then((r) => r.status))
  assert.equal(st, 401)
  assert.deepEqual([...errors, ...phoneErrors], [])
  await orgaCtx.close(); await phoneCtx.close()
})
