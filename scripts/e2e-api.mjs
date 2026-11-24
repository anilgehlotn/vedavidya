// End-to-end API test: exercises every endpoint, the full 50-student flow, and security rules.
// Needs: API on $API (default http://localhost:4300), seeded demo data, and the mock Claude server.
// Usage: node scripts/e2e-api.mjs
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(new URL("../server/package.json", import.meta.url));
const sharp = require("sharp");
const API = process.env.API ?? "http://localhost:4300/api";
const DATA_DIR = process.env.DATA_DIR;
const N = Number(process.env.STUDENTS ?? 50);

let pass = 0, fail = 0;
const failures = [];
const ok = (cond, msg) => { if (cond) pass++; else { fail++; failures.push(msg); console.log("  ✗", msg); } };
const section = (t) => console.log(`\n▸ ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, p, { token, body, form, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(API + p, { method, headers, body: form ?? (raw ?? (body !== undefined ? JSON.stringify(body) : undefined)) });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}
const expect = async (label, status, method, p, opts) => {
  const r = await call(method, p, opts);
  ok(r.status === status, `${label}: expected ${status}, got ${r.status} ${typeof r.data === "object" ? JSON.stringify(r.data).slice(0, 160) : String(r.data).slice(0, 80)}`);
  return r;
};
const login = async (identifier, password) => (await call("POST", "/auth/login", { body: { identifier, password } })).data.token;

async function jpeg(w, h, label, quality = 92) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#fffef8"/>
    ${Array.from({ length: 40 }, (_, i) => `<line x1="0" x2="${w}" y1="${60 + i * (h / 42)}" y2="${60 + i * (h / 42)}" stroke="#cfdcee" stroke-width="3"/>`).join("")}
    <text x="80" y="140" font-size="${Math.round(w / 30)}" fill="#223">${label}</text></svg>`;
  // Add noise so the JPEG is realistically large (like a phone photo).
  const noise = await sharp({ create: { width: w, height: h, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 40 } } }).png().toBuffer();
  return sharp(Buffer.from(svg)).composite([{ input: noise, blend: "soft-light" }]).jpeg({ quality }).toBuffer();
}
const pdf = () => Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

async function poll(fn, until, ms = 240000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (until(v)) return v; await sleep(700); }
  return await fn();
}

const stamp = Date.now().toString(36);

// ----------------------------------------------------------------------------------------------
section("Public endpoints & headers");
{
  const h = await expect("health", 200, "GET", "/health");
  ok(h.headers.get("x-content-type-options") === "nosniff", "security header nosniff");
  ok(h.headers.get("x-frame-options") === "DENY", "security header frame deny");
  ok(!h.headers.get("x-powered-by"), "x-powered-by hidden");
  const c = await expect("config", 200, "GET", "/config");
  ok(c.data.demo === true && c.data.signup === true, "config reports demo + signup");
  await expect("unknown api route, signed out → 401", 401, "GET", "/does-not-exist");
  await expect("no token → 401", 401, "GET", "/overview");
  await expect("bad token → 401", 401, "GET", "/overview", { token: "abc.def.ghi" });
  await expect("invalid json → 400", 400, "POST", "/auth/login", { raw: "{bad", body: undefined });
  await expect("contact form", 200, "POST", "/contact", { body: { first_name: "A", last_name: "B", phone: "9876543210", institute: "X", students: "100–500", email: "", message: "hi" } });
  await expect("contact validation", 400, "POST", "/contact", { body: { first_name: "" } });
}

section("Register a new institute (the real one)");
const adminEmail = `owner-${stamp}@example.com`;
const reg = await expect("register", 200, "POST", "/auth/register", { body: { institute: "Test Coaching Centre", city: "Kota", name: "Owner Admin", email: adminEmail, password: "s3cure-pass" } });
const admin = reg.data.token;
await expect("register duplicate email → 409", 409, "POST", "/auth/register", { body: { institute: "XY", name: "Y Z", email: adminEmail, password: "s3cure-pass" } });
await expect("register weak password → 400", 400, "POST", "/auth/register", { body: { institute: "X", name: "Y Z", email: `w-${stamp}@example.com`, password: "short" } });
const me = await expect("me", 200, "GET", "/me", { token: admin });
await expect("unknown api route, signed in → 404", 404, "GET", "/does-not-exist", { token: admin });
ok(me.data.user.role === "admin" && me.data.org.is_demo === 0, "me returns admin of non-demo org");

