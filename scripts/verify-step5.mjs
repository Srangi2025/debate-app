import { chromium } from "playwright";
import IORedis from "ioredis";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdtempSync, readFileSync, mkdirSync, writeFileSync, copyFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { authFixture } from "./e2e-auth.mjs";
import { HistoryStore } from "../lib/history-store.ts";

// Opt-in integration run: real web/Redis/SQLite/AI; isolated local auth provider.
const port = Number(process.env.E2E_PORT || 3100);
const base = `http://127.0.0.1:${port}`;
const redisUrl = process.env.E2E_REDIS_URL || "redis://127.0.0.1:6379/15";
const parsed = new URL(redisUrl);
if (!/^\/[1-9][0-9]*$/.test(parsed.pathname)) throw new Error("E2E_REDIS_URL must select a dedicated nonzero Redis database");
const runDir = mkdtempSync(join(tmpdir(), "debate-step5-"));
const dbPath = join(runDir, "history.sqlite");
const checkout = join(runDir, "checkout");
const sources = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
for (const source of sources) {
  if (!existsSync(source)) continue;
  const target = join(checkout, source); mkdirSync(dirname(target), { recursive: true }); copyFileSync(source, target);
}
symlinkSync(resolve("node_modules"), join(checkout, "node_modules"), "dir");
const artifacts = resolve(process.env.E2E_ARTIFACT_DIR || "data/e2e-artifacts");
mkdirSync(artifacts, { recursive: true });
const redis = new IORedis(redisUrl);
const owner = randomUUID();
let fixture, app, browser, ownsDatabase = false;
const contexts = [], errors = [], logs = [];
const password = "Test-only-" + randomUUID();

