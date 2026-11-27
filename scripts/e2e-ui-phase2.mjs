// Browser checks for Phase 2 screens: Settings credits panel, Platform page (super-admin), Courses card,
// and the teacher note when a teacher changes AI marks.
// Needs: the built web app served by the API (cd web && npm run build), mock Claude, a FRESH server started with
// SUPER_ADMIN_EMAILS=root-admin@example.com and PLATFORM_CLAUDE_KEY set (the mock accepts keys starting "sk-ant-test-valid").
// Usage: node scripts/e2e-ui-phase2.mjs     (SHOTS=dir to save screenshots)
import { createRequire } from "node:module";
import { uploadAll, waitProcessed } from "./upload-helper.mjs";
const require = createRequire(new URL("../server/package.json", import.meta.url));
const sharp = require("sharp");
const { chromium } = require("playwright");

const BASE = process.env.BASE ?? "http://localhost:4300";
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗", m); } };
const log = (m) => console.log(m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, p, { token, body } = {}) {
  const h = {}; if (token) h.Authorization = `Bearer ${token}`; if (body !== undefined) h["Content-Type"] = "application/json";
  const r = await fetch(API + p, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d };
}
async function poll(fn, done, tries = 150) { for (let i = 0; i < tries; i++) { const v = await fn(); if (done(v)) return v; await sleep(300); } return fn(); }
const s = Date.now().toString(36);

// ---------- Set-up through the API ----------
log("▸ Set-up: an institute on the platform key, a super-admin, a marked test");
const reg = await call("POST", "/auth/register", { body: { institute: `UI Academy ${s}`, city: "Pune", name: "UI Admin", email: `ui-admin-${s}@example.com`, password: "Ui-admin#2026" } });
ok(reg.status === 200, `register institute ${reg.status} ${JSON.stringify(reg.data).slice(0, 120)}`);
const admin = reg.data.token;
const rootEmail = "root-admin@example.com";
const rootReg = await call("POST", "/auth/register", { body: { institute: "Platform", name: "Platform Owner", email: rootEmail, password: "root-pass-123" } });
const root = rootReg.data.token ?? (await call("POST", "/auth/login", { body: { identifier: rootEmail, password: "root-pass-123" } })).data.token;
ok(Boolean(root), "super-admin can sign in");

const batch = (await call("POST", "/batches", { token: admin, body: { name: "Alpha", course: "10th CBSE" } })).data.id;
await call("POST", "/students/bulk", { token: admin, body: { batch_id: batch, csv: "Asha Rao,1\nBilal Khan,2" } });
const spec = { subject: "Maths", board: "CBSE", class_level: "Class 10", topics: "Algebra", language: "English", difficulty: "mixed", duration_min: 30, sections: [{ name: "A", type: "short", count: 2, marks_each: 4, negative_marks: 0 }] };
const gen = await call("POST", "/papers/generate", { token: admin, body: spec });
const paper = await poll(() => call("GET", `/papers/${gen.data.id}`, { token: admin }).then((x) => x.data), (p) => p.status !== "generating");
ok(paper.status === "draft", `paper generated (${paper.status} ${paper.error ?? ""})`);
const test = (await call("POST", "/tests", { token: admin, body: { title: `UI test ${s}`, paper_id: gen.data.id, mode: "offline", batch_ids: [batch], subject: "Maths" } })).data.id;
let td = (await call("GET", `/tests/${test}`, { token: admin })).data;
for (const a of td.attempts) {
  const img = await sharp({ create: { width: 600, height: 800, channels: 3, background: "#fff" } }).jpeg().toBuffer();
  await call("POST", `/attempts/${a.id}/files`, { token: admin, body: { upload_ids: await uploadAll(API, admin, [["s.jpg", img]], "student_sheet") } });
}
await waitProcessed(API, admin, test);
await call("POST", `/tests/${test}/evaluate`, { token: admin, body: {} });
td = await poll(() => call("GET", `/tests/${test}`, { token: admin }).then((x) => x.data), (d) => d.attempts.every((a) => a.status === "evaluated" || a.status === "failed"));
ok(td.attempts.every((a) => a.status === "evaluated"), `sheets marked (${td.attempts.map((a) => a.status).join(",")})`);
const credits = (await call("GET", "/credits", { token: admin })).data.balance.total;
ok(credits === 300 - 10 - 2, `credits after generating + marking 2 sheets: ${credits}`);

// ---------- Browser ----------
const browser = await chromium.launch();
const errors = [];
async function pageAs(token) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(BASE + "/login");
  await page.evaluate((t) => localStorage.setItem("vedavidya_token", t), token);
  return page;
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
const visible = (loc) => loc.first().waitFor({ state: "visible", timeout: 8000 }).then(() => true, () => false);