section("Settings → AI engine (Claude API key)");
{
  const s0 = await expect("ai status", 200, "GET", "/settings/ai", { token: admin });
  ok(s0.data.configured === false && s0.data.demo === false, "not configured initially");
  const gen0 = await expect("generate before key → 400", 400, "POST", "/papers/generate", { token: admin, body: { subject: "Maths", board: "CBSE", class_level: "10", topics: "Algebra", sections: [{ name: "A", type: "mcq", count: 2, marks_each: 1 }] } });
  ok(/API key/.test(gen0.data.error), "clear 'no API key' message");
  await expect("key wrong format → 400", 400, "PUT", "/settings/ai", { token: admin, body: { key: "hello-this-is-not-a-key-at-all" } });
  const bad = await expect("key rejected by Claude → 400", 400, "PUT", "/settings/ai", { token: admin, body: { key: "sk-ant-api03-wrongwrongwrongwrong" } });
  ok(/rejected/i.test(bad.data.error), "rejected key message");
  const KEY = "sk-ant-test-valid-abcdefghijklmnop1234";
  const s1 = await expect("save valid key", 200, "PUT", "/settings/ai", { token: admin, body: { key: KEY } });
  ok(s1.data.configured === true && s1.data.hint === "…1234", "configured with hint");
  const s2 = await expect("ai status after", 200, "GET", "/settings/ai", { token: admin });
  ok(!JSON.stringify(s2.data).includes("abcdefghij"), "key never returned to the browser");
  await expect("test connection", 200, "POST", "/settings/ai/test", { token: admin, body: {} });
  if (DATA_DIR) {
    const db = new DatabaseSync(path.join(DATA_DIR, "vedavidya.db"));
    const row = db.prepare("SELECT claude_key_enc FROM orgs WHERE id = ?").get(me.data.org.id);
    ok(row.claude_key_enc && !row.claude_key_enc.includes("abcdefghij"), "key stored encrypted in the database");
    db.close();
  }
}

section("Demo institute is locked down");
const demoAdmin = await login("admin@demo.school", "demo1234");
{
  ok(Boolean(demoAdmin), "demo admin login");
  await expect("demo can't save a key", 403, "PUT", "/settings/ai", { token: demoAdmin, body: { key: "sk-ant-test-valid-xxxxxxxxxxxxxxxxxxxx" } });
  const g = await expect("demo can't generate", 400, "POST", "/papers/generate", { token: demoAdmin, body: { subject: "Maths", board: "CBSE", class_level: "10", topics: "Algebra", sections: [{ name: "A", type: "mcq", count: 2, marks_each: 1 }] } });
  ok(/demo/i.test(g.data.error), "demo message");
}

section("Institute setup: centre, batch, staff");
const centre = (await expect("create centre", 200, "POST", "/centres", { token: admin, body: { name: "Main Campus", city: "Kota" } })).data.id;
const teacherRes = await expect("create teacher", 200, "POST", "/teachers", { token: admin, body: { name: "Tara Teacher", email: `teacher-${stamp}@example.com`, subject: "Maths", role: "teacher" } });
await expect("duplicate teacher email → 409", 409, "POST", "/teachers", { token: admin, body: { name: "Dup", email: `teacher-${stamp}@example.com` } });
const teacher = await login(teacherRes.data.email, teacherRes.data.password);
ok(Boolean(teacher), "teacher can log in with generated password");
const teachers = await expect("list staff", 200, "GET", "/teachers", { token: admin });
const teacherId = teachers.data.find((t) => t.email === teacherRes.data.email).id;
const batch = (await expect("create batch", 200, "POST", "/batches", { token: admin, body: { name: "JEE 2027 A", course: "JEE", centre_id: centre, teacher_id: teacherId } })).data.id;
const batch2 = (await expect("create batch 2", 200, "POST", "/batches", { token: admin, body: { name: "JEE 2027 B", course: "JEE", centre_id: centre } })).data.id;
await expect("update batch", 200, "PUT", `/batches/${batch2}`, { token: admin, body: { name: "JEE 2027 B (renamed)", course: "JEE", centre_id: centre } });
await expect("teacher can't create centre", 403, "POST", "/centres", { token: teacher, body: { name: "X" } });
await expect("teacher can't add staff", 403, "POST", "/teachers", { token: teacher, body: { name: "X", email: "x@x.com" } });
await expect("centres list", 200, "GET", "/centres", { token: teacher });
await expect("batches list", 200, "GET", "/batches", { token: teacher });