async function waitFor(check, timeout = 180000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const result = await check(); if (result) return result; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for integration state");
}
function pass(message) { logs.push(message); console.log("PASS:", message); }
async function stopApp() {
  if (!app || app.exitCode !== null || app.signalCode !== null) return;
  const child = app;
  const exited = new Promise(resolve => child.once("exit", resolve));
  child.kill("SIGTERM");
  await exited;
  app = undefined;
}
async function startApp() {
  app = spawn(process.execPath, ["scripts/dev.mjs", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: checkout,
    env: { ...process.env, REDIS_URL: redisUrl, HISTORY_DB_PATH: dbPath,
      NEXT_PUBLIC_SUPABASE_URL: fixture.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
      AI_JUDGE_URL: process.env.E2E_AI_URL || "http://127.0.0.1:8001", NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stream = createWriteStream(join(artifacts, "server.log"), { flags: "a" });
  app.stdout.pipe(stream); app.stderr.pipe(stream);
  await waitFor(async () => {
    if (app.exitCode !== null) throw new Error("Integration web process stopped");
    return (await fetch(base + "/dashboard", { signal: AbortSignal.timeout(3000) })).ok;
  });
}
async function login(page, email) {
  await page.goto(base + "/account");
  await waitFor(() => page.getByRole("button", { name: "Sign in", exact: true }).isEnabled());
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByText(`Signed in as ${email}`, { exact: true }).waitFor();
}
try {
  assert.equal(await redis.dbsize(), 0, "The dedicated test database must be empty; refusing to modify an occupied database");
  assert.equal(await redis.set("e2e:owner", owner, "NX"), "OK"); ownsDatabase = true;
  fixture = await authFixture();
  const accountA = fixture.createUser("history-a@example.invalid", password);
  const accountB = fixture.createUser("history-b@example.invalid", password);
  await startApp();
  const executable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome") ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined);
  browser = await chromium.launch({ executablePath: executable, headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  for (const name of ["History A", "History B", "Private intruder"]) {
    const context = await browser.newContext({ permissions: ["camera", "microphone"] }); contexts.push(context);
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message)); page.on("dialog", dialog => dialog.dismiss());
    await page.goto(base + "/dashboard");
    await page.getByLabel("Username", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Saved ✓", exact: true }).waitFor();
  }
  const pages = contexts.map(context => context.pages()[0]);
  const credentials = await Promise.all(contexts.map(async context => (await context.cookies()).find(cookie => cookie.name === "debate-guest").value));
  const ids = await Promise.all(credentials.map(credential => redis.get("guest-session:" + credential)));
  for (const page of pages.slice(0, 2)) {
    await page.getByRole("button", { name: /College should be free/ }).click();
    await page.getByRole("button", { name: "Join Queue", exact: true }).click();
  }
  await Promise.all(pages.slice(0, 2).map(page => page.waitForURL("**/match/*", { timeout: 30000 })));
  const matchId = pages[0].url().split("/").at(-1);
  assert.equal(pages[1].url(), pages[0].url());
  await Promise.all(pages.slice(0, 2).map(page => page.getByText("Connected", { exact: true }).waitFor({ timeout: 30000 })));
  pass("Steps 1–2: saved profiles and isolated guests pair; WebRTC connects.");
  const blocked = await contexts[0].request.post(base + "/api/account/claim"); assert.equal(blocked.status(), 401);
  await pages[2].goto(base + "/account");
  await waitFor(() => pages[2].getByRole("button", { name: "Sign in", exact: true }).isEnabled());
  await pages[2].getByLabel("Email", { exact: true }).fill("history-a@example.invalid");
  await pages[2].getByLabel("Password", { exact: true }).fill("incorrect-password");
  await pages[2].getByRole("button", { name: "Sign in", exact: true }).click();
  await pages[2].getByText("Invalid login credentials", { exact: false }).waitFor();
  const speech = process.env.E2E_SPEECH_WAV;
  if (speech) {
    const response = await contexts[0].request.post(`${base}/api/match/${matchId}/transcript`, { multipart: { segmentId: randomUUID(), source: "speech", audio: { name: "speech.wav", mimeType: "audio/wav", buffer: readFileSync(speech) } } });
    assert.equal(response.status(), 200, await response.text()); assert.ok((await response.json()).segment.text);
    pass("Step 3: actual local speech recognition saves an authenticated speaker segment.");
  }
  for (const [index, text] of ["I support free college as a policy preference, with public oversight of costs and access.", "I prefer targeted aid. Universal funding could also benefit families who do not need assistance; the other side should address that tradeoff."].entries()) {
    await pages[index].getByLabel("Add a text contribution", { exact: true }).fill(text);
    await pages[index].getByRole("button", { name: "Send Text", exact: true }).click();
    await pages[index].getByRole("log", { name: "Saved debate transcript" }).getByText(text, { exact: true }).waitFor();
  }
  await pages[0].reload();
  await pages[0].getByRole("log", { name: "Saved debate transcript" }).getByText("I support free college as a policy preference, with public oversight of costs and access.", { exact: true }).waitFor();
  const live = await waitFor(async () => { const raw = await redis.get(`match:${matchId}:live-feedback`); return raw && JSON.parse(raw); }, 180000);
  assert.ok(live.version); pass("Steps 3–4: saved transcript reloads and actual AI live feedback is published.");
  for (const page of pages.slice(0, 2)) await page.getByRole("button", { name: "Submit Debate", exact: true }).click();
  await Promise.all(pages.slice(0, 2).map(page => page.waitForURL("**/result/*")));
  await pages[0].getByText("Match Result", { exact: true }).waitFor({ timeout: 240000 });
  await waitFor(async () => (await contexts[0].request.get(`${base}/api/history/${matchId}`)).ok());
  const original = await (await contexts[0].request.get(`${base}/api/history/${matchId}`)).json();
  assert.equal(original.result.judgeVersion, "ollama-grounded-v2");
  assert.ok(original.segments.some(segment => segment.source === "text"));
  if (speech) assert.ok(original.segments.some(segment => segment.source === "speech"));
  assert.deepEqual(await (await contexts[1].request.get(`${base}/api/history/${matchId}`)).json(), original);
  assert.equal((await contexts[2].request.get(`${base}/api/history/${matchId}`)).status(), 404);
  pass("Final judging and SQL archival preserve transcripts/results for both participants and reject outsiders.");
  // A separate privacy fixture makes ownership tests meaningful beyond a shared debate.
  const privateId = "private-history-" + randomUUID(); const archive = new HistoryStore(dbPath);
  archive.save({ match: { id: privateId, topics: ["free-college"], status: "ended", createdAt: Date.now() - 1000, endedAt: Date.now(), player1: { userId: ids[1], username: "History B" }, player2: { userId: ids[2], username: "Private intruder" } }, result: { matchId: privateId, status: "finished", winner: null }, segments: [], submissions: { A: "Private B fixture", B: "Private peer fixture" } }); archive.close();
  await login(pages[0], "history-a@example.invalid");
  const tokenA = fixture.token("history-a@example.invalid");
  const withoutCookie = await browser.newContext(); contexts.push(withoutCookie);
  const injected = await withoutCookie.request.post(base + "/api/account/claim", { headers: { Authorization: "Bearer " + tokenA }, data: { guestId: ids[1], accountId: accountA.id } });
  assert.equal((await injected.json()).imported, 0, "Client-supplied IDs cannot replace guest-cookie proof");
  const busyId = "claim-busy-" + randomUUID();
  await redis.set(`user:${ids[0]}:match`, busyId); await redis.set(`match:${busyId}`, JSON.stringify({ status: "active" }));
  assert.equal((await contexts[0].request.post(base + "/api/account/claim", { headers: { Authorization: "Bearer " + tokenA } })).status(), 409);
  await redis.del(`user:${ids[0]}:match`, `match:${busyId}`);
  const forged = [Buffer.from('{"alg":"none"}').toString("base64url"), Buffer.from(JSON.stringify({ sub: accountA.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url"), "forged"].join(".");
  assert.equal((await contexts[2].request.get(base + "/api/history", { headers: { Authorization: "Bearer " + forged } })).status(), 401);
  assert.equal((await contexts[0].request.get(`${base}/api/history/${matchId}`, { headers: { Authorization: "Bearer " + tokenA } })).status(), 404, "Sign-in alone must not silently claim guest history");
  await pages[0].getByRole("button", { name: "Import guest history", exact: true }).click();
  await pages[0].getByText(/Guest history and the saved guest name have been linked/).waitFor();
  const imported = await contexts[0].request.get(`${base}/api/history/${matchId}`, { headers: { Authorization: "Bearer " + tokenA } });
  assert.deepEqual(await imported.json(), original);
  assert.equal((await contexts[0].request.get(`${base}/api/history/${privateId}`, { headers: { Authorization: "Bearer " + tokenA } })).status(), 404);
  await pages[0].goto(`${base}/history/${matchId}`); await pages[0].getByRole("heading", { name: "Saved transcript", exact: true }).waitFor();
  await pages[0].getByRole("link", { name: "Open full judgment", exact: true }).click();
  await pages[0].getByText("Match Result", { exact: true }).waitFor();
  await pages[0].goto(`${base}/history/${matchId}`); await pages[0].getByRole("heading", { name: "Saved transcript", exact: true }).waitFor();
  await pages[0].reload(); await pages[0].getByRole("heading", { name: "Saved transcript", exact: true }).waitFor();
  pass("Accounts: verified tokens, explicit cookie-proven import, stable speaker IDs, private history, and refresh recovery.");
  await login(pages[1], "history-b@example.invalid"); await pages[1].getByRole("button", { name: "Import guest history", exact: true }).click();
  await pages[1].getByText(/Guest history and the saved guest name have been linked/).waitFor();
  await contexts[0].addCookies([{ name: "debate-guest", value: credentials[1], url: base, httpOnly: true, sameSite: "Lax" }]);
  assert.equal((await contexts[0].request.post(base + "/api/account/claim", { headers: { Authorization: "Bearer " + tokenA }, data: { guestId: ids[1] } })).status(), 200);
  assert.equal((await contexts[0].request.get(`${base}/api/history/${privateId}`, { headers: { Authorization: "Bearer " + tokenA } })).status(), 404);
  for (const page of pages.slice(0, 2)) {
    await page.goto(base + "/dashboard");
    await page.getByRole("button", { name: /College should be free/ }).click();
    await page.getByRole("button", { name: "Join Queue", exact: true }).click();
  }
  await Promise.all(pages.slice(0, 2).map(page => page.waitForURL("**/match/*", { timeout: 30000 })));
  const accountRoom = pages[0].url().split("/").at(-1); assert.equal(pages[1].url(), pages[0].url());
  const pairedAccounts = JSON.parse(await redis.get(`match:${accountRoom}`));
  assert.deepEqual(new Set([pairedAccounts.player1.userId, pairedAccounts.player2.userId]), new Set([accountA.id, accountB.id]));
  await pages[0].getByLabel("Add a text contribution", { exact: true }).fill("A permanent account contribution.");
  await pages[0].getByRole("button", { name: "Send Text", exact: true }).click();
  await pages[0].getByRole("log", { name: "Saved debate transcript" }).getByText("A permanent account contribution.", { exact: true }).waitFor();
  const accountSegments = (await redis.lrange(`match:${accountRoom}:transcript`, 0, -1)).map(JSON.parse);
  assert.equal(accountSegments[0].userId, accountA.id);
  await pages[0].getByRole("button", { name: "Leave Match", exact: true }).click();
  await pages[0].waitForURL("**/dashboard");
  pass("Permanent accounts also pair and save correctly attributed contributions without changing imported history.");
  await pages[0].goto(base + "/account"); await pages[0].getByRole("button", { name: "Sign out", exact: true }).click();
  await pages[0].getByText(/Signed out. Account history remains private/).waitFor();
  assert.equal((await contexts[0].request.get(`${base}/api/history/${matchId}`)).status(), 404);
  pass("Imported guests cannot be reclaimed by another account; signing out removes access.");
  const confirmation = await browser.newContext(); contexts.push(confirmation); const confirmPage = await confirmation.newPage();
  await confirmPage.goto(base + "/account"); await confirmPage.getByRole("button", { name: "Create an account instead", exact: true }).click();
  await waitFor(() => confirmPage.getByRole("button", { name: "Create account", exact: true }).isEnabled());
  await confirmPage.getByLabel("Email", { exact: true }).fill("confirm-history@example.invalid"); await confirmPage.getByLabel("Password", { exact: true }).fill(password);
  await confirmPage.getByRole("button", { name: "Create account", exact: true }).click(); await confirmPage.getByText(/Check your email to confirm/).waitFor();
  fixture.confirm("confirm-history@example.invalid"); await confirmPage.getByRole("button", { name: "Already have an account? Sign in", exact: true }).click();
  await confirmPage.getByRole("button", { name: "Sign in", exact: true }).click(); await confirmPage.getByText("Signed in as confirm-history@example.invalid", { exact: true }).waitFor();
  pass("Signup confirmation and later sign-in work against the isolated auth-provider contract.");
  assert.equal(await redis.hlen("users:ratings"), 0);
  await redis.flushdb(); await redis.set("e2e:owner", owner);
  await stopApp(); await startApp();
  await login(pages[0], "history-a@example.invalid");
  await pages[0].goto(`${base}/history/${matchId}`); await pages[0].getByRole("heading", { name: "Saved transcript", exact: true }).waitFor();
  await pages[0].setViewportSize({ width: 390, height: 844 });
  assert.ok(await pages[0].evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await pages[0].screenshot({ path: join(artifacts, "saved-debate-mobile.png"), fullPage: true });
  pass("History survives Redis loss and an app/worker restart; mobile layout fits; ratings remain unchanged.");
  assert.deepEqual(errors, []);
  writeFileSync(join(artifacts, "report.json"), JSON.stringify({ passed: true, checks: logs, speech: !!speech, auth: "isolated local provider contract; not live Supabase", database: dbPath }, null, 2) + "\n");
  console.log(`Step 5 integration artifacts: ${artifacts}`);
} catch (error) {
  console.error("Integration failure:", error.message);
  console.error("Auth fixture requests:", JSON.stringify(fixture?.requests));
  for (const [index, context] of contexts.entries()) {
    const page = context.pages()[0];
    if (page && !page.isClosed()) {
      await page.screenshot({ path: join(artifacts, `failure-${index}.png`), fullPage: true }).catch(() => {});
      writeFileSync(join(artifacts, `failure-${index}.txt`), await page.locator("body").innerText().catch(() => "Unavailable"));
    }
  }
  throw error;
} finally {
  await browser?.close(); await stopApp(); await fixture?.close();
  if (ownsDatabase && await redis.get("e2e:owner") === owner) await redis.flushdb();
  await redis.quit();
}
