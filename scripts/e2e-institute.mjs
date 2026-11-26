// Real-world scenario: one institute, classes 8-12 (20-30 students each), 4 subject teachers.
// Each subject test: teacher uploads the paper + answer key, uploads the whole class's sheets, AI marks, results are published.
// Then every student signs in and must see exactly their own results - and nothing else.
// Usage (API + mock Claude running): node scripts/e2e-institute.mjs
import { createRequire } from "node:module";
const require = createRequire(new URL("../server/package.json", import.meta.url));
const sharp = require("sharp");
const API = process.env.API ?? "http://localhost:4300/api";

let pass = 0, fail = 0; const failures = [];
const ok = (c, m) => { if (c) pass++; else { fail++; failures.push(m); console.log("  ✗", m); } };
const log = (m) => console.log(m);
async function call(method, p, { token, body, form } = {}) {
  const h = {}; if (token) h.Authorization = `Bearer ${token}`; if (body !== undefined) h["Content-Type"] = "application/json";
  const r = await fetch(API + p, { method, headers: h, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d };
}
const login = async (identifier, password) => (await call("POST", "/auth/login", { body: { identifier, password } })).data.token;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const s = Date.now().toString(36);

const CLASSES = [["Class 8", 20], ["Class 9", 25], ["Class 10", 30], ["Class 11", 22], ["Class 12", 28]];
const SUBJECTS = ["Physics", "Chemistry", "Biology", "Maths"];
const page = await sharp({ create: { width: 1240, height: 1754, channels: 3, noise: { type: "gaussian", mean: 225, sigma: 20 } } }).jpeg({ quality: 80 }).toBuffer();
const keyPdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

const t0 = Date.now();
log("▸ Admin creates the institute and adds the Claude key");
const reg = await call("POST", "/auth/register", { body: { institute: "Veda Vidya", city: "Jaipur", name: "Principal", email: `principal-${s}@vedavidya.test`, password: "Principal#2026" } });
ok(reg.status === 200, `register ${reg.status}`);
const admin = reg.data.token;
ok((await call("PUT", "/settings/ai", { token: admin, body: { key: "sk-ant-test-valid-institute-key-9999" } })).status === 200, "API key saved");

log("▸ Admin adds 4 subject teachers");
const teachers = {};
for (const subj of SUBJECTS) {
  const r = await call("POST", "/teachers", { token: admin, body: { name: `${subj} Teacher`, email: `${subj.toLowerCase()}-${s}@vedavidya.test`, subject: subj } });
  teachers[subj] = await login(r.data.email, r.data.password);
  ok(Boolean(teachers[subj]), `${subj} teacher can sign in`);
}

log("▸ Admin creates classes 8-12 and adds students");
const classes = [];
for (const [name, size] of CLASSES) {
  const b = await call("POST", "/batches", { token: admin, body: { name, course: "CBSE" } });
  const csv = Array.from({ length: size }, (_, i) => `${name} Student ${i + 1},${i + 1},9${String(10000000 + i).padStart(9, "0")},,98${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`).join("\n");
  const r = await call("POST", "/students/bulk", { token: admin, body: { batch_id: b.data.id, csv } });
  ok(r.data.created?.length === size, `${name}: ${size} students added (got ${r.data.created?.length})`);
  classes.push({ name, size, id: b.data.id });
}
const dup = await call("POST", "/students", { token: admin, body: { name: "Duplicate Roll", batch_id: classes[0].id, roll_no: "1" } });
ok(dup.status === 409, "duplicate roll number in a class is rejected");

async function poll(fn, until, ms = 600000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (until(v)) return v; await sleep(800); } return fn(); }

log("▸ For each class and subject: upload paper + answer key, upload sheets, evaluate, publish");
const expected = new Map(); // batch id -> [{test, absent:Set(roll)}]
let sheets = 0;
const jobs = [];
for (const c of classes) for (const subj of SUBJECTS) jobs.push({ c, subj, title: `${c.name} ${subj} Unit Test 1` });
jobs.push({ c: classes[2], subj: "Physics", title: "Class 10 Physics Unit Test 2" });
for (const j of jobs) {
  const T = teachers[j.subj];
  const form = new FormData();
  form.append("paper", new Blob([page], { type: "image/jpeg" }), "paper-1.jpg");
  form.append("paper", new Blob([page], { type: "image/jpeg" }), "paper-2.jpg");
  form.append("key", new Blob([keyPdf], { type: "application/pdf" }), "answer-key.pdf");
  form.append("subject", j.subj); form.append("class_level", j.c.name); form.append("duration_min", "60");
  const imp = await call("POST", "/papers/import", { token: T, form });
  const paper = await poll(() => call("GET", `/papers/${imp.data.id}`, { token: T }).then((r) => r.data), (p) => p.status !== "generating");
  if (paper.status !== "draft") { ok(false, `${j.title}: paper import ${paper.status} ${paper.error}`); continue; }
  const test = (await call("POST", "/tests", { token: T, body: { title: j.title, paper_id: paper.id, mode: "offline", batch_ids: [j.c.id] } })).data.id;
  // 1-2 students absent per test
  const absent = new Set([((j.title.length * 7) % j.c.size) + 1, ((j.title.length * 13) % j.c.size) + 1]);
  const up = new FormData();
  for (let r = 1; r <= j.c.size; r++) if (!absent.has(r)) { up.append("files", new Blob([page], { type: "image/jpeg" }), `${r}-1.jpg`); up.append("files", new Blob([page], { type: "image/jpeg" }), `${r}-2.jpg`); }
  const u = await call("POST", `/tests/${test}/bulk-files`, { token: T, form: up });
  ok(u.data.students === j.c.size - absent.size, `${j.title}: sheets uploaded for ${j.c.size - absent.size} students (got ${u.data.students})`);
  const ev = await call("POST", `/tests/${test}/evaluate`, { token: T, body: {} });
  sheets += ev.data.queued;
  expected.set(j.c.id, [...(expected.get(j.c.id) ?? []), { test, title: j.title, subj: j.subj, absent }]);
}
log(`  ${jobs.length} tests created, ${sheets} sheets queued for marking`);