section(`Bulk add ${N} students`);
let creds;
{
  const rows = ["name,roll,phone,email,parent_phone"];
  for (let i = 1; i <= N; i++) rows.push(`Student ${i},${i},98${String(70000000 + i)},s${i}-${stamp}@example.com,97${String(60000000 + i)}`);
  rows.push(`Duplicate Email,${N + 1},9800000000,s1-${stamp}@example.com,`);
  const r = await expect("bulk add", 200, "POST", "/students/bulk", { token: teacher, body: { batch_id: batch, csv: rows.join("\n") } });
  ok(r.data.created.length === N, `created ${N} students (got ${r.data.created.length})`);
  ok(r.data.skipped.length === 1 && /already used/.test(r.data.skipped[0].reason), "duplicate email row skipped with reason");
  ok(new Set(r.data.created.map((c) => c.username)).size === N, "all usernames unique");
  creds = r.data.created;
  const list = await expect("list students in batch", 200, "GET", `/students?batch_id=${batch}`, { token: teacher });
  ok(list.data.length === N, `batch has ${N} students`);
  await expect("bulk add to unknown batch → 400", 400, "POST", "/students/bulk", { token: teacher, body: { batch_id: "bat_nope", csv: "A,1" } });
  // A second batch with overlapping roll numbers (ambiguity check for bulk upload).
  await expect("bulk add batch 2", 200, "POST", "/students/bulk", { token: admin, body: { batch_id: batch2, csv: "Other One,1\nOther Two,2" } });
  const one_ = await expect("add one student", 200, "POST", "/students", { token: admin, body: { name: "Solo Student", batch_id: batch2, roll_no: "3" } });
  await expect("edit student", 200, "PUT", `/students/${one_.data.id}`, { token: admin, body: { name: "Solo Student Edited", batch_id: batch2, roll_no: "3" } });
  await expect("reset student password", 200, "POST", `/students/${one_.data.id}/reset-password`, { token: admin, body: {} });
}
const studentTok = await login(creds[0].username, creds[0].password);
ok(Boolean(studentTok), "student logs in with generated credentials");

section("Question papers");
let aiPaper;
{
  const g = await expect("generate paper (AI)", 200, "POST", "/papers/generate", { token: teacher, body: {
    subject: "Mathematics", board: "CBSE", class_level: "Class 10", topics: "Algebra, Trigonometry", language: "English", difficulty: "mixed", duration_min: 60,
    sections: [{ name: "Section A", type: "mcq", count: 5, marks_each: 1, negative_marks: 0 }, { name: "Section B", type: "short", count: 3, marks_each: 3, negative_marks: 0 }, { name: "Section C", type: "long", count: 2, marks_each: 5, negative_marks: 0 }] } });
  const done = await poll(() => call("GET", `/papers/${g.data.id}`, { token: teacher }).then((r) => r.data), (p) => p.status !== "generating");
  ok(done.status === "draft", `generated paper is draft (got ${done.status} ${done.error ?? ""})`);
  ok(done.sections?.length === 3 && done.sections.flatMap((s) => s.questions).length === 10, "paper has 3 sections / 10 questions");
  ok(done.total_marks === 5 + 9 + 10, `total marks 24 (got ${done.total_marks})`);
  aiPaper = done;
  await expect("approve paper", 200, "POST", `/papers/${done.id}/approve`, { token: teacher, body: {} });
  const clone = await expect("clone paper", 200, "POST", `/papers/${done.id}/clone`, { token: teacher, body: {} });
  const edited = { ...done, title: "Edited copy" };
  await expect("edit paper", 200, "PUT", `/papers/${clone.data.id}`, { token: teacher, body: { title: edited.title, duration_min: 60, sections: done.sections } });
  await expect("edit paper invalid → 400", 400, "PUT", `/papers/${clone.data.id}`, { token: teacher, body: { title: "x", duration_min: 60, sections: [{ name: "A", questions: [{ id: "q1" }] }] } });
  await expect("delete paper", 200, "DELETE", `/papers/${clone.data.id}`, { token: teacher });
  await expect("list papers", 200, "GET", "/papers", { token: teacher });
  const empty = await expect("blank paper", 200, "POST", "/papers", { token: teacher, body: { title: "Empty", duration_min: 30, sections: [{ name: "A", instructions: "", questions: [] }] } });
  await expect("test from empty paper → 400", 400, "POST", "/tests", { token: teacher, body: { title: "X", paper_id: empty.data.id, mode: "offline", batch_ids: [batch] } });
}

