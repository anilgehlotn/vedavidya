// Browser checks for the Phase 4 screens. Grows screen by screen.
// Needs: built web app served by a FRESH server with the demo seed (SEED_DEMO=true), mock Claude running.
// Usage: node scripts/e2e-ui-phase4.mjs     (SHOTS=dir to save screenshots)
import { createRequire } from "node:module";
const require = createRequire(new URL("../server/package.json", import.meta.url));
const { chromium } = require("playwright");

const BASE = process.env.BASE ?? "http://localhost:4300";
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗", m); } };
const log = (m) => console.log(m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function call(method, p, { token, body } = {}) {
  const h = {}; if (token) h.Authorization = `Bearer ${token}`; if (body !== undefined) h["Content-Type"] = "application/json";
  const r = await fetch(API + p, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d };
}
const s = Date.now().toString(36);

log("▸ Set-up");
const demo = (await call("POST", "/auth/login", { body: { identifier: "admin@demo.school", password: "demo1234" } })).data.token;
const reg = await call("POST", "/auth/register", { body: { institute: `Phase4 Academy ${s}`, city: "Nagpur", name: "Kiran Rao", email: `p4-${s}@example.com`, password: "Phase4-admin#2026" } });
ok(reg.status === 200, `register ${reg.status}`);
const admin = reg.data.token;
ok(Boolean(demo), "demo admin signs in");

const browser = await chromium.launch();
const errors = [];
async function pageAs(token, viewport = { width: 1280, height: 860 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${page.url()}: ${m.text()}`); });
  await page.goto(BASE + "/login");
  await page.evaluate((t) => localStorage.setItem("vedavidya_token", t), token);
  return page;
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
const visible = (loc, timeout = 8000) => loc.first().waitFor({ state: "visible", timeout }).then(() => true, () => false);

try {
  // ------------------------------------------------------------------ Home
  log("▸ Home dashboard");
  const p = await pageAs(demo);
  await p.goto(BASE + "/app");
  ok(await visible(p.locator(".page-title p", { hasText: new Date().getFullYear().toString() })), "greeting shows today's date");
  const stat = (label) => p.locator(".stat-link", { hasText: label });
  ok(await visible(stat("Students")), "Students card");
  for (const l of ["Teachers", "Batches", "Tests"]) ok(await stat(l).count() === 1, `${l} card`);
  ok(/\+\d+ new/.test(await stat("Students").innerText()), "cards show new in the last 30 days");
  const before = Number((await stat("Batches").locator(".value").innerText()).trim());
  const courses = (await call("GET", "/courses", { token: demo })).data;
  const jee = courses.find((c) => c.name === "JEE Main");
  await p.getByLabel("Course").selectOption(jee.id);
  await p.waitForURL(/course=/);
  await sleep(600);
  const after = Number((await stat("Batches").locator(".value").innerText()).trim());
  ok(after === jee.batches && after < before, `course filter narrows the cards (${before} → ${after})`);
  ok((await p.locator(".cchart-label").allInnerTexts()).join("|") === "JEE Main", "chart shows only that course");
  await p.reload();
  await visible(p.getByLabel("Course").locator(`option[value="${jee.id}"]`).locator(".."), 5000);
  await sleep(500);
  ok((await p.getByLabel("Course").inputValue()) === jee.id, "filter stays after a reload (it's in the address)");
  await p.getByRole("button", { name: "Clear filters" }).click();
  await sleep(600);
  ok(Number((await stat("Batches").locator(".value").innerText()).trim()) === before, "Clear filters shows everything again");
  await p.locator(".cchart-bar").first().hover();
  ok(await visible(p.locator(".cchart-tip")), "hovering a bar shows a tooltip");
  ok(/students?/.test(await p.locator(".cchart-tip").innerText()), "tooltip has the batch's student count");
  ok(await p.locator(".people-list li").count() > 0, "recent students are listed");
  await shot(p, "p4-home");
  await p.locator(".people-list a").first().click();
  await p.waitForURL(/\/app\/students\//);
  ok(true, "a recent student opens their report");
  await p.goto(BASE + "/app");
  await stat("Tests").click();
  await p.waitForURL("**/app/tests");
  ok(true, "stat cards link to their pages");
  const f = await pageAs(admin);
  await f.goto(BASE + "/app");
  ok(await visible(f.locator(".state", { hasText: "No batches yet" })), "new institute: chart empty state");
  ok(await visible(f.locator(".state", { hasText: "No students yet" })), "new institute: students empty state");

  // ------------------------------------------------------------------ Batches
  log("▸ Batches");
  await p.goto(BASE + "/app/batches");
  const cards = p.locator(".batch-card");
  ok(await visible(cards), "batches show as cards");
  const total = await cards.count();
  ok(total === 3, `all demo batches (${total})`);
  ok(/Students/.test(await cards.first().innerText()) && /Average/.test(await cards.first().innerText()), "cards show students, tests and average");
  await p.getByLabel("Search batches").fill("alpha");
  ok(await cards.count() === 1, "search narrows the cards");
  await p.getByLabel("Search batches").fill("zzz");
  ok(await visible(p.locator(".state", { hasText: "No batches match" })), "no-match state");
  await p.getByRole("button", { name: "Clear search and filters" }).click();
  ok(await cards.count() === total, "clearing shows all");
  await p.getByLabel("Course").selectOption({ label: "JEE Main" });
  await sleep(200);
  ok(await cards.count() === 2, "course filter");
  await p.getByLabel("Course").selectOption("");
  await p.getByRole("button", { name: "List" }).click();
  ok(await visible(p.locator("table.t th", { hasText: "Lead teacher" })), "list view");
  await p.reload();
  ok(await visible(p.locator("table.t th", { hasText: "Lead teacher" })), "list view is remembered");
  await p.getByRole("button", { name: "Cards" }).click();
  await p.getByRole("tab", { name: /Centres/ }).click();
  ok(await visible(p.locator("table.t", { hasText: "City" })), "Centres tab");
  await p.getByRole("tab", { name: /Courses/ }).click();
  ok(await visible(p.locator(".card", { hasText: "Courses & subjects" })), "Courses tab");
  await shot(p, "p4-batches");

  // Moving students (new institute, so the demo data stays untouched)
  const fb = await pageAs(admin);
  await fb.goto(BASE + "/app/batches");
  ok(await visible(fb.locator(".state", { hasText: "No batches yet" })), "new institute: empty state");
  for (const name of ["Morning", "Evening"]) {
    await fb.getByRole("button", { name: "+ Batch" }).first().click();
    await fb.getByPlaceholder("e.g. NEET 2027 - Morning").fill(name);
    await fb.getByPlaceholder("e.g. 10th CBSE").fill("10th CBSE");
    await fb.getByLabel("Start date").fill("2026-06-01");
    await fb.getByRole("button", { name: "Create batch" }).click();
    ok(await visible(fb.locator(".toast", { hasText: `Batch "${name}" created.` })), `batch ${name} created`);
  }
  const fbatches = (await call("GET", "/batches", { token: admin })).data;
  const morning = fbatches.find((b) => b.name === "Morning"), evening = fbatches.find((b) => b.name === "Evening");
  ok(morning.start_date === "2026-06-01" && morning.course_name === "10th CBSE", "start date and course saved");
  await call("POST", "/students/bulk", { token: admin, body: { batch_id: morning.id, csv: "Ravi Kumar,1\nSita Devi,2\nAmit Shah,3" } });
  await call("POST", "/students/bulk", { token: admin, body: { batch_id: evening.id, csv: "Neha Joshi,2" } });
  await fb.reload();
  const mcard = fb.locator(".batch-card", { hasText: "Morning" });
  ok(/Started/.test(await mcard.innerText()), "card shows the start date");
  await mcard.getByRole("button", { name: "Move students" }).click();
  const dlg = fb.getByRole("dialog");
  ok(await visible(dlg.getByText("3 of 3 selected")), "everyone selected at first");
  await dlg.getByLabel("Ravi Kumar").uncheck();
  ok(await visible(dlg.getByText("2 of 3 selected")), "untick one");
  await dlg.getByRole("button", { name: "Move 2 students" }).click();
  ok(await visible(fb.locator(".toast", { hasText: "Moved 2 students to Evening." })), "move confirmed");
  ok(await visible(fb.locator(".toast", { hasText: /Roll numbers already used in Evening/ })), "roll number clash explained");
  await sleep(500);
  ok((await fb.locator(".batch-card", { hasText: "Evening" }).locator(".batch-stats").innerText()).startsWith("3"), "Evening now has 3 students");
  fb.once("dialog", (d) => d.accept());
  await fb.locator(".batch-card", { hasText: "Morning" }).getByRole("button", { name: "Delete Morning" }).click();
  ok(await visible(fb.locator(".toast", { hasText: 'Batch "Morning" deleted.' })), "delete batch");

  ok(!errors.length, `no browser errors (${errors.slice(0, 3).join(" | ")})`);
} finally {
  await browser.close();
}
console.log(`\n${fail ? "✗" : "✓"} ${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