for (const [bid, list] of expected) for (const e of list) {
  const T = teachers[e.subj];
  const d = await poll(() => call("GET", `/tests/${e.test}`, { token: T }).then((r) => r.data), (d) => d.attempts.every((a) => a.status !== "evaluating"));
  const marked = d.attempts.filter((a) => a.status === "evaluated").length;
  const expectMarked = d.attempts.length - e.absent.size;
  ok(marked === expectMarked, `${e.title}: ${marked}/${expectMarked} marked (failed: ${d.attempts.filter((a) => a.status === "failed").map((a) => a.error)[0] ?? "none"})`);
  ok((await call("POST", `/tests/${e.test}/publish`, { token: T, body: { publish: true } })).status === 200, `${e.title}: published`);
}
log(`  all tests marked and published in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

log("▸ Teacher views: analytics per class and per subject");
for (const c of classes) {
  const all = await call("GET", `/analytics/batch/${c.id}`, { token: teachers.Physics });
  ok(all.data.subjects?.length === 4, `${c.name}: analytics has 4 subjects`);
  const phy = await call("GET", `/analytics/batch/${c.id}?subject=Physics`, { token: teachers.Maths });
  ok(phy.data.trend.length === (c.name === "Class 10" ? 2 : 1), `${c.name}: Physics filter shows only Physics tests`);
}

log("▸ Admin hands out logins; every student signs in and checks their results");
const studentsByClass = {};
for (const c of classes) {
  const r = await call("POST", "/students/reset-logins", { token: admin, body: { batch_id: c.id } });
  ok(r.data.created?.length === c.size, `${c.name}: ${c.size} logins issued`);
  studentsByClass[c.id] = r.data.created;
}
ok((await call("POST", "/students/reset-logins", { token: teachers.Physics, body: { batch_id: classes[0].id } })).status === 403, "teachers can't reset a whole class's passwords");

const tokens = {};
let checked = 0;
const problems = [];
const t1 = Date.now();
for (const c of classes) {
  const list = studentsByClass[c.id];
  await Promise.all(list.map(async (st) => {
    const tok = await login(st.username, st.password);
    if (!tok) return problems.push(`${st.name}: can't sign in`);
    tokens[st.username] = { tok, c, roll: Number(st.roll_no) };
    const my = (await call("GET", "/my/tests", { token: tok })).data;
    const exp = expected.get(c.id);
    if (my.length !== exp.length) problems.push(`${st.name}: sees ${my.length} tests, expected ${exp.length}`);
    for (const e of exp) {
      const t = my.find((x) => x.id === e.test);
      if (!t) { problems.push(`${st.name}: missing ${e.title}`); continue; }
      const wasAbsent = e.absent.has(Number(st.roll_no));
      if (wasAbsent) { if (t.score !== null) problems.push(`${st.name}: absent but has a score in ${e.title}`); continue; }
      if (t.score === null || t.score > t.max_score) { problems.push(`${st.name}: bad score in ${e.title}`); continue; }
      const att = await call("GET", `/attempts/${t.attempt_id}`, { token: tok });
      if (att.status !== 200 || att.data.student_name !== st.name || !att.data.evaluation?.questions?.length) problems.push(`${st.name}: can't open own answers for ${e.title}`);
    }
    const me = (await call("GET", "/me", { token: tok })).data.user;
    const card = await call("GET", `/analytics/student/${me.id}`, { token: tok });
    // Subjects with at least one result (a student absent from a subject's only test has no score for it yet).
    const present = new Set(exp.filter((e) => !e.absent.has(Number(st.roll_no))).map((e) => e.subj));
    if (card.status !== 200 || card.data.subjects?.length !== present.size) problems.push(`${st.name}: report card shows ${card.data.subjects?.length} subjects, expected ${present.size}`);
    const physics = card.data.subjects?.find((x) => x.subject === "Physics");
    const physicsTests = exp.filter((e) => e.subj === "Physics" && !e.absent.has(Number(st.roll_no))).length;
    if (physicsTests && physics?.tests !== physicsTests) problems.push(`${st.name}: Physics shows ${physics?.tests} tests, expected ${physicsTests}`);
    checked++;
  }));
}
log(`  ${checked} students signed in and checked their results in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
ok(checked === CLASSES.reduce((t, c) => t + c[1], 0), `all ${CLASSES.reduce((t, c) => t + c[1], 0)} students checked`);
ok(problems.length === 0, `no student saw wrong data (${problems.slice(0, 5).join(" | ")})`);

log("▸ Students cannot see anyone else's results");
const users = Object.entries(tokens);
const [aName, a] = users[0];
const [, other] = users.find(([, u]) => u.c.id === a.c.id && u.roll !== a.roll);
const [, otherClass] = users.find(([, u]) => u.c.id !== a.c.id);
const mineList = (await call("GET", "/my/tests", { token: a.tok })).data;
const otherList = (await call("GET", "/my/tests", { token: other.tok })).data;
const otherClassList = (await call("GET", "/my/tests", { token: otherClass.tok })).data;
const classmateAttempt = otherList.find((t) => t.score !== null)?.attempt_id;
const otherClassAttempt = otherClassList.find((t) => t.score !== null)?.attempt_id;
ok((await call("GET", `/attempts/${classmateAttempt}`, { token: a.tok })).status === 403, "can't open a classmate's answers");
ok((await call("GET", `/attempts/${otherClassAttempt}`, { token: a.tok })).status === 403, "can't open another class's answers");
const otherMe = (await call("GET", "/me", { token: other.tok })).data.user;
ok((await call("GET", `/analytics/student/${otherMe.id}`, { token: a.tok })).status === 403, "can't open a classmate's report card");
for (const p of ["/students", "/tests", "/overview", `/tests/${mineList[0].id}`, `/analytics/batch/${a.c.id}`, "/teachers", "/papers"])
  ok((await call("GET", p, { token: a.tok })).status === 403, `student blocked from ${p}`);
ok((await call("POST", `/tests/${mineList[0].id}/publish`, { token: a.tok, body: { publish: false } })).status === 403, "student can't unpublish");

log("▸ Parent report links");
const tdetail = (await call("GET", `/tests/${expected.get(classes[1].id)[0].test}`, { token: teachers.Physics })).data;
const withLink = tdetail.attempts.filter((x) => x.share_token);
ok(withLink.length === tdetail.attempts.filter((x) => x.score !== null).length, "every marked student has a parent link");
const rep = await call("GET", `/public/report/${withLink[0].share_token}`);
ok(rep.status === 200 && rep.data.student_name === withLink[0].student_name, "parent link shows the right student");
// The answer key is shared only once no other unpublished test still uses the same paper.
const paperReused = rep.data.answers_hidden;
const keyShown = rep.data.sections.flatMap((x) => x.questions).some((q) => q.solution || (q.rubric ?? []).length || q.correct_option != null);
ok(paperReused ? !keyShown : true, "parent link hides the answer key while the paper is still in use elsewhere");
ok(typeof rep.data.files === "number" && Array.isArray(rep.data.page_types), "parent link includes the answer-sheet pages");
if (rep.data.files) {
  const pg = await fetch(API + `/public/report/${withLink[0].share_token}/files/0`);
  ok(pg.status === 200 && /image|pdf/.test(pg.headers.get("content-type") ?? ""), "parent can open the marked pages");
}
ok((await fetch(API + `/public/report/not-a-token/files/0`)).status === 404, "bad link can't open pages");
ok(withLink.every((x) => x.parent_phone), "parent phone available for WhatsApp");

log("▸ Teacher safety rules");
const pub = expected.get(classes[0].id)[0];
ok((await call("DELETE", `/tests/${pub.test}`, { token: teachers.Physics })).status === 403, "teacher can't delete a published test");
const anyPaper = (await call("GET", `/tests/${pub.test}`, { token: admin })).data.paper.id;
ok((await call("DELETE", `/papers/${anyPaper}`, { token: admin })).status === 409, "a paper in use can't be deleted (results protected)");
ok((await call("DELETE", `/students/${otherMe.id}`, { token: teachers.Physics })).status === 403, "teacher can't delete students");

log("▸ Sessions end after a password reset");
const before = other.tok;
const studentRow = (await call("GET", `/students?batch_id=${other.c.id}`, { token: admin })).data.find((x) => x.roll_no === String(other.roll));
await call("POST", `/students/${studentRow.id}/reset-password`, { token: teachers.Physics, body: {} });
ok((await call("GET", "/my/tests", { token: before })).status === 401, "student's old session is signed out after a reset");

console.log(`\n${fail ? "✗" : "✓"} ${pass} checks passed, ${fail} failed · total ${((Date.now() - t0) / 1000).toFixed(0)}s`);
if (fail) { console.log(failures.map((f) => " - " + f).join("\n")); process.exit(1); }