section(`Offline test for ${N} students: bulk upload`);
const test = (await expect("create test", 200, "POST", "/tests", { token: teacher, body: { title: "Unit Test 1", paper_id: aiPaper.id, mode: "offline", batch_ids: [batch] } })).data.id;
let detail = (await expect("test detail", 200, "GET", `/tests/${test}`, { token: teacher })).data;
ok(detail.attempts.length === N, `${N} attempts created`);
ok(detail.batch_names === "JEE 2027 A", "batch names included");
{
  // Big phone-like photos (some over 5 MB) and a PDF, named by roll number with page numbers.
  // A worst-case 12 MP phone photo: fine detail everywhere makes the JPEG very large.
  const big = await sharp({ create: { width: 4032, height: 3024, channels: 3, noise: { type: "gaussian", mean: 150, sigma: 70 } } }).jpeg({ quality: 100 }).toBuffer();
  ok(big.length > 5 * 1024 * 1024, `test photo is realistically large (${(big.length / 1048576).toFixed(1)} MB)`);
  const small = await jpeg(1200, 1600, "Page");
  const files = [];
  for (let i = 1; i <= N; i++) {
    if (i % 10 === 0) files.push([`${i}.pdf`, pdf(), "application/pdf"]);
    else if (i % 7 === 0) files.push([`Roll ${i} page 1.jpg`, big, "image/jpeg"], [`Roll ${i} page 2.jpg`, big, "image/jpeg"]);
    else files.push([`${String(i).padStart(2, "0")}-1.jpg`, small, "image/jpeg"], [`${i}-2.jpg`, small, "image/jpeg"]);
  }
  files.push(["999.jpg", small, "image/jpeg"], ["notes.jpg", small, "image/jpeg"], [`${N}-9.jpg`, Buffer.from("not really an image"), "image/jpeg"]);
  // Upload in chunks, keeping each student's pages together (like the browser does).
  const byRoll = new Map();
  for (const f of files) { const k = (f[0].match(/^\D{0,8}?(\d+)/)?.[1] ?? f[0]); byRoll.set(String(Number(k) || k), [...(byRoll.get(String(Number(k) || k)) ?? []), f]); }
  const groups = [...byRoll.values()];
  let students = 0, pages = 0; const unmatched = [], warnings = [];
  for (let i = 0; i < groups.length; i += 8) {
    const form = new FormData();
    for (const g of groups.slice(i, i + 8)) for (const [name, buf, type] of g) form.append("files", new Blob([buf], { type }), name);
    const r = await expect(`bulk upload chunk ${i / 8 + 1}`, 200, "POST", `/tests/${test}/bulk-files`, { token: teacher, form });
    students += r.data.students; pages += r.data.pages; unmatched.push(...r.data.unmatched); warnings.push(...r.data.warnings);
  }
  ok(students === N, `all ${N} students received pages (got ${students})`);
  ok(unmatched.includes("999.jpg") && unmatched.includes("notes.jpg"), "unknown roll numbers reported as unmatched");
  ok(warnings.some((w) => w.includes(`${N}-9.jpg`)), "corrupt image rejected with a clear message");
  detail = (await call("GET", `/tests/${test}`, { token: teacher })).data;
  ok(detail.attempts.every((a) => a.status === "uploaded" && a.files >= 1), "every attempt is uploaded");
  if (DATA_DIR) {
    const db = new DatabaseSync(path.join(DATA_DIR, "vedavidya.db"));
    const names = db.prepare("SELECT files FROM attempts WHERE test_id = ?").all(test).flatMap((r) => JSON.parse(r.files));
    const sizes = names.filter((n) => n.endsWith(".jpg")).map((n) => fs.statSync(path.join(DATA_DIR, "uploads", n)).size);
    ok(sizes.every((s) => s < 4.6 * 1024 * 1024), `stored photos are under the 5 MB API limit (max ${(Math.max(...sizes) / 1048576).toFixed(2)} MB)`);
    db.close();
  }
  // Single-student re-upload (replace).
  const a0 = detail.attempts[0];
  const f1 = new FormData(); f1.append("files", new Blob([small], { type: "image/jpeg" }), "page.jpg");
  const up = await expect("single upload replace", 200, "POST", `/attempts/${a0.id}/files?replace=1`, { token: teacher, form: f1 });
  ok(up.data.pages === 1, "replace leaves exactly 1 page");
  const f2 = new FormData(); f2.append("files", new Blob([Buffer.from("hello")], { type: "image/png" }), "x.png");
  await expect("upload junk image → 400", 400, "POST", `/attempts/${a0.id}/files`, { token: teacher, form: f2 });
  const f3 = new FormData(); f3.append("files", new Blob([Buffer.from("text")], { type: "text/plain" }), "x.txt");
  await expect("upload wrong type → 400", 400, "POST", `/attempts/${a0.id}/files`, { token: teacher, form: f3 });
  const fileRes = await fetch(`${API}/attempts/${a0.id}/files/0?token=${teacher}`);
  ok(fileRes.status === 200 && fileRes.headers.get("content-type")?.includes("image"), "staff can view uploaded page");
}

