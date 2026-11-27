// End-to-end API test: exercises every endpoint, the full 50-student flow, and security rules.
// Needs: API on $API (default http://localhost:4300), seeded demo data, and the mock Claude server.
// Usage: node scripts/e2e-api.mjs
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { upload, uploadAll, waitProcessed, waitDocument } from "./upload-helper.mjs";

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
let admin = reg.data.token;
await expect("register duplicate email → 409", 409, "POST", "/auth/register", { body: { institute: "XY", name: "Y Z", email: adminEmail, password: "s3cure-pass" } });
await expect("register weak password → 400", 400, "POST", "/auth/register", { body: { institute: "X", name: "Y Z", email: `w-${stamp}@example.com`, password: "short" } });
const me = await expect("me", 200, "GET", "/me", { token: admin });
await expect("unknown api route, signed in → 404", 404, "GET", "/does-not-exist", { token: admin });
ok(me.data.user.role === "admin" && me.data.org.is_demo === 0, "me returns admin of non-demo org");

section("Settings → AI engine (Claude API key)");
{
  const s0 = await expect("ai status", 200, "GET", "/settings/ai", { token: admin });
  // With a platform key, a new institute can use AI at once (paid with credits); its own key is optional.
  ok(s0.data.own_key === false && s0.data.demo === false && s0.data.configured === Boolean(s0.data.platform_available), "no own key initially; AI available through the platform key");
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
  const g = await expect("demo can't generate", 403, "POST", "/papers/generate", { token: demoAdmin, body: { subject: "Maths", board: "CBSE", class_level: "10", topics: "Algebra", sections: [{ name: "A", type: "mcq", count: 2, marks_each: 1 }] } });
  ok(/demo/i.test(g.data.error), "demo message");
  await expect("demo can't add students", 403, "POST", "/students", { token: demoAdmin, body: { name: "X", batch_id: "x" } });
  await expect("demo can't post notices", 403, "POST", "/notices", { token: demoAdmin, body: { title: "x", body: "y" } });
  await expect("demo can't change password", 403, "POST", "/auth/change-password", { token: demoAdmin, body: { current: "demo1234", next: "hacked-pass-1" } });
  await expect("demo can still read", 200, "GET", "/tests", { token: demoAdmin });
}

section("A second, separate institute (for isolation checks)");
const otherAdmin = (await expect("register other institute", 200, "POST", "/auth/register", { body: { institute: "Other Institute", name: "Other Admin", email: `other-${stamp}@example.com`, password: "other-pass-1" } })).data.token;
await expect("other institute batch", 200, "POST", "/batches", { token: otherAdmin, body: { name: "Their Batch" } });

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
let studentTok = await login(creds[0].username, creds[0].password);
let logins;
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
  ok(done.sections.flatMap((s) => s.questions).every((q) => q.topic && q.subtopic && q.subtopic !== q.topic), "every generated question has a chapter and an exact sub-topic");
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
  // Each file is uploaded in resumable pieces (like the browser), then matched to students by roll number.
  const corrupt = files.pop();
  const bad = await upload(API, teacher, corrupt[1], corrupt[0], "student_sheet");
  ok(bad.status === 400 && /not a real photo|could not be read as an image/.test(bad.data?.error ?? ""), `corrupt image rejected at upload with a clear message (${bad.data?.error})`);
  const ids = await uploadAll(API, teacher, files.map(([n, b]) => [n, b]), "student_sheet");
  const r = await expect("match uploaded files to students", 200, "POST", `/tests/${test}/bulk-files`, { token: teacher, body: { upload_ids: ids } });
  ok(r.data.students === N, `all ${N} students received pages (got ${r.data.students})`);
  ok(r.data.unmatched.includes("999.jpg") && r.data.unmatched.includes("notes.jpg"), "unknown roll numbers reported as unmatched");
  await expect("upload ids can't be reused", 400, "POST", `/tests/${test}/bulk-files`, { token: teacher, body: { upload_ids: ids.slice(0, 1) } });
  detail = await waitProcessed(API, teacher, test);
  ok(detail.attempts.every((a) => a.status === "uploaded" && a.files >= 1), "every attempt is uploaded");
  if (DATA_DIR) {
    const db = new DatabaseSync(path.join(DATA_DIR, "vedavidya.db"));
    const names = db.prepare("SELECT files FROM attempts WHERE test_id = ?").all(test).flatMap((r) => JSON.parse(r.files));
    const sizes = names.filter((n) => n.endsWith(".jpg")).map((n) => fs.statSync(path.join(DATA_DIR, "uploads", n)).size);
    ok(sizes.every((s) => s < 4.6 * 1024 * 1024), `stored photos are under the 5 MB API limit (max ${(Math.max(...sizes) / 1048576).toFixed(2)} MB)`);
    const dims = db.prepare("SELECT count(*) n, sum(width > 0 AND height > 0) d FROM document_pages WHERE document_id IN (SELECT id FROM documents WHERE attempt_id IN (SELECT id FROM attempts WHERE test_id = ?))").get(test);
    ok(dims.n > 0 && dims.n === dims.d, `every page stored with its width and height (${dims.n} pages)`);
    db.close();
  }
  // Single-student re-upload (replace).
  const a0 = detail.attempts[0];
  const [one1] = await uploadAll(API, teacher, [["page.jpg", small]], "student_sheet");
  await expect("single student re-upload", 200, "POST", `/attempts/${a0.id}/files`, { token: teacher, body: { upload_ids: [one1] } });
  ok((await waitProcessed(API, teacher, test)).attempts.find((a) => a.id === a0.id).files === 1, "re-upload replaces the sheet with exactly 1 page");
  ok((await upload(API, teacher, Buffer.from("hello"), "x.png", "student_sheet")).status === 400, "upload junk image → 400");
  ok((await upload(API, teacher, Buffer.from("text"), "x.txt", "student_sheet")).status === 400, "upload wrong type → 400");
  await expect("attach without uploads → 400", 400, "POST", `/attempts/${a0.id}/files`, { token: teacher, body: { upload_ids: [] } });
  ok((await fetch(`${API}/attempts/${a0.id}/files/0?token=${teacher}`)).status === 401, "tokens in URLs are not accepted");
  const fileRes = await fetch(`${API}/attempts/${a0.id}/files/0`, { headers: { Authorization: `Bearer ${teacher}` } });
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
  const tooHigh = await expect("a mark above the maximum is rejected", 400, "PUT", `/attempts/${att.id}/evaluation`, { token: teacher, body: { questions: [{ question_id: qid, marks_awarded: 999 }] } });
  ok(/Question 1: marks must be between/.test(tooHigh.data.error), `clear message (${tooHigh.data.error})`);
  const maxQ = full.evaluation.questions[0].max_marks;
  const edit = await expect("override a mark", 200, "PUT", `/attempts/${att.id}/evaluation`, { token: teacher, body: { questions: [{ question_id: qid, marks_awarded: maxQ }] } });
  const after = (await call("GET", `/attempts/${att.id}`, { token: teacher })).data;
  ok(after.evaluation.questions[0].marks_awarded === maxQ, "override saved");
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
  const csv = await fetch(`${API}/tests/${test}/results.csv`, { headers: { Authorization: `Bearer ${teacher}` } });
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
  const paperIds = await uploadAll(API, teacher, [["page1.jpg", img], ["page2.jpg", img]], "paper");
  const keyIds = await uploadAll(API, teacher, [["answer-key.pdf", pdf()]], "answer_key");
  const r = await expect("import paper", 200, "POST", "/papers/import", { token: teacher, body: { paper_uploads: paperIds, key_uploads: keyIds, key_mode: "separate", subject: "Maths", class_level: "10", duration_min: 45 } });
  const done = await poll(() => call("GET", `/papers/${r.data.id}`, { token: teacher }).then((x) => x.data), (p) => p.status !== "generating");
  ok(done.status === "draft" && done.sections.flatMap((x) => x.questions).length === 4, `imported paper ready with 4 questions (got ${done.status} ${done.error ?? ""})`);
  ok(done.total_marks === 10 && done.duration_min === 45 && done.subject === "Maths", "imported paper keeps marks, duration, subject");
  const st = await fetch(API.replace("/api", "").replace(/:\d+$/, ":4999") + "/__stats").then((x) => x.json()).catch(() => null);
  if (st?.lastImport) ok(st.lastImport.pages === 3 && st.lastImport.hasKey, "Claude received 2 paper pages + 1 answer-key page");
  const noKeyIds = await uploadAll(API, teacher, [["p.jpg", img]], "paper");
  const r2 = await expect("import without answer key", 200, "POST", "/papers/import", { token: teacher, body: { paper_uploads: noKeyIds, key_mode: "auto" } });
  const p2 = await poll(() => call("GET", `/papers/${r2.data.id}`, { token: teacher }).then((x) => x.data), (p) => p.status !== "generating");
  ok(p2.status === "draft", "paper without a key is read (AI solves it)");
  await expect("import with no pages → 400", 400, "POST", "/papers/import", { token: teacher, body: { paper_uploads: [] } });
  await expect("separate key chosen but missing → 400", 400, "POST", "/papers/import", { token: teacher, body: { paper_uploads: await uploadAll(API, teacher, [["q.jpg", img]], "paper"), key_mode: "separate" } });
  ok((await upload(API, teacher, Buffer.from("nope"), "x.jpg", "paper")).status === 400, "unreadable photo rejected at upload");
  await expect("someone else's upload can't be used", 400, "POST", "/papers/import", { token: admin, body: { paper_uploads: await uploadAll(API, teacher, [["r.jpg", img]], "paper") } });
  await expect("student can't import", 403, "POST", "/papers/import", { token: studentTok, body: { paper_uploads: [] } });
}