try {
  log("▸ Settings: credits panel");
  const p = await pageAs(admin);
  await p.goto(BASE + "/app/settings");
  ok(await visible(p.getByText("Credits available")), "credits panel is shown for an institute on the platform key");
  const panelText = await p.locator(".card", { has: p.getByText("Credits available") }).first().innerText();
  ok(panelText.includes(String(credits)), `panel shows the balance ${credits}`);
  ok(/Free this month/.test(panelText) && /Added by Veda Vidya/.test(panelText), "panel shows free and added buckets");
  ok(/Generating a question paper/.test(panelText) && /Marking an answer sheet/.test(panelText), "history lists the paper and the marking");
  await p.getByText("What things cost").click();
  ok(await visible(p.getByText(/\+1 per 8 pages over 8/)), "price list opens");
  await shot(p, "settings-credits");

  log("▸ Platform page (super-admin only)");
  ok(!(await p.getByRole("link", { name: "Platform" }).count()), "an institute admin has no Platform link");
  ok((await call("GET", "/admin/orgs", { token: admin })).status === 403, "an institute admin can't call the platform API");
  const r = await pageAs(root);
  await r.goto(BASE + "/app/platform");
  ok(await visible(r.getByRole("heading", { name: "Platform" })), "Platform page opens for the super-admin");
  ok(await visible(r.getByRole("link", { name: "Platform" })), "super-admin sees the Platform link");
  const row = r.locator("tr", { hasText: `UI Academy ${s}` });
  ok(await visible(row), "the new institute is listed");
  ok((await row.innerText()).includes(String(credits)), "its balance is shown");
  const answers = ["500", "Welcome credits"];
  r.on("dialog", (d) => d.accept(answers.shift()));
  await row.getByRole("button", { name: "Add credits" }).click();
  ok(await visible(r.getByText(`Added 500 credits for UI Academy ${s}.`)), "adding credits confirms");
  await sleep(500);
  ok((await row.innerText()).includes(String(credits + 500)), "the balance goes up by 500");
  const after = (await call("GET", "/credits", { token: admin })).data;
  ok(after.balance.paid === 500 && after.history.some((h) => h.kind === "grant" && h.note === "Welcome credits"), "the institute sees the grant with its note");
  await r.getByRole("button", { name: "Back up now" }).click();
  ok(await visible(r.getByText("Backup saved.")), "Back up now works");
  ok(await visible(r.locator("td", { hasText: /-manual\.db$/ })), "the new backup is listed");
  await shot(r, "platform");

  log("▸ Courses card");
  await p.goto(BASE + "/app/batches");
  const card = p.locator(".card", { hasText: "Courses & subjects" });
  ok(await visible(card), "Courses card is on the batches page");
  ok(await visible(card.getByText("10th CBSE")), "the batch's course was created automatically");
  ok(/1 batch · 2 students/.test(await card.innerText()), "the course counts its batch and students");
  ok(await visible(card.locator(".badge", { hasText: "Maths" })), "the test's subject was added to the course");
  await card.getByLabel("New course name").fill("II PUC Karnataka Board");
  await card.getByLabel("Board").fill("KSEAB");
  await card.getByRole("button", { name: "Add course" }).click();
  ok(await visible(card.getByText("II PUC Karnataka Board")), "a new course can be added");
  await card.getByLabel("Add subject to II PUC Karnataka Board").fill("Physics");
  await card.getByLabel("Add subject to II PUC Karnataka Board").press("Enter");
  ok(await visible(card.locator(".badge", { hasText: "Physics" })), "a subject can be added");
  const dlg = [];
  p.on("dialog", (d) => { dlg.push(d.message()); d.type() === "prompt" ? d.accept("II PUC Science") : d.accept(); });
  await card.locator(".course-row", { hasText: "II PUC Karnataka Board" }).getByRole("button", { name: "Rename" }).click();
  ok(await visible(card.getByText("II PUC Science")), "a course can be renamed");
  await card.getByRole("button", { name: "Remove Physics" }).click();
  await sleep(500);
  ok(!(await card.locator(".badge", { hasText: "Physics" }).count()), "a subject can be removed");
  await card.locator(".course-row", { hasText: "II PUC Science" }).getByRole("button", { name: "Delete" }).click();
  await sleep(500);
  ok(!(await card.getByText("II PUC Science").count()), "a course can be deleted");
  await card.getByLabel("New course name").fill("10th cbse");
  await card.getByRole("button", { name: "Add course" }).click();
  ok(await visible(card.locator(".error-box")), `a duplicate course name shows an error (${await card.locator(".error-box").first().innerText().catch(() => "none")})`);
  await shot(p, "courses");

  log("▸ Teacher note when changing AI marks");
  const att = td.attempts[0];
  const ev = (await call("GET", `/attempts/${att.id}`, { token: admin })).data;
  const q = ev.evaluation.questions[0];
  const newMarks = q.marks_awarded === q.max_marks ? q.max_marks - 1 : q.marks_awarded + 1;
  await p.goto(BASE + `/app/attempts/${att.id}`);
  const markInput = p.locator(`input[type=number]`).first();
  ok(await visible(markInput), "mark boxes are shown");
  ok(!(await p.getByPlaceholder(/Method is correct/).count()), "no note box before a mark changes");
  await markInput.fill(String(newMarks));
  const noteBox = p.getByPlaceholder(/Method is correct/);
  ok(await visible(noteBox), "a note box appears once the mark changes");
  await noteBox.fill("Units missing in the final answer");
  await shot(p, "teacher-note");
  await p.getByRole("button", { name: "Save changes" }).click();
  ok(await visible(p.getByText(/Saved - new total/)), "saving confirms the new total");
  ok(!(await p.getByPlaceholder(/Method is correct/).count()), "the note box closes after saving");
  const corr = (await call("GET", "/admin/corrections", { token: root })).data;
  const rows = corr.corrections ?? corr.rows ?? corr;
  const c = Array.isArray(rows) ? rows.find((x) => x.attempt_id === att.id && x.question_id === q.question_id) : null;
  ok(c && c.teacher_marks === newMarks && c.ai_marks === q.marks_awarded && c.teacher_note === "Units missing in the final answer", `correction logged with AI marks, teacher marks and note (${JSON.stringify(c).slice(0, 200)})`);
  const reloaded = (await call("GET", `/attempts/${att.id}`, { token: admin })).data.evaluation.questions[0];
  ok(reloaded.marks_awarded === newMarks && reloaded.teacher_note === "Units missing in the final answer", "the new mark and note are saved on the sheet");
  ok(!errors.length, `no browser errors (${errors.slice(0, 3).join(" | ")})`);
} finally {
  await browser.close();
}
console.log(`\n${fail ? "✗" : "✓"} ${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