section(`Evaluate all ${N} sheets (mock Claude with injected rate-limit errors)`);
{
  const t0 = Date.now();
  const q = await expect("start evaluation", 200, "POST", `/tests/${test}/evaluate`, { token: teacher, body: {} });
  ok(q.data.queued === N, `queued ${N} (got ${q.data.queued})`);
  const fin = await poll(() => call("GET", `/tests/${test}`, { token: teacher }).then((r) => r.data), (d) => d.attempts.every((a) => a.status !== "evaluating"), 600000);
  const evaluated = fin.attempts.filter((a) => a.status === "evaluated").length;
  const failed = fin.attempts.filter((a) => a.status === "failed");
  console.log(`  ${evaluated} evaluated, ${failed.length} failed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  ok(evaluated === N, `all ${N} evaluated despite injected errors (failed: ${failed.map((f) => f.error).join(" | ").slice(0, 200)})`);
  ok(fin.attempts.every((a) => a.score === null || (a.score <= a.max_score && a.score >= -100)), "no score above the maximum (clamping works)");
  const again = await expect("evaluate again (nothing new)", 200, "POST", `/tests/${test}/evaluate`, { token: teacher, body: {} });
  ok(again.data.queued === 0, "already-marked sheets are not re-marked (no double cost)");
  const re = await expect("re-evaluate one explicitly", 200, "POST", `/tests/${test}/evaluate`, { token: teacher, body: { attempt_ids: [fin.attempts[1].id] } });
  ok(re.data.queued === 1, "explicit re-evaluation queues 1");
  await poll(() => call("GET", `/attempts/${fin.attempts[1].id}`, { token: teacher }).then((r) => r.data), (a) => a.status === "evaluated");
  detail = (await call("GET", `/tests/${test}`, { token: teacher })).data;
}

section("Teacher review, publish, reports");
{
  const att = detail.attempts[2];
  const full = (await expect("attempt detail", 200, "GET", `/attempts/${att.id}`, { token: teacher })).data;
  ok(full.evaluation?.questions?.length === 10, "evaluation has every question");
  const qid = full.evaluation.questions[0].question_id;
  const edit = await expect("override a mark", 200, "PUT", `/attempts/${att.id}/evaluation`, { token: teacher, body: { questions: [{ question_id: qid, marks_awarded: 999 }] } });
  const after = (await call("GET", `/attempts/${att.id}`, { token: teacher })).data;
  ok(after.evaluation.questions[0].marks_awarded === after.evaluation.questions[0].max_marks, "override clamped to max marks");
  ok(after.reviewed === 1 && edit.data.score === after.score, "reviewed flag + score updated");
  await expect("student can't see before publish", 403, "GET", `/attempts/${detail.attempts.find((a) => a.student_name === "Student 1").id}`, { token: studentTok });
  await expect("publish", 200, "POST", `/tests/${test}/publish`, { token: teacher, body: { publish: true } });
  detail = (await call("GET", `/tests/${test}`, { token: teacher })).data;
  ok(detail.attempts.every((a) => a.share_token), "every student has a parent report link");
  const rep = await expect("public parent report", 200, "GET", `/public/report/${detail.attempts[3].share_token}`);
  ok(rep.data.rank >= 1 && rep.data.student_name, "report has rank and name");
  await expect("bad report token → 404", 404, "GET", "/public/report/nope");
  const my = await expect("student my tests", 200, "GET", "/my/tests", { token: studentTok });
  const mine = my.data.find((t) => t.id === test);
  ok(mine && mine.results_published && mine.score !== null, "student sees published score");
  await expect("student sees own answers", 200, "GET", `/attempts/${mine.attempt_id}`, { token: studentTok });
  await expect("student can't see others' answers", 403, "GET", `/attempts/${detail.attempts.find((a) => a.student_name === "Student 2").id}`, { token: studentTok });
  const csv = await fetch(`${API}/tests/${test}/results.csv?token=${teacher}`);
  const csvText = await csv.text();
  ok(csv.status === 200 && csvText.split("\n").length === N + 1, `CSV export has ${N} rows`);
  await expect("unpublish", 200, "POST", `/tests/${test}/publish`, { token: teacher, body: { publish: false } });
  await expect("report hidden after unpublish", 404, "GET", `/public/report/${detail.attempts[3].share_token}`);
  await expect("republish", 200, "POST", `/tests/${test}/publish`, { token: teacher, body: { publish: true } });
  const ba = await expect("batch analytics", 200, "GET", `/analytics/batch/${batch}`, { token: teacher });
  ok(ba.data.leaderboard.length === N && ba.data.topics.length > 0, "batch analytics has leaderboard + topics");
  const sa = await expect("student analytics (self)", 200, "GET", `/analytics/student/${creds[0].id}`, { token: studentTok });
  ok(sa.data.trend.length >= 1, "student report card has trend");
  await expect("student can't view others' analytics", 403, "GET", `/analytics/student/${creds[1].id}`, { token: studentTok });
  const ov = await expect("overview", 200, "GET", "/overview", { token: teacher });
  ok(ov.data.stats.students === N + 3 && ov.data.stats.sheets_evaluated === N, "overview counts");
  await expect("tests list", 200, "GET", "/tests", { token: teacher });
}

section("Upload an existing question paper (with answer key)");
{
  const img = await jpeg(1600, 2200, "Printed paper");
  const form = new FormData();
  form.append("paper", new Blob([img], { type: "image/jpeg" }), "page1.jpg");
  form.append("paper", new Blob([img], { type: "image/jpeg" }), "page2.jpg");
  form.append("key", new Blob([pdf()], { type: "application/pdf" }), "answer-key.pdf");
  form.append("subject", "Maths"); form.append("class_level", "10"); form.append("duration_min", "45");
  const r = await expect("import paper", 200, "POST", "/papers/import", { token: teacher, form });
  const done = await poll(() => call("GET", `/papers/${r.data.id}`, { token: teacher }).then((x) => x.data), (p) => p.status !== "generating");
  ok(done.status === "draft" && done.sections.flatMap((x) => x.questions).length === 4, `imported paper ready with 4 questions (got ${done.status} ${done.error ?? ""})`);
  ok(done.total_marks === 10 && done.duration_min === 45 && done.subject === "Maths", "imported paper keeps marks, duration, subject");
  const st = await fetch(API.replace("/api", "").replace(/:\d+$/, ":4999") + "/__stats").then((x) => x.json()).catch(() => null);
  if (st?.lastImport) ok(st.lastImport.pages === 3 && st.lastImport.hasKey, "Claude received 2 paper pages + 1 answer-key page");
  const leftovers = DATA_DIR ? fs.readdirSync(path.join(DATA_DIR, "uploads")).length : 0;
  const noKey = new FormData(); noKey.append("paper", new Blob([img], { type: "image/jpeg" }), "p.jpg");
  const r2 = await expect("import without answer key", 200, "POST", "/papers/import", { token: teacher, form: noKey });
  await poll(() => call("GET", `/papers/${r2.data.id}`, { token: teacher }).then((x) => x.data), (p) => p.status !== "generating");
  if (DATA_DIR) ok(fs.readdirSync(path.join(DATA_DIR, "uploads")).length <= leftovers, "uploaded paper photos are deleted after reading");
  await expect("import with no pages → 400", 400, "POST", "/papers/import", { token: teacher, form: new FormData() });
  const bad = new FormData(); bad.append("paper", new Blob([Buffer.from("nope")], { type: "image/jpeg" }), "x.jpg");
  await expect("import unreadable photo → 400", 400, "POST", "/papers/import", { token: teacher, form: bad });
  await expect("student can't import", 403, "POST", "/papers/import", { token: studentTok, form: new FormData() });
}

section(`All ${N} students log in at once and open their results`);
{
  const logins = await expect("batch logins", 200, "POST", "/students/reset-logins", { token: teacher, body: { batch_id: batch } });
  ok(logins.data.created.length === N && logins.data.created.every((c) => c.password.length === 8), `${N} fresh 8-character passwords`);
  await expect("student can't reset logins", 403, "POST", "/students/reset-logins", { token: studentTok, body: { batch_id: batch } });
  await expect("other institute can't reset logins", 404, "POST", "/students/reset-logins", { token: demoAdmin, body: { batch_id: batch } });
  const roster = (await call("GET", `/tests/${test}`, { token: teacher })).data.attempts;
  ok(roster.every((a) => "parent_phone" in a && "phone" in a), "roster includes phone numbers for WhatsApp");
  const t0 = Date.now();
  const times = [];
  const results = await Promise.all(logins.data.created.map(async (c) => {
    const s0 = Date.now();
    const tok = await login(c.username, c.password);
    if (!tok) return "login failed";
    const my = await call("GET", "/my/tests", { token: tok });
    const t = my.data.find?.((x) => x.id === test);
    if (!t || t.score == null) return "no published result";
    const att = await call("GET", `/attempts/${t.attempt_id}`, { token: tok });
    const rep = await call("GET", "/me", { token: tok });
    const card = await call("GET", `/analytics/student/${rep.data.user.id}`, { token: tok });
    times.push(Date.now() - s0);
    return att.status === 200 && att.data.evaluation?.questions?.length && card.status === 200 ? "ok" : `status ${att.status}/${card.status}`;
  }));
  const okCount = results.filter((r) => r === "ok").length;
  times.sort((a, b) => a - b);
  console.log(`  ${okCount}/${N} students saw their result · total ${Date.now() - t0} ms · slowest ${times.at(-1)} ms · median ${times[Math.floor(times.length / 2)]} ms`);
  ok(okCount === N, `all ${N} students logged in and saw marks + feedback (${[...new Set(results.filter((r) => r !== "ok"))].join(", ")})`);
  ok(times.at(-1) < 15000, "every student got their result within 15 s");
}

section("Online (CBT) test");
{
  const q = (id, i) => ({ id, type: "mcq", text: `Q${i}`, options: ["a", "b", "c", "d"], correct_option: 2, numeric_answer: null, marks: 4, negative_marks: 1, difficulty: "easy", topic: "T", solution: "c", rubric: [{ step: "answer", marks: 4 }] });
  const p = await expect("objective paper", 200, "POST", "/papers", { token: teacher, body: { title: "MCQ", duration_min: 30, sections: [{ name: "A", instructions: "", questions: [q("q1", 1), q("q2", 2), { ...q("q3", 3), type: "numeric", options: [], correct_option: null, numeric_answer: 7.5 }] }] } });
  await expect("CBT with subjective paper → 400", 400, "POST", "/tests", { token: teacher, body: { title: "Bad", paper_id: aiPaper.id, mode: "cbt", batch_ids: [batch] } });
  const cbt = (await expect("create CBT", 200, "POST", "/tests", { token: teacher, body: { title: "Mock", paper_id: p.data.id, mode: "cbt", batch_ids: [batch] } })).data.id;
  const start = await expect("student starts", 200, "POST", `/cbt/${cbt}/start`, { token: studentTok, body: {} });
  ok(!JSON.stringify(start.data).includes("correct_option") && !JSON.stringify(start.data).includes("solution"), "answers hidden from student");
  await expect("autosave", 200, "PUT", `/cbt/${cbt}/responses`, { token: studentTok, body: { responses: { q1: { answer: 2 } } } });
  await expect("submit", 200, "POST", `/cbt/${cbt}/submit`, { token: studentTok, body: { responses: { q1: { answer: 2 }, q2: { answer: 0 }, q3: { answer: 7.5 } } } });
  await expect("can't start again", 400, "POST", `/cbt/${cbt}/start`, { token: studentTok, body: {} });
  const sc = (await call("GET", `/tests/${cbt}`, { token: teacher })).data.attempts.find((a) => a.student_name === "Student 1");
  ok(sc.score === 4 - 1 + 4, `CBT scoring +4/-1 (got ${sc.score})`);
  const f = new FormData(); f.append("files", new Blob([Buffer.from("x")], { type: "image/jpeg" }), "1.jpg");
  await expect("no uploads on CBT", 400, "POST", `/tests/${cbt}/bulk-files`, { token: teacher, form: f });
  await expect("teacher can't use student CBT", 403, "POST", `/cbt/${cbt}/start`, { token: teacher, body: {} });
}

section("Security: roles");
{
  const staffOnly = [["GET", "/overview"], ["GET", "/students"], ["GET", "/tests"], ["GET", "/papers"], ["GET", `/tests/${test}`], ["POST", `/tests/${test}/evaluate`], ["POST", `/tests/${test}/publish`],
    ["GET", "/teachers"], ["GET", "/centres"], ["GET", "/batches"], ["GET", `/analytics/batch/${batch}`], ["POST", "/students"], ["POST", "/papers/generate"], ["GET", "/settings/ai"], ["POST", "/notices"]];
  for (const [m, p] of staffOnly) await expect(`student blocked: ${m} ${p}`, 403, m, p, { token: studentTok, body: m === "GET" ? undefined : {} });
  for (const [m, p] of [["PUT", "/settings/ai"], ["DELETE", "/settings/ai"], ["POST", "/centres"], ["POST", "/batches"], ["PUT", "/organisation"], ["DELETE", `/teachers/${teacherId}`]])
    await expect(`teacher blocked: ${m} ${p}`, 403, m, p, { token: teacher, body: m === "DELETE" ? undefined : { name: "x", key: "sk-ant-test-valid-xxxxxxxxxxxxxxxxxxxx" } });
  await expect("student sees notices", 200, "GET", "/notices", { token: studentTok });
  await expect("admin can't delete self", 400, "DELETE", `/teachers/${me.data.user.id}`, { token: admin });
}

section("Security: institutes are isolated");
{
  const demoTests = (await call("GET", "/tests", { token: demoAdmin })).data;
  ok(!demoTests.some((t) => t.id === test), "other institute's tests not listed");
  await expect("other org: test detail", 404, "GET", `/tests/${test}`, { token: demoAdmin });
  await expect("other org: attempt", 404, "GET", `/attempts/${detail.attempts[0].id}`, { token: demoAdmin });
  await expect("other org: evaluate", 404, "POST", `/tests/${test}/evaluate`, { token: demoAdmin, body: {} });
  await expect("other org: publish → 404", 404, "POST", `/tests/${test}/publish`, { token: demoAdmin, body: { publish: false } });
  ok((await call("GET", `/tests/${test}`, { token: teacher })).data.results_published === 1, "…and results stay published");
  await expect("other org: delete test", 404, "DELETE", `/tests/${test}`, { token: demoAdmin });
  await expect("other org: paper", 404, "GET", `/papers/${aiPaper.id}`, { token: demoAdmin });
  await expect("other org: student analytics", 404, "GET", `/analytics/student/${creds[0].id}`, { token: demoAdmin });
  await expect("other org: batch analytics", 404, "GET", `/analytics/batch/${batch}`, { token: demoAdmin });
  const fr = await fetch(`${API}/attempts/${detail.attempts[0].id}/files/0?token=${demoAdmin}`);
  ok(fr.status === 404, "other org can't download answer sheets");
  await expect("other org: edit student", 404, "PUT", `/students/${creds[0].id}`, { token: demoAdmin, body: { name: "Hacked", batch_id: batch } });
  await expect("other org: delete student", 404, "DELETE", `/students/${creds[0].id}`, { token: demoAdmin });
  const demoBatches = (await call("GET", "/batches", { token: demoAdmin })).data;
  await expect("move my student into other org's batch → 400", 400, "PUT", `/students/${creds[5].id}`, { token: admin, body: { name: "Student 6", batch_id: demoBatches[0].id } });
  await expect("batch with other org's teacher → 400", 400, "POST", "/batches", { token: admin, body: { name: "X", teacher_id: (await call("GET", "/teachers", { token: demoAdmin })).data[0].id } });
  await expect("notice to other org's batch → 400", 400, "POST", "/notices", { token: admin, body: { title: "x", body: "y", batch_id: demoBatches[0].id } });
  await expect("test for other org's batch → 400", 400, "POST", "/tests", { token: admin, body: { title: "X", paper_id: aiPaper.id, mode: "offline", batch_ids: [demoBatches[0].id] } });
}

section("Notices, settings, password");
{
  const n = await expect("post notice", 200, "POST", "/notices", { token: teacher, body: { title: "Test on Monday", body: "Bring pens", batch_id: batch } });
  const sn = await expect("student sees batch notice", 200, "GET", "/notices", { token: studentTok });
  ok(sn.data.some((x) => x.title === "Test on Monday"), "batch notice visible to student");
  await expect("update institute", 200, "PUT", "/organisation", { token: admin, body: { name: "Test Coaching Centre", city: "Kota" } });
  await expect("wrong current password", 400, "POST", "/auth/change-password", { token: admin, body: { current: "nope", next: "new-password-1" } });
  await expect("change password", 200, "POST", "/auth/change-password", { token: admin, body: { current: "s3cure-pass", next: "new-password-1" } });
  ok(Boolean(await login(adminEmail, "new-password-1")), "login with new password");
}

section("Cleanup removes answer-sheet files");
if (DATA_DIR) {
  const db = new DatabaseSync(path.join(DATA_DIR, "vedavidya.db"));
  const filesOf = (sql, id) => db.prepare(sql).all(id).flatMap((r) => JSON.parse(r.files));
  const s1files = filesOf("SELECT files FROM attempts WHERE student_id = ?", creds[4].id);
  await expect("delete student", 200, "DELETE", `/students/${creds[4].id}`, { token: admin });
  ok(s1files.length > 0 && s1files.every((f) => !fs.existsSync(path.join(DATA_DIR, "uploads", f))), "student's files deleted from disk");
  const tfiles = filesOf("SELECT files FROM attempts WHERE test_id = ?", test);
  await expect("delete test", 200, "DELETE", `/tests/${test}`, { token: teacher });
  ok(tfiles.length > 0 && tfiles.every((f) => !fs.existsSync(path.join(DATA_DIR, "uploads", f))), "test's files deleted from disk");
  db.close();
}

section("Remove key, rate limiting");
{
  await expect("remove key", 200, "DELETE", "/settings/ai", { token: admin });
  ok((await call("GET", "/settings/ai", { token: admin })).data.configured === false, "key removed");
  let limited = false;
  for (let i = 0; i < 12; i++) { const r = await call("POST", "/auth/login", { body: { identifier: adminEmail, password: "wrong" } }); if (r.status === 429) { limited = true; break; } }
  ok(limited, "repeated wrong passwords are rate limited");
}

console.log(`\n${fail ? "✗" : "✓"} ${pass} checks passed, ${fail} failed`);
if (fail) { console.log(failures.map((f) => " - " + f).join("\n")); process.exit(1); }