section(`All ${N} students log in at once and open their results`);
{
  await expect("teacher can't reset a whole batch", 403, "POST", "/students/reset-logins", { token: teacher, body: { batch_id: batch } });
  logins = await expect("batch logins (admin)", 200, "POST", "/students/reset-logins", { token: admin, body: { batch_id: batch } });
  ok(logins.data.created.length === N && logins.data.created.every((c) => c.password.length === 8), `${N} fresh 8-character passwords`);
  await expect("other institute can't reset logins", 404, "POST", "/students/reset-logins", { token: otherAdmin, body: { batch_id: batch } });
  ok((await call("GET", "/my/tests", { token: studentTok })).status === 401, "old student session ends after the reset");
  studentTok = await login(logins.data.created[0].username, logins.data.created[0].password);
  await expect("student can't reset logins", 403, "POST", "/students/reset-logins", { token: studentTok, body: { batch_id: batch } });
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

section("Mistake analysis + Fix-it practice");
{
  const d = (await call("GET", `/tests/${test}`, { token: teacher })).data;
  const lostCount = d.attempts.filter((a) => a.score !== null && a.score < a.max_score).length;
  const ins0 = await poll(() => call("GET", `/tests/${test}/insights`, { token: teacher }).then((r) => r.data), (x) => x.practice.preparing === 0, 120000);
  ok(ins0.practice.students === lostCount && ins0.practice.failed === 0, `Fix-it created for every student who lost marks (${ins0.practice.students}/${lostCount})`);
  const types = Object.keys(ins0.mistakes);
  ok(types.length > 0 && types.every((t) => ["concept", "careless", "incomplete", "presentation", "not_attempted", "unclassified"].includes(t)), `class mistakes by type: ${types.join(", ")}`);
  ok(ins0.questions.length === 10 && ins0.questions.every((q) => q.avg_pct !== null), "per-question class averages");
  await expect("student can't see class insights", 403, "GET", `/tests/${test}/insights`, { token: studentTok });
  await expect("other institute can't see insights", 404, "GET", `/tests/${test}/insights`, { token: otherAdmin });

  // Re-teach brief
  await expect("create re-teach brief", 200, "POST", `/tests/${test}/brief`, { token: teacher, body: {} });
  const ins1 = await poll(() => call("GET", `/tests/${test}/insights`, { token: teacher }).then((r) => r.data), (x) => x.brief_status !== "generating", 60000);
  ok(ins1.brief_status === "ready" && ins1.brief?.misconceptions?.length > 0, "re-teach brief ready with misconceptions");
  await expect("student can't create a brief", 403, "POST", `/tests/${test}/brief`, { token: studentTok, body: {} });

  // A student's own practice
  const mine = (await call("GET", "/my/tests", { token: studentTok })).data.find((t) => t.id === test);
  const myAtt = (await call("GET", `/attempts/${mine.attempt_id}`, { token: studentTok })).data;
  ok(myAtt.evaluation.questions.every((q) => q.mistake_type), "every marked question has a mistake type");
  ok(myAtt.evaluation.questions.every((q) => (q.marks_awarded >= q.max_marks) === (q.mistake_type === "none")), "mistake type matches the marks");
  const sets = (await expect("my practice list", 200, "GET", "/my/practice", { token: studentTok })).data;
  const pr = sets.find((x) => x.kind === "practice" && x.test_id === test), ck = sets.find((x) => x.kind === "checkup" && x.test_id === test);
  if (myAtt.score < myAtt.max_score) {
    ok(pr && pr.status === "ready" && pr.count >= 5, "practice set ready with 5+ questions");
    ok(ck && ck.locked === true, "check-up is locked for a week");
    await expect("locked check-up can't be opened", 403, "GET", `/practice/${ck.id}`, { token: studentTok });
    const set = (await expect("open practice", 200, "GET", `/practice/${pr.id}`, { token: studentTok })).data;
    ok(set.questions.every((q) => q.answer === undefined && q.explanation === undefined), "answers stay hidden until the student answers");
    const other = await login(logins.data.created[1].username, logins.data.created[1].password);
    await expect("another student can't open my practice", 404, "GET", `/practice/${pr.id}`, { token: other });
    await expect("teacher can't answer student practice", 403, "POST", `/practice/${pr.id}/answer`, { token: teacher, body: { question_id: "p1", answer: 1 } });
    let right = 0;
    for (const [i, q] of set.questions.entries()) {
      const wrongOnPurpose = i === 0;
      const ans = q.type === "mcq" ? (wrongOnPurpose ? 0 : 2) : (wrongOnPurpose ? -1 : (i + 1) * 6);
      const r = await call("POST", `/practice/${pr.id}/answer`, { token: studentTok, body: { question_id: q.id, answer: ans } });
      if (r.status !== 200 || typeof r.data.explanation !== "string") { ok(false, `answer ${q.id}: ${r.status}`); break; }
      if (r.data.correct) right++;
      if (i === 0) {
        ok(r.data.correct === false && r.data.answer !== undefined, "wrong answer shows the right one and an explanation");
        await expect("can't answer the same question twice", 409, "POST", `/practice/${pr.id}/answer`, { token: studentTok, body: { question_id: q.id, answer: 2 } });
        if (q.type === "mcq") await expect("option out of range → 400", 400, "POST", `/practice/${pr.id}/answer`, { token: studentTok, body: { question_id: set.questions[1].id, answer: 9 } });
      }
    }
    const after = (await call("GET", `/practice/${pr.id}`, { token: studentTok })).data;
    ok(after.status === "done" && after.score === right && right === set.questions.length - 1, `practice completed and scored ${after.score}/${after.max_score}`);
    if (DATA_DIR) {
      const db = new DatabaseSync(path.join(DATA_DIR, "vedavidya.db"));
      db.prepare("UPDATE practice_sets SET available_at = '2000-01-01 00:00:00' WHERE id = ?").run(ck.id); db.close();
      const cks = (await expect("check-up unlocks after a week", 200, "GET", `/practice/${ck.id}`, { token: studentTok })).data;
      for (const [i, q] of cks.questions.entries()) await call("POST", `/practice/${ck.id}/answer`, { token: studentTok, body: { question_id: q.id, answer: q.type === "mcq" ? 2 : (i + 1) * 6 } });
      const ins2 = (await call("GET", `/tests/${test}/insights`, { token: teacher })).data;
      ok(ins2.practice.checkup_done === 1 && ins2.practice.checkup_avg === 100 && ins2.practice.baseline_avg !== null, `teacher sees improvement: ${ins2.practice.baseline_avg}% → ${ins2.practice.checkup_avg}%`);
      const card = (await call("GET", `/analytics/student/${myAtt.student_id}`, { token: studentTok })).data;
      ok(card.practice.completed >= 1 && card.practice.checkups_done === 1 && card.practice.after_pct === 100, "report card shows practice and check-up progress");
      ok(Object.keys(card.mistakes).length > 0, "report card shows where marks go");
    }
  }
  // Re-marking a sheet refreshes that student's practice
  const victim = d.attempts.find((a) => a.score !== null && a.score < a.max_score && a.student_name !== "Student 1");
  await call("POST", `/tests/${test}/evaluate`, { token: teacher, body: { attempt_ids: [victim.id] } });
  await poll(() => call("GET", `/attempts/${victim.id}`, { token: teacher }).then((r) => r.data), (a) => a.status === "evaluated", 60000);
  const ins3 = await poll(() => call("GET", `/tests/${test}/insights`, { token: teacher }).then((r) => r.data), (x) => x.practice.preparing === 0, 60000);
  ok(!ins3.practice.by_attempt[victim.id] || ins3.practice.by_attempt[victim.id].practice.status !== "generating", "re-marked sheet gets a fresh plan");
  // Unpublishing hides practice from students
  await call("POST", `/tests/${test}/publish`, { token: teacher, body: { publish: false } });
  ok(!(await call("GET", "/my/practice", { token: studentTok })).data.some((x) => x.test_id === test), "practice hidden while results are unpublished");
  await call("POST", `/tests/${test}/publish`, { token: teacher, body: { publish: true } });
  ok((await call("GET", "/my/practice", { token: studentTok })).data.some((x) => x.test_id === test), "practice back after re-publishing (not created twice)");
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
  const cbtUp = await uploadAll(API, teacher, [["1.jpg", await jpeg(400, 500, "x")]], "student_sheet");
  await expect("no uploads on CBT", 400, "POST", `/tests/${cbt}/bulk-files`, { token: teacher, body: { upload_ids: cbtUp } });
  await expect("teacher can't use student CBT", 403, "POST", `/cbt/${cbt}/start`, { token: teacher, body: {} });
  // This hand-made paper has no sub-topics: making a report fills them in once with AI.
  ok((await call("GET", `/papers/${p.data.id}`, { token: teacher })).data.sections[0].questions.every((q) => !q.subtopic), "hand-made paper starts without sub-topics");
  const rep = await fetch(`${API}/tests/${cbt}/class-report.pdf`, { headers: { Authorization: `Bearer ${teacher}` } });
  ok(rep.status === 200 && (await rep.arrayBuffer()).byteLength > 1000, "class report for the online test");
  // Tagging runs as a background job (never inside the report request): wait for it.
  const tagged = (await poll(() => call("GET", `/papers/${p.data.id}`, { token: teacher }).then((x) => x.data), (x) => x.sections[0].questions.every((q) => q.subtopic))).sections[0].questions;
  ok(rep.headers.get("content-type")?.includes("pdf"), "the report didn't wait for the AI");
  ok(tagged.every((q) => q.subtopic && q.topic === "T"), `missing sub-topics filled in, chapter kept (${tagged.map((q) => q.subtopic).join(" | ")})`);
  const edited = { title: "MCQ", duration_min: 30, sections: [{ name: "A", instructions: "", questions: tagged.map((q, i) => (i === 0 ? { ...q, subtopic: "Teacher's own name" } : q)) }] };
  await expect("teacher can rename a sub-topic", 200, "PUT", `/papers/${p.data.id}`, { token: teacher, body: edited });
  ok((await call("GET", `/papers/${p.data.id}`, { token: teacher })).data.sections[0].questions[0].subtopic === "Teacher's own name", "sub-topic edit saved");
}

section("Test first, paper later (guided flow)");
{
  const r = await expect("create test without a paper", 200, "POST", "/tests", { token: teacher, body: { title: "Physics test · 3 Dec", subject: "Physics", mode: "offline", scheduled_at: new Date().toISOString(), batch_ids: [batch2, batch] } });
  const tid = r.data.id;
  let d = (await expect("detail without paper", 200, "GET", `/tests/${tid}`, { token: teacher })).data;
  ok(d.paper === null && /question paper/i.test(d.paper_problem ?? ""), "detail says the paper is missing");
  ok(d.subject === "Physics" && d.attempts.length >= N, `subject saved, roster ready (${d.subject}, ${d.attempts.length})`);
  const row = (await call("GET", "/tests", { token: teacher })).data.find((t) => t.id === tid);
  ok(row && row.paper_id === null && row.subject === "Physics" && row.uploaded === 0, "list shows a test without a paper");
  ok((await call("GET", "/my/tests", { token: studentTok })).data.some((t) => t.id === tid && !t.paper_ready), "students see it before the paper is added");
  // Sheets can be uploaded before the paper (teachers often scan right after the exam).
  const a1 = d.attempts.find((a) => a.roll_no === "1");
  await expect("upload a sheet before the paper", 200, "POST", `/attempts/${a1.id}/files`, { token: teacher, body: { upload_ids: await uploadAll(API, teacher, [["s1.jpg", await jpeg(1000, 1400, "S1")]], "student_sheet") } });
  await waitProcessed(API, teacher, tid);
  const ev = await expect("marking without a paper → 400", 400, "POST", `/tests/${tid}/evaluate`, { token: teacher, body: {} });
  ok(/question paper/i.test(ev.data.error), "explains the paper is needed first");
  // Upload the printed paper from the test page: it is read in the background and attached at once.
  const imp = await expect("import paper", 200, "POST", "/papers/import", { token: teacher, body: { paper_uploads: await uploadAll(API, teacher, [["paper.jpg", await jpeg(1200, 1600, "Paper")]], "paper"), subject: "Physics" } });
  await expect("attach paper while it's being read", 200, "PUT", `/tests/${tid}/paper`, { token: teacher, body: { paper_id: imp.data.id } });
  d = (await call("GET", `/tests/${tid}`, { token: teacher })).data;
  if (d.paper?.status === "generating") {
    ok(/being read/.test(d.paper_problem ?? ""), "shows the paper is being read");
    ok((await call("POST", `/tests/${tid}/evaluate`, { token: teacher, body: {} })).status === 400, "marking waits for the paper");
  }
  for (let i = 0; i < 40 && d.paper?.status === "generating"; i++) { await sleep(300); d = (await call("GET", `/tests/${tid}`, { token: teacher })).data; }
  ok(d.paper?.status === "draft" && d.paper_problem === null, "paper ready");
  ok(d.attempts.every((a) => a.max_score === d.paper.total_marks), `max marks follow the paper once read (${d.paper.total_marks})`);
  await expect("other institute can't attach", 404, "PUT", `/tests/${tid}/paper`, { token: otherAdmin, body: { paper_id: imp.data.id } });
  const foreign = (await call("POST", "/papers", { token: otherAdmin, body: { title: "Theirs", duration_min: 30, sections: [{ name: "A", instructions: "", questions: [{ id: "q1", type: "short", text: "?", options: [], correct_option: null, numeric_answer: null, marks: 2, negative_marks: 0, difficulty: "easy", topic: "T", solution: "", rubric: [{ step: "a", marks: 2 }] }] }] } })).data.id;
  await expect("can't attach another institute's paper", 400, "PUT", `/tests/${tid}/paper`, { token: teacher, body: { paper_id: foreign } });
  // One scanned PDF for the class: processed on the server, then pages are given to students.
  const roster = d.attempts.filter((a) => a.batch_name === "JEE 2027 A").slice(0, 6);
  const { PDFDocument } = require("pdf-lib");
  const scan = await PDFDocument.create();
  for (let i = 0; i < 6; i++) scan.addPage([595, 842]);
  const classUp = await upload(API, teacher, Buffer.from(await scan.save()), "class-scan.pdf", "class_sheets", { chunk: 700 });
  ok(classUp.status === 200 && classUp.data.pages === 6, `class scan uploaded in small pieces (${classUp.data?.pages} pages)`);
  const sheet = await expect("send the class scan for processing", 200, "POST", `/tests/${tid}/sheets`, { token: teacher, body: { upload_id: classUp.data.id } });
  const doc = await waitDocument(API, teacher, sheet.data.document_id);
  ok(doc.status === "completed" && doc.pages.length === 6 && doc.pages.every((p) => p.width > 0 && p.height > 0), "class scan turned into 6 page images with sizes");
  ok((await call("GET", `/documents/${sheet.data.document_id}`, { token: otherAdmin })).status === 404, "other institute can't see the upload");
  ok((await fetch(`${API}/documents/${sheet.data.document_id}/pages/1`, { headers: { Authorization: `Bearer ${teacher}` } })).headers.get("content-type")?.includes("image"), "page thumbnail served");
  await expect("same page to two students → 400", 400, "POST", `/documents/${sheet.data.document_id}/assign`, { token: teacher, body: { assignments: [{ attempt_id: roster[0].id, pages: [1] }, { attempt_id: roster[1].id, pages: [1] }] } });
  await expect("page that doesn't exist → 400", 400, "POST", `/documents/${sheet.data.document_id}/assign`, { token: teacher, body: { assignments: [{ attempt_id: roster[0].id, pages: [9] }] } });
  const asg = await expect("give one page to each student", 200, "POST", `/documents/${sheet.data.document_id}/assign`, { token: teacher, body: { assignments: roster.map((a, i) => ({ attempt_id: a.id, pages: [i + 1] })) } });
  ok(asg.data.students === 6 && asg.data.pages === 6, "6 students got their pages");
  await expect("can't delete an upload whose pages are in use", 409, "DELETE", `/documents/${sheet.data.document_id}`, { token: teacher });
  const q = await expect("mark the class", 200, "POST", `/tests/${tid}/evaluate`, { token: teacher, body: {} });
  ok(q.data.queued === 6, `6 sheets queued (roll 1 replaced by split upload) (got ${q.data.queued})`);
  for (let i = 0; i < 80; i++) { d = (await call("GET", `/tests/${tid}`, { token: teacher })).data; if (!d.attempts.some((a) => a.status === "evaluating")) break; await sleep(400); }
  ok(d.attempts.filter((a) => a.status === "evaluated").length === 6, "class sheets marked");
  const swap = await expect("can't swap the paper after marking", 409, "PUT", `/tests/${tid}/paper`, { token: teacher, body: { paper_id: aiPaper.id } });
  ok(/already marked/.test(swap.data.error), "explains why");
  await expect("paper in use can't be deleted", 409, "DELETE", `/papers/${imp.data.id}`, { token: teacher });
  const sub = await expect("student analytics with the new test", 200, "GET", `/analytics/student/${d.attempts.find((a) => a.status === "evaluated").student_id}`, { token: teacher });
  ok(JSON.stringify(sub.data).includes("Physics"), "test subject used in analytics");
  // PDF reports
  const getPdf = async (p, token) => { const r = await fetch(API + p, { headers: token ? { Authorization: `Bearer ${token}` } : {} }); const b = Buffer.from(await r.arrayBuffer()); return { status: r.status, type: r.headers.get("content-type"), pdf: b.subarray(0, 5).toString() === "%PDF-", size: b.length, text: b.toString("latin1") }; };
  const cls = await getPdf(`/tests/${tid}/class-report.pdf`, teacher);
  ok(cls.status === 200 && cls.pdf && /application\/pdf/.test(cls.type), `class report PDF (${cls.status}, ${cls.size} bytes)`);
  const allPdf = await getPdf(`/tests/${tid}/reports.pdf`, teacher);
  ok(allPdf.status === 200 && allPdf.pdf && allPdf.size > cls.size / 2, `all student reports PDF (${allPdf.size} bytes)`);
  const markedA = d.attempts.find((a) => a.status === "evaluated");
  const one_ = await getPdf(`/attempts/${markedA.id}/report.pdf`, teacher);
  ok(one_.status === 200 && one_.pdf, "one student's report card PDF");
  ok((await getPdf(`/attempts/${d.attempts.find((a) => a.status === "pending").id}/report.pdf`, teacher)).status === 400, "unmarked sheet has no report yet");
  ok((await getPdf(`/tests/${tid}/class-report.pdf`, otherAdmin)).status === 404, "other institute can't download the class report");
  ok((await getPdf(`/attempts/${markedA.id}/report.pdf`, otherAdmin)).status === 404, "other institute can't download a report card");
  ok((await getPdf(`/tests/${tid}/class-report.pdf`, studentTok)).status === 403, "students can't download the class report");
  ok((await getPdf(`/tests/${tid}/class-report.pdf`)).status === 401, "class report needs a login");
  const meId = (await call("GET", "/me", { token: studentTok })).data.user?.id ?? (await call("GET", "/me", { token: studentTok })).data.id;
  const mine = d.attempts.find((a) => a.student_id === meId && a.status === "evaluated");
  const notMine = d.attempts.find((a) => a.student_id !== meId && a.status === "evaluated");
  if (mine) ok((await getPdf(`/attempts/${mine.id}/report.pdf`, studentTok)).status === 403, "student can't download before results are published");
  await expect("publish guided test", 200, "POST", `/tests/${tid}/publish`, { token: teacher, body: { publish: true, practice: false } });
  if (mine) ok((await getPdf(`/attempts/${mine.id}/report.pdf`, studentTok)).status === 200, "student downloads own report card after publishing");
  ok((await getPdf(`/attempts/${notMine.id}/report.pdf`, studentTok)).status === 403, "student can't download a classmate's report card");
  const share = (await call("GET", `/tests/${tid}`, { token: teacher })).data.attempts.find((a) => a.share_token);
  const pub = await getPdf(`/public/report/${share.share_token}/pdf`);
  ok(pub.status === 200 && pub.pdf, "parent link has a PDF");
  ok((await getPdf(`/public/report/not-a-token/pdf`)).status === 404, "bad parent link → 404");
  await expect("unpublish guided test", 200, "POST", `/tests/${tid}/publish`, { token: teacher, body: { publish: false } });
  ok((await getPdf(`/public/report/${share.share_token}/pdf`)).status === 404, "parent PDF hidden after unpublishing");

  // Online tests: students can't start until a ready objective paper is added.
  const c = (await expect("online test without paper", 200, "POST", "/tests", { token: teacher, body: { title: "Quiz", mode: "cbt", batch_ids: [batch] } })).data.id;
  const blocked = await expect("student can't start before the paper", 400, "POST", `/cbt/${c}/start`, { token: studentTok, body: {} });
  ok(/hasn't added/.test(blocked.data.error), "tells the student why");
  await expect("subjective paper on online test → 400", 400, "PUT", `/tests/${c}/paper`, { token: teacher, body: { paper_id: aiPaper.id } });
  await expect("delete test without paper", 200, "DELETE", `/tests/${c}`, { token: teacher });
}

section("Mixed models: routing, second check, cost meter");
{
  const st = (await expect("AI status", 200, "GET", "/settings/ai", { token: admin })).data;
  ok(st.mode === "mixed" && /opus/.test(st.models.paper) && /haiku/.test(st.models.marking) && /sonnet/.test(st.models.recheck), `mixed by default (${JSON.stringify(st.models)})`);
  const u = (await expect("usage", 200, "GET", "/settings/ai/usage", { token: teacher })).data;
  const keys = u.items.map((i) => `${i.task}:${i.model}`);
  ok(keys.some((k) => /^paper:claude-opus/.test(k)), "question papers used Opus");
  ok(keys.some((k) => /^marking:claude-haiku/.test(k)), "answer sheets marked with Haiku");
  ok(keys.some((k) => /^recheck:claude-sonnet/.test(k)), "doubtful answers re-checked with Sonnet");
  ok(!keys.some((k) => /^marking:claude-(opus|sonnet)/.test(k)), "no sheet marked with a pricier model in mixed mode");
  ok(u.total_usd > 0 && u.sheets_marked >= N && u.usd_per_sheet > 0, `cost meter: $${u.total_usd}, ${u.sheets_marked} sheets, $${u.usd_per_sheet}/sheet`);
  const ms = await (await fetch((process.env.MOCK_URL ?? "http://localhost:4999") + "/__stats")).json();
  ok(!ms.haikuWithFallback, "Haiku requests don't send the refusal-fallback option it doesn't support");
  // The second check leaves a trail on each re-checked answer.
  const marked = (await call("GET", `/tests/${test}`, { token: teacher })).data.attempts.filter((a) => a.status === "evaluated");
  let checked = 0, changed = 0, flagged = 0;
  for (const a of marked.slice(0, 15)) {
    const ev = (await call("GET", `/attempts/${a.id}`, { token: teacher })).data.evaluation;
    for (const q of ev.questions) {
      if (q.second_check) checked++;
      if (q.second_check === "changed") { changed++; ok(typeof q.first_marks === "number", "changed answers keep the first mark"); }
      if (q.needs_review) flagged++;
    }
  }
  ok(checked > 0, `answers were second-checked (${checked} checked, ${changed} changed, ${flagged} flagged in 15 sheets)`);
  const withChecks = marked.find((a) => a.checks > 0 && !a.reviewed);
  if (withChecks) {
    await expect("teacher confirms marks", 200, "PUT", `/attempts/${withChecks.id}/evaluation`, { token: teacher, body: { questions: [] } });
    ok((await call("GET", `/tests/${test}`, { token: teacher })).data.attempts.find((a) => a.id === withChecks.id).checks === 0, "flags clear once the teacher confirms");
  }
  // Switching mode
  await expect("teacher can't change mode", 403, "PUT", "/settings/ai/mode", { token: teacher, body: { mode: "opus" } });
  await expect("bad mode -> 400", 400, "PUT", "/settings/ai/mode", { token: admin, body: { mode: "gpt" } });
  const sw = await expect("admin switches to Sonnet", 200, "PUT", "/settings/ai/mode", { token: admin, body: { mode: "sonnet" } });
  ok(/sonnet/.test(sw.data.models.marking) && sw.data.models.recheck === null, "Sonnet mode: Sonnet marks, no second check");
  const target = marked[0];
  await expect("re-mark in Sonnet mode", 200, "POST", `/tests/${test}/evaluate`, { token: teacher, body: { attempt_ids: [target.id] } });
  for (let i = 0; i < 60; i++) {
    const a = (await call("GET", `/tests/${test}`, { token: teacher })).data.attempts.find((x) => x.id === target.id);
    if (a.status !== "evaluating") break;
    await sleep(300);
  }
  const u2 = (await call("GET", "/settings/ai/usage", { token: admin })).data;
  ok(u2.items.some((i) => i.task === "marking" && /sonnet/.test(i.model)), "marking now uses Sonnet");
  await expect("back to mixed", 200, "PUT", "/settings/ai/mode", { token: admin, body: { mode: "mixed" } });
  ok(!(await call("GET", "/settings/ai/usage", { token: otherAdmin })).data.items.length, "other institute sees no usage of ours");
}

section("Corrected answer sheet: pages, positions, access");
{
  const { PDFDocument } = require("pdf-lib");
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i++) doc.addPage([595, 842]);
  const three = Buffer.from(await doc.save());
  const det = (await call("GET", `/tests/${test}`, { token: teacher })).data;
  const target = det.attempts.find((a) => a.status === "evaluated");
  const up = await expect("upload a 3-page PDF sheet", 200, "POST", `/attempts/${target.id}/files`, { token: teacher, body: { upload_ids: await uploadAll(API, teacher, [["sheet.pdf", three]], "student_sheet") } });
  ok(up.data.pages === 3, `PDF has 3 pages (got ${up.data.pages})`);
  await waitProcessed(API, teacher, test);
  const at = (await call("GET", `/attempts/${target.id}`, { token: teacher })).data;
  ok(at.page_types.length === 3 && at.page_types.every((t) => t === "image"), "every page is an image the marks can be drawn on");
  await expect("re-mark it", 200, "POST", `/tests/${test}/evaluate`, { token: teacher, body: { attempt_ids: [target.id] } });
  let ev = null;
  for (let i = 0; i < 80; i++) { const x = (await call("GET", `/attempts/${target.id}`, { token: teacher })).data; if (x.status === "evaluated") { ev = x.evaluation; break; } await sleep(300); }
  ok(ev && ev.questions.every((q) => q.location && q.location.page >= 1 && q.location.page <= 3), "every answer has a position on one of the 3 pages");
  // Students see their own marked pages once results are published; never a classmate's.
  const meId = (await call("GET", "/me", { token: studentTok })).data.user.id;
  const all_ = (await call("GET", `/tests/${test}`, { token: teacher })).data.attempts;
  const mine = all_.find((a) => a.student_id === meId && a.files > 0);
  const other = all_.find((a) => a.student_id !== meId && a.files > 0);
  if (mine) ok((await fetch(`${API}/attempts/${mine.id}/files/0`, { headers: { Authorization: `Bearer ${studentTok}` } })).status === 200, "student opens own marked page");
  ok((await fetch(`${API}/attempts/${other.id}/files/0`, { headers: { Authorization: `Bearer ${studentTok}` } })).status === 404, "student can't open a classmate's page");
  ok((await fetch(`${API}/attempts/${other.id}/files/0`, { headers: { Authorization: `Bearer ${otherAdmin}` } })).status === 404, "other institute can't open pages");
  const share = all_.find((a) => a.share_token && a.files > 0);
  ok((await fetch(`${API}/public/report/${share.share_token}/files/0`)).status === 200, "parent link opens the marked page");
  // The answer key is hidden from students and parents while another unpublished test uses the same paper.
  const pubBefore = (await call("GET", `/public/report/${share.share_token}`)).data;
  ok(pubBefore.answers_hidden === false && pubBefore.sections.flatMap((x) => x.questions).some((q) => q.solution), "solutions shown when the paper isn't used elsewhere");
  const reuse = (await expect("same paper, another batch (unpublished)", 200, "POST", "/tests", { token: teacher, body: { title: "Unit Test 1 - B", paper_id: aiPaper.id, mode: "offline", batch_ids: [batch2] } })).data.id;
  const pubAfter = (await call("GET", `/public/report/${share.share_token}`)).data;
  ok(pubAfter.answers_hidden === true && !pubAfter.sections.flatMap((x) => x.questions).some((q) => q.solution || q.correct_option != null || q.rubric.length), "answer key hidden while another batch still has to take it");
  if (mine) ok((await call("GET", `/attempts/${mine.id}`, { token: studentTok })).data.paper.answers_hidden === true, "same rule for the student");
  ok((await call("GET", `/attempts/${target.id}`, { token: teacher })).data.paper.sections[0].questions[0].solution, "teachers always see solutions");
  await expect("remove the reuse test", 200, "DELETE", `/tests/${reuse}`, { token: teacher });
}

section("Uploads: checks in the server, resume, cancel");
{
  const big = await upload(API, teacher, Buffer.alloc(10), "big.pdf", "paper");
  ok(big.status === 400, "too-small fake PDF rejected");
  const r1 = await call("POST", "/uploads", { token: teacher, body: { filename: "huge.pdf", size: 51 * 1048576, purpose: "paper" } });
  ok(r1.status === 400 && /50 MB/.test(r1.data.error), `question paper over 50 MB rejected (${r1.data.error})`);
  const r2 = await call("POST", "/uploads", { token: teacher, body: { filename: "scan.zip", size: 1000, purpose: "paper" } });
  ok(r2.status === 400, "ZIP not accepted for a question paper");
  const r3 = await call("POST", "/uploads", { token: teacher, body: { filename: "notes.docx", size: 1000, purpose: "student_sheet" } });
  ok(r3.status === 400 && /isn't a supported file/.test(r3.data.error), "wrong file type rejected with a clear message");
  ok((await call("POST", "/uploads", { token: studentTok, body: { filename: "a.pdf", size: 10, purpose: "paper" } })).status === 403, "students can't upload");
  // Page limit: 51 pages for a question paper.
  const { PDFDocument } = require("pdf-lib");
  const many = await PDFDocument.create(); for (let i = 0; i < 51; i++) many.addPage([200, 200]);
  const tooMany = await upload(API, teacher, Buffer.from(await many.save()), "long.pdf", "paper");
  ok(tooMany.status === 400 && /51 pages/.test(tooMany.data?.error ?? ""), `51-page paper rejected (${tooMany.data?.error})`);
  // Password-protected, edit-restricted (readable), damaged and disguised files.
  const fx = (n) => fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url));
  const locked = await upload(API, teacher, fx("password-protected.pdf"), "locked.pdf", "paper");
  ok(locked.status === 400 && /password-protected/.test(locked.data?.error ?? ""), `password-protected PDF rejected (${locked.data?.error})`);
  const restricted = await upload(API, teacher, fx("edit-restricted.pdf"), "restricted.pdf", "paper");
  ok(restricted.status === 200 && restricted.data.pages === 1, "PDF with only edit restrictions is accepted (it can be read)");
  const damaged = await upload(API, teacher, Buffer.from("%PDF-1.4\\n garbage\\n%%EOF"), "broken.pdf", "paper");
  ok(damaged.status === 400 && /damaged/.test(damaged.data?.error ?? ""), "damaged PDF rejected with a clear message");
  const fake = await upload(API, teacher, await jpeg(300, 300, "x"), "photo.pdf", "paper");
  ok(fake.status === 400 && /not really a PDF/.test(fake.data?.error ?? ""), "a photo renamed to .pdf is caught");
  // Resume: a piece sent at the wrong offset is told where to continue; the finished file is intact.
  const body = Buffer.from(await many.save());
  const st = (await call("POST", "/uploads", { token: teacher, body: { filename: "resume.pdf", size: body.length, purpose: "class_sheets" } })).data;
  const put = (o, b) => fetch(`${API}/uploads/${st.id}?offset=${o}`, { method: "PUT", headers: { Authorization: `Bearer ${teacher}`, "Content-Type": "application/octet-stream" }, body: b });
  await put(0, body.subarray(0, 1000));
  const again = await put(0, body.subarray(0, 1000));
  ok(again.status === 409 && (await again.json()).received === 1000, "repeated piece → 409 with the position to resume from");
  ok((await call("GET", `/uploads/${st.id}`, { token: teacher })).data.received === 1000, "server reports how much arrived");
  ok((await call("POST", `/uploads/${st.id}/complete`, { token: teacher })).status === 400, "can't finish a half-sent file");
  await put(1000, body.subarray(1000));
  const fin = await call("POST", `/uploads/${st.id}/complete`, { token: teacher });
  ok(fin.status === 200 && fin.data.pages === 51, "resumed upload completes with all 51 pages");
  ok((await call("GET", `/uploads/${st.id}`, { token: admin })).status === 404, "uploads are private to the person who started them");
  // Cancel
  const c = (await call("POST", "/uploads", { token: teacher, body: { filename: "c.pdf", size: 5000, purpose: "paper" } })).data;
  await expect("cancel an upload", 200, "DELETE", `/uploads/${c.id}`, { token: teacher });
  const afterCancel = await fetch(`${API}/uploads/${c.id}?offset=0`, { method: "PUT", headers: { Authorization: `Bearer ${teacher}`, "Content-Type": "application/octet-stream" }, body: Buffer.alloc(10) });
  ok(afterCancel.status === 404, "a cancelled upload takes no more data");
  // ZIP of sheets for a class
  if (DATA_DIR) {
    const tmp = fs.mkdtempSync(path.join(DATA_DIR, "zt"));
    for (const n of [1, 2]) fs.writeFileSync(path.join(tmp, `${n}.jpg`), await jpeg(600, 800, `Z${n}`));
    fs.writeFileSync(path.join(tmp, "readme.txt"), "ignore me");
    require("node:child_process").execFileSync("zip", ["-q", "-j", path.join(tmp, "class.zip"), path.join(tmp, "1.jpg"), path.join(tmp, "2.jpg"), path.join(tmp, "readme.txt")]);
    const z = await upload(API, teacher, fs.readFileSync(path.join(tmp, "class.zip")), "class.zip", "class_sheets");
    ok(z.status === 200 && z.data.kind === "zip", "ZIP of sheets accepted");
    const zd = await call("POST", `/tests/${test}/sheets`, { token: teacher, body: { upload_id: z.data.id } });
    const zdoc = await waitDocument(API, teacher, zd.data.document_id);
    ok(zdoc.status === "completed" && zdoc.pages.length === 2, `ZIP turned into 2 pages, other files skipped (${zdoc.status} ${zdoc.pages.length})`);
    await expect("unused class upload can be deleted", 200, "DELETE", `/documents/${zd.data.document_id}`, { token: teacher });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

section("Background jobs: retries with backoff, stored errors");
{
  const MOCK = process.env.MOCK_URL ?? "http://localhost:4999";
  const det = (await call("GET", `/tests/${test}`, { token: teacher })).data;
  const [a, b] = det.attempts.filter((x) => x.status === "evaluated" && x.files > 0);
  // Two unreadable AI answers, then a good one: the job retries and succeeds.
  await fetch(`${MOCK}/__mode`, { method: "POST", body: JSON.stringify({ garbage: 2 }) });
  await expect("re-mark (AI answers unreadable twice)", 200, "POST", `/tests/${test}/evaluate`, { token: teacher, body: { attempt_ids: [a.id] } });
  let sawRetry = false, A;
  for (let i = 0; i < 120; i++) {
    A = (await call("GET", `/tests/${test}`, { token: teacher })).data.attempts.find((x) => x.id === a.id);
    if (A.status === "evaluating" && /Try \d of 3 failed/.test(A.error ?? "")) sawRetry = true;
    if (A.status !== "evaluating") break;
    await sleep(200);
  }
  ok(A.status === "evaluated" && !A.error, `job succeeded on a later try (${A.status} ${A.error ?? ""})`);
  ok(sawRetry, "the sheet showed the retry while waiting");
  // Unreadable every time: fails after 3 tries with the error stored.
  await fetch(`${MOCK}/__mode`, { method: "POST", body: JSON.stringify({ garbage: 99 }) });
  await expect("re-mark (AI answer always unreadable)", 200, "POST", `/tests/${test}/evaluate`, { token: teacher, body: { attempt_ids: [b.id] } });
  let B;
  for (let i = 0; i < 150; i++) { B = (await call("GET", `/tests/${test}`, { token: teacher })).data.attempts.find((x) => x.id === b.id); if (B.status !== "evaluating") break; await sleep(200); }
  await fetch(`${MOCK}/__mode`, { method: "POST", body: JSON.stringify({ garbage: 0 }) });
  ok(B.status === "failed" && /couldn't be read/.test(B.error ?? ""), `failed after 3 tries with the reason stored (${B.status}: ${B.error})`);
  if (DATA_DIR) {
    const db = new DatabaseSync(path.join(DATA_DIR, "vedavidya.db"));
    const j = db.prepare("SELECT status, attempts, last_error FROM jobs WHERE dedupe_key = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(`mark:${b.id}`);
    ok(j.status === "failed" && j.attempts === 3 && j.last_error, `job record: ${j.status}, ${j.attempts} tries, error kept`);
    db.close();
  }
  // Retrying the failed sheet works once the AI is fine again.
  await expect("retry the failed sheet", 200, "POST", `/tests/${test}/evaluate`, { token: teacher, body: { attempt_ids: [b.id] } });
  for (let i = 0; i < 80; i++) { B = (await call("GET", `/tests/${test}`, { token: teacher })).data.attempts.find((x) => x.id === b.id); if (B.status !== "evaluating") break; await sleep(200); }
  ok(B.status === "evaluated", "the failed sheet is marked after a manual retry");
  // A permanent problem (no paper) fails at once, without retries.
  const t2 = (await call("POST", "/tests", { token: teacher, body: { title: "No paper", mode: "offline", batch_ids: [batch] } })).data.id;
  const at2 = (await call("GET", `/tests/${t2}`, { token: teacher })).data.attempts[0];
  await call("POST", `/attempts/${at2.id}/files`, { token: teacher, body: { upload_ids: await uploadAll(API, teacher, [["s.jpg", await jpeg(500, 700, "s")]], "student_sheet") } });
  await waitProcessed(API, teacher, t2);
  ok((await call("POST", `/tests/${t2}/evaluate`, { token: teacher, body: {} })).status === 400, "marking without a paper is refused up front");
  await call("DELETE", `/tests/${t2}`, { token: teacher });
}

section("Backups (super-admin)");
{
  const rootEmail = process.env.SUPER_ADMIN_EMAIL ?? "root-admin@example.com";
  const root = (await call("POST", "/auth/register", { body: { institute: "Platform", name: "Platform Owner", email: rootEmail, password: "root-pass-123" } })).data.token ?? await login(rootEmail, "root-pass-123");
  ok((await call("POST", "/admin/backup", { token: admin })).status === 403, "an institute admin can't run backups");
  const b1 = await expect("super-admin backs up now", 200, "POST", "/admin/backup", { token: root });
  ok(/^vedavidya-\d{8}-\d{6}-\d{3}-manual\.db$/.test(b1.data.file) && b1.data.size > 0, `backup file ${b1.data.file}`);
  if (DATA_DIR) {
    const copy = new DatabaseSync(path.join(DATA_DIR, "backups", b1.data.file), { readOnly: true });
    ok(copy.prepare("SELECT count(*) n FROM users").get().n > 10, "the backup is a complete, readable database");
    copy.close();
  }
  for (let i = 0; i < 15; i++) await call("POST", "/admin/backup", { token: root });
  const list = (await expect("list backups", 200, "GET", "/admin/backups", { token: root })).data.backups;
  ok(list.length === 14, `only the newest 14 backups are kept (found ${list.length})`);
}

section("Credits: platform key, monthly free credits, charges, refunds");
{
  const MOCK = process.env.MOCK_URL ?? "http://localhost:4999";
  const rootEmail = process.env.SUPER_ADMIN_EMAIL ?? "root-admin@example.com";
  const root = await login(rootEmail, "root-pass-123");
  // A new institute with no key of its own: AI runs on the platform key and is paid with credits.
  const c = otherAdmin; // the second institute never adds its own key (signing up more institutes would hit the signup limit)
  const st = (await call("GET", "/settings/ai", { token: c })).data;
  ok(st.configured && !st.own_key && st.platform_available, "AI works without an own key (platform key)");
  let cr = (await expect("credit balance", 200, "GET", "/credits", { token: c })).data;
  ok(cr.balance.free === 300 && cr.balance.total === 300 && !cr.balance.own_key, `300 free credits this month (got ${cr.balance.total})`);
  await call("GET", "/credits", { token: c });
  ok((await call("GET", "/credits", { token: c })).data.history.filter((h) => h.kind === "monthly_free").length === 1, "monthly free credits are given once per month");
  // Generate a paper: 10 credits.
  const spec = { subject: "Maths", board: "CBSE", class_level: "Class 10", topics: "Algebra", language: "English", difficulty: "mixed", duration_min: 30, sections: [{ name: "A", type: "short", count: 2, marks_each: 2, negative_marks: 0 }] };
  const gen = await expect("generate a paper with credits", 200, "POST", "/papers/generate", { token: c, body: spec });
  const genDone = await poll(() => call("GET", `/papers/${gen.data.id}`, { token: c }).then((x) => x.data), (p) => p.status !== "generating");
  ok(genDone.status === "draft", "paper generated on the platform key");
  cr = (await call("GET", "/credits", { token: c })).data;
  ok(cr.balance.total === 290 && cr.history.some((h) => h.kind === "charge" && h.amount === -10), `10 credits charged (balance ${cr.balance.total})`);
  // A failed generation is refunded.
  await fetch(`${MOCK}/__mode`, { method: "POST", body: JSON.stringify({ garbage: 99 }) });
  const bad = await expect("generation that will fail", 200, "POST", "/papers/generate", { token: c, body: spec });
  const badDone = await poll(() => call("GET", `/papers/${bad.data.id}`, { token: c }).then((x) => x.data), (p) => p.status !== "generating");
  await fetch(`${MOCK}/__mode`, { method: "POST", body: JSON.stringify({ garbage: 0 }) });
  cr = (await call("GET", "/credits", { token: c })).data;
  ok(badDone.status === "failed" && cr.balance.total === 290 && cr.history.some((h) => h.kind === "refund" && h.amount === 10), `failed action refunded (balance ${cr.balance.total})`);
  // Marking: 1 credit per sheet.
  const cb = (await call("POST", "/batches", { token: c, body: { name: "C1", course: "10th CBSE" } })).data.id;
  await call("POST", "/students/bulk", { token: c, body: { batch_id: cb, csv: "A One,1\nB Two,2\nC Three,3" } });
  const ct = (await call("POST", "/tests", { token: c, body: { title: "Credit test", paper_id: gen.data.id, mode: "offline", batch_ids: [cb], subject: "Maths" } })).data.id;
  let cd = (await call("GET", `/tests/${ct}`, { token: c })).data;
  for (const a of cd.attempts) await call("POST", `/attempts/${a.id}/files`, { token: c, body: { upload_ids: await uploadAll(API, c, [["s.jpg", await jpeg(600, 800, a.student_name)]], "student_sheet") } });
  await waitProcessed(API, c, ct);
  const ev = await expect("mark 3 sheets", 200, "POST", `/tests/${ct}/evaluate`, { token: c, body: {} });
  ok(ev.data.queued === 3, "3 sheets queued");
  await expect("asking again doesn't charge twice", 200, "POST", `/tests/${ct}/evaluate`, { token: c, body: { attempt_ids: cd.attempts.map((a) => a.id) } });
  for (let i = 0; i < 100; i++) { cd = (await call("GET", `/tests/${ct}`, { token: c })).data; if (!cd.attempts.some((a) => a.status === "evaluating")) break; await sleep(300); }
  cr = (await call("GET", "/credits", { token: c })).data;
  ok(cd.attempts.every((a) => a.status === "evaluated") && cr.balance.total === 287, `3 credits for 3 sheets (balance ${cr.balance.total})`);
  // Out of credits: blocked with a clear message, nothing queued.
  const orgId = (await call("GET", "/me", { token: c })).data.org.id;
  await expect("teacher/admin can't use super-admin tools", 403, "POST", `/admin/orgs/${orgId}/credits`, { token: c, body: { amount: 100, note: "x" } });
  await expect("super-admin removes credits", 200, "POST", `/admin/orgs/${orgId}/credits`, { token: root, body: { amount: -287, note: "Test: empty the balance" } });
  ok((await call("GET", "/credits", { token: c })).data.balance.total === 0, "balance is 0");
  const blocked = await call("POST", `/tests/${ct}/evaluate`, { token: c, body: { attempt_ids: [cd.attempts[0].id] } });
  ok(blocked.status === 402 && /Not enough credits/.test(blocked.data.error) && blocked.data.code === "no_credits", `out of credits → 402 with a clear message (${blocked.data.error?.slice(0, 80)}…)`);
  ok((await call("GET", `/tests/${ct}`, { token: c })).data.attempts[0].status === "evaluated", "nothing was queued");
  ok((await call("POST", "/papers/generate", { token: c, body: spec })).status === 402, "paper generation blocked too");
  // Top-up by the super-admin, then it works again.
  const topped = await expect("super-admin adds 100 credits", 200, "POST", `/admin/orgs/${orgId}/credits`, { token: root, body: { amount: 100, note: "Welcome credits" } });
  ok(topped.data.total === 100 && topped.data.paid === 100, "100 credits added (they never expire)");
  await expect("marking works again", 200, "POST", `/tests/${ct}/evaluate`, { token: c, body: { attempt_ids: [cd.attempts[0].id] } });
  ok((await call("GET", "/credits", { token: c })).data.balance.total === 99, "1 credit used from the added credits");
  // Marking quality multiplies the marking price: Mixed ×1, Sonnet ×5, Opus ×10.
  const waitMarked = async () => { for (let i = 0; i < 100; i++) { const d = (await call("GET", `/tests/${ct}`, { token: c })).data; if (!d.attempts.some((a) => a.status === "evaluating")) return d; await sleep(300); } };
  await waitMarked();
  cr = (await call("GET", "/credits", { token: c })).data;
  ok(cr.prices.mark_sheet === 1 && cr.mark_by_mode.mixed === 1 && cr.mark_by_mode.sonnet === 5 && cr.mark_by_mode.opus === 10, `marking prices per mode ${JSON.stringify(cr.mark_by_mode)}`);
  await expect("switch to Opus for everything", 200, "PUT", "/settings/ai/mode", { token: c, body: { mode: "opus" } });
  ok((await call("GET", "/credits", { token: c })).data.prices.mark_sheet === 10, "on Opus a sheet costs 10 credits");
  await expect("mark one sheet on Opus", 200, "POST", `/tests/${ct}/evaluate`, { token: c, body: { attempt_ids: [cd.attempts[1].id] } });
  ok((await call("GET", "/credits", { token: c })).data.balance.total === 89, "10 credits charged for an Opus-marked sheet");
  await waitMarked();
  await expect("switch to Sonnet for everything", 200, "PUT", "/settings/ai/mode", { token: c, body: { mode: "sonnet" } });
  const tooMuch = await call("POST", `/tests/${ct}/evaluate`, { token: c, body: { attempt_ids: cd.attempts.map((a) => a.id) } });
  ok(tooMuch.status === 200 && (await call("GET", "/credits", { token: c })).data.balance.total === 74, "3 sheets on Sonnet cost 15 credits");
  await waitMarked();
  const mm = await expect("super-admin changes a multiplier", 200, "PUT", "/admin/settings", { token: root, body: { mode_multipliers: { opus: 12 } } });
  ok(mm.data.mode_multipliers.opus === 12 && mm.data.mode_multipliers.sonnet === 5, "multiplier changed, others kept");
  ok((await call("GET", "/credits", { token: c })).data.mark_by_mode.opus === 12, "institutes see the new Opus price");
  await expect("bad multiplier rejected", 400, "PUT", "/admin/settings", { token: root, body: { mode_multipliers: { opus: -1 } } });
  await call("PUT", "/admin/settings", { token: root, body: { mode_multipliers: { opus: 10 } } });
  await call("PUT", "/settings/ai/mode", { token: c, body: { mode: "mixed" } });
  // Per-institute monthly free credits and platform prices.
  await expect("set this institute's free credits", 200, "PUT", `/admin/orgs/${orgId}/quota`, { token: root, body: { monthly_free_credits: 500 } });
  const orgsList = (await expect("super-admin sees institutes", 200, "GET", "/admin/orgs", { token: root })).data;
  ok(orgsList.find((o) => o.id === orgId)?.monthly_free_credits === 500, "free credits per month saved for the institute");
  await expect("institute admin can't see all institutes", 403, "GET", "/admin/orgs", { token: c });
  const ps = await expect("super-admin changes a price", 200, "PUT", "/admin/settings", { token: root, body: { prices: { reteach_brief: 4 } } });
  ok(ps.data.prices.reteach_brief === 4 && ps.data.prices.mark_sheet === 1, "price changed, others kept");
  await call("PUT", "/admin/settings", { token: root, body: { prices: { reteach_brief: 3 } } });
  // Own key: never charged.
  const mine = (await call("GET", "/credits", { token: admin })).data;
  ok(mine.balance.own_key && !mine.history.some((h) => h.kind === "charge"), "institute with its own key is never charged");
  ok(!(await call("GET", "/credits", { token: admin })).data.history.some((h) => h.kind === "grant"), "credits are per institute");
  // Plan badge (app shell) and the Practice Questions overview.
  ok((await call("GET", "/me", { token: c })).data.org.plan === "credits", "an institute on the platform key has the credits plan");
  ok((await call("GET", "/me", { token: admin })).data.org.plan === "own_key", "an institute with its own key has the own-key plan");
  const po = await expect("practice overview", 200, "GET", "/practice/overview", { token: admin });
  ok(Array.isArray(po.data) && po.data.every((r) => typeof r.students === "number" && r.title), `practice overview lists tests (${po.data.length})`);
  ok(!(await call("GET", "/practice/overview", { token: c })).data.some((r) => po.data.some((x) => x.id === r.id)), "practice overview is per institute");
}

section("Courses, subjects, folders");
{
  const courses = (await expect("list courses", 200, "GET", "/courses", { token: teacher })).data;
  ok(courses.some((x) => x.name === "JEE"), "a course was created from the batch's course name");
  const course = (await expect("create a course", 200, "POST", "/courses", { token: admin, body: { name: "II PUC Karnataka Board", board: "Karnataka PUE" } })).data.id;
  await expect("teacher can't create courses", 403, "POST", "/courses", { token: teacher, body: { name: "X" } });
  const subject = (await expect("add a subject", 200, "POST", `/courses/${course}/subjects`, { token: admin, body: { name: "Physics" } })).data.id;
  await expect("duplicate subject → 409", 409, "POST", `/courses/${course}/subjects`, { token: admin, body: { name: "Physics" } });
  const pb = (await expect("batch in that course, with a start date", 200, "POST", "/batches", { token: admin, body: { name: "PUC A", course_id: course, start_date: "2026-06-01" } })).data.id;
  const bRow = (await call("GET", "/batches", { token: admin })).data.find((x) => x.id === pb);
  ok(bRow.course_name === "II PUC Karnataka Board" && bRow.start_date === "2026-06-01", "batch shows its course and start date");
  await expect("other institute's course rejected", 400, "POST", "/batches", { token: otherAdmin, body: { name: "Z", course_id: course } });
  const pt = (await expect("test picks course and subject from its batch", 200, "POST", "/tests", { token: teacher, body: { title: "PUC test", subject: "Physics", mode: "offline", batch_ids: [pb] } })).data.id;
  const ptd = (await call("GET", `/tests/${pt}`, { token: teacher })).data;
  ok(ptd.course_id === course && ptd.subject_id === subject && ptd.course_name === "II PUC Karnataka Board" && ptd.subject_name === "Physics", "test linked to course + subject");
  ok(ptd.state === "draft", `test without a paper is a draft (${ptd.state})`);
  const listed = (await call("GET", "/tests", { token: teacher })).data.find((t) => t.id === pt);
  ok(listed.course_name && listed.state === "draft", "test list shows course and status");
  await expect("window must end after it starts", 400, "POST", "/tests", { token: teacher, body: { title: "Bad window", mode: "cbt", batch_ids: [pb], scheduled_at: "2030-01-02T10:00:00Z", window_end: "2030-01-02T09:00:00Z" } });
  // Folders
  const f = (await expect("create a folder", 200, "POST", "/paper-folders", { token: teacher, body: { name: "Past year" } })).data.id;
  await expect("move a paper into it and set course/subject", 200, "PUT", `/papers/${aiPaper.id}/meta`, { token: teacher, body: { folder_id: f, course_id: course, subject_id: subject } });
  const pl = (await call("GET", "/papers", { token: teacher })).data.find((p) => p.id === aiPaper.id);
  ok(pl.folder_name === "Past year" && pl.course_name === "II PUC Karnataka Board" && pl.subject_name === "Physics" && pl.source === "generated" && pl.question_count > 0 && pl.difficulty, "paper card data: folder, course, subject, source, count, difficulty");
  await expect("subject from another course rejected", 400, "PUT", `/papers/${aiPaper.id}/meta`, { token: teacher, body: { course_id: (await call("GET", "/courses", { token: teacher })).data.find((x) => x.name === "JEE").id, subject_id: subject } });
  await expect("other institute's folder rejected", 400, "PUT", `/papers/${aiPaper.id}/meta`, { token: teacher, body: { folder_id: (await call("POST", "/paper-folders", { token: otherAdmin, body: { name: "Theirs" } })).data.id } });
  await expect("delete folder (papers stay)", 200, "DELETE", `/paper-folders/${f}`, { token: teacher });
  ok((await call("GET", `/papers/${aiPaper.id}`, { token: teacher })).data.folder_id === null, "paper moved out of the deleted folder");
  await expect("course used by a batch can't be deleted", 409, "DELETE", `/courses/${course}`, { token: admin });
  await call("DELETE", `/tests/${pt}`, { token: teacher });
}

section("Teacher corrections are kept for improving the marking");
{
  const det = (await call("GET", `/tests/${test}`, { token: teacher })).data;
  const a = det.attempts.find((x) => x.status === "evaluated");
  const at = (await call("GET", `/attempts/${a.id}`, { token: teacher })).data;
  const q = at.evaluation.questions[0];
  ok(typeof q.ai_marks === "number" && at.evaluation.meta?.model, `marking records the AI's marks and model (${at.evaluation.meta?.model})`);
  const newMarks = q.marks_awarded >= q.max_marks ? 0 : q.max_marks;
  await expect("marks above the maximum are rejected", 400, "PUT", `/attempts/${a.id}/evaluation`, { token: teacher, body: { questions: [{ question_id: q.question_id, marks_awarded: q.max_marks + 0.5, note: "too many" }] } });
  await expect("teacher changes marks with a note", 200, "PUT", `/attempts/${a.id}/evaluation`, { token: teacher, body: { questions: [{ question_id: q.question_id, marks_awarded: newMarks, note: "Method fully correct" }] } });
  await expect("teacher changes it again", 200, "PUT", `/attempts/${a.id}/evaluation`, { token: teacher, body: { questions: [{ question_id: q.question_id, marks_awarded: newMarks === 0 ? 0.5 : newMarks - 0.5 }] } });
  const after = (await call("GET", `/attempts/${a.id}`, { token: teacher })).data.evaluation.questions[0];
  ok(after.teacher_override && after.teacher_note === "Method fully correct", "the sheet shows the teacher's override and note");
  if (DATA_DIR) {
    const db = new DatabaseSync(path.join(DATA_DIR, "vedavidya.db"));
    const rows = db.prepare("SELECT * FROM grade_corrections WHERE attempt_id = ? ORDER BY id").all(a.id);
    ok(rows.length === 2, `both changes logged (${rows.length})`);
    ok(rows.every((r) => r.ai_marks === q.ai_marks), "each row keeps the AI's original marks (not the teacher's earlier change)");
    ok(rows[0].teacher_marks === newMarks && rows[0].teacher_note === "Method fully correct" && rows[0].model && JSON.parse(rows[0].page_refs).pages.length > 0 && JSON.parse(rows[0].ai_criteria).length >= 0 && rows[0].question_text, "row has teacher marks + note, model, page refs, criteria, question");
    let blockedDelete = false;
    try { db.prepare("DELETE FROM grade_corrections WHERE attempt_id = ?").run(a.id); } catch { blockedDelete = true; }
    ok(blockedDelete, "corrections can't be deleted");
    db.close();
  }
  const corr = await expect("super-admin can read corrections", 200, "GET", "/admin/corrections", { token: await login(process.env.SUPER_ADMIN_EMAIL ?? "root-admin@example.com", "root-pass-123") });
  ok(corr.data.some((r) => r.attempt_id === a.id), "corrections visible to the platform owner");
  await expect("institute admin can't read all corrections", 403, "GET", "/admin/corrections", { token: admin });
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
  const otherTests = (await call("GET", "/tests", { token: otherAdmin })).data;
  ok(!otherTests.some((t) => t.id === test), "other institute's tests not listed");
  await expect("other org: test detail", 404, "GET", `/tests/${test}`, { token: otherAdmin });
  await expect("other org: attempt", 404, "GET", `/attempts/${detail.attempts[0].id}`, { token: otherAdmin });
  await expect("other org: evaluate", 404, "POST", `/tests/${test}/evaluate`, { token: otherAdmin, body: {} });
  await expect("other org: publish → 404", 404, "POST", `/tests/${test}/publish`, { token: otherAdmin, body: { publish: false } });
  ok((await call("GET", `/tests/${test}`, { token: teacher })).data.results_published === 1, "…and results stay published");
  await expect("other org: delete test", 404, "DELETE", `/tests/${test}`, { token: otherAdmin });
  await expect("other org: paper", 404, "GET", `/papers/${aiPaper.id}`, { token: otherAdmin });
  await expect("other org: student analytics", 404, "GET", `/analytics/student/${creds[0].id}`, { token: otherAdmin });
  await expect("other org: batch analytics", 404, "GET", `/analytics/batch/${batch}`, { token: otherAdmin });
  const fr = await fetch(`${API}/attempts/${detail.attempts[0].id}/files/0`, { headers: { Authorization: `Bearer ${otherAdmin}` } });
  ok(fr.status === 404, "other org can't download answer sheets");
  await expect("other org: edit student", 404, "PUT", `/students/${creds[0].id}`, { token: otherAdmin, body: { name: "Hacked", batch_id: batch } });
  await expect("other org: delete student", 404, "DELETE", `/students/${creds[0].id}`, { token: otherAdmin });
  const otherBatches = (await call("GET", "/batches", { token: otherAdmin })).data;
  await expect("move my student into other org's batch → 400", 400, "PUT", `/students/${creds[5].id}`, { token: admin, body: { name: "Student 6", batch_id: otherBatches[0].id } });
  await expect("batch with other org's teacher → 400", 400, "POST", "/batches", { token: admin, body: { name: "X", teacher_id: (await call("GET", "/teachers", { token: otherAdmin })).data[0].id } });
  await expect("notice to other org's batch → 400", 400, "POST", "/notices", { token: admin, body: { title: "x", body: "y", batch_id: otherBatches[0].id } });
  await expect("test for other org's batch → 400", 400, "POST", "/tests", { token: admin, body: { title: "X", paper_id: aiPaper.id, mode: "offline", batch_ids: [otherBatches[0].id] } });
}

section("Notices, settings, password");
{
  const n = await expect("post notice", 200, "POST", "/notices", { token: teacher, body: { title: "Test on Monday", body: "Bring pens", batch_id: batch } });
  const sn = await expect("student sees batch notice", 200, "GET", "/notices", { token: studentTok });
  ok(sn.data.some((x) => x.title === "Test on Monday"), "batch notice visible to student");
  await expect("update institute", 200, "PUT", "/organisation", { token: admin, body: { name: "Test Coaching Centre", city: "Kota" } });
  await expect("wrong current password", 400, "POST", "/auth/change-password", { token: admin, body: { current: "nope", next: "new-password-1" } });
  const oldAdmin = admin;
  const cp = await expect("change password", 200, "POST", "/auth/change-password", { token: admin, body: { current: "s3cure-pass", next: "new-password-1" } });
  admin = cp.data.token;
  ok((await call("GET", "/me", { token: oldAdmin })).status === 401, "other sessions end after a password change");
  ok((await call("GET", "/me", { token: admin })).status === 200, "this device stays signed in");
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
  await expect("teacher can't delete a published test", 403, "DELETE", `/tests/${test}`, { token: teacher });
  await expect("admin deletes test", 200, "DELETE", `/tests/${test}`, { token: admin });
  ok(tfiles.length > 0 && tfiles.every((f) => !fs.existsSync(path.join(DATA_DIR, "uploads", f))), "test's files deleted from disk");
  db.close();
}

section("Remove key, rate limiting");
{
  await expect("remove key", 200, "DELETE", "/settings/ai", { token: admin });
  const after = (await call("GET", "/settings/ai", { token: admin })).data;
  ok(after.own_key === false && after.configured === Boolean(after.platform_available), "own key removed (the platform key takes over)");
  let limited = false;
  for (let i = 0; i < 12; i++) { const r = await call("POST", "/auth/login", { body: { identifier: adminEmail, password: "wrong" } }); if (r.status === 429) { limited = true; break; } }
  ok(limited, "repeated wrong passwords are rate limited");
}

console.log(`\n${fail ? "✗" : "✓"} ${pass} checks passed, ${fail} failed`);
if (fail) { console.log(failures.map((f) => " - " + f).join("\n")); process.exit(1); }
