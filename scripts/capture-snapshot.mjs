// Records the demo institute's API responses for the browser preview build.
// Usage: start the API on a freshly seeded database, then: node scripts/capture-snapshot.mjs out.json
import fs from "node:fs";

const BASE = process.env.API ?? "http://localhost:4000/api";
const get = async (path, token) => {
  const r = await fetch(BASE + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
};
const login = async (identifier) =>
  (await (await fetch(BASE + "/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier, password: "demo1234" }) })).json()).token;

async function staff(identifier) {
  const t = await login(identifier);
  const out = {};
  const grab = async (p) => (out[p] = await get(p, t));
  for (const p of ["/me", "/overview", "/centres", "/batches", "/teachers", "/students", "/notices", "/papers", "/tests"]) await grab(p);
  for (const b of out["/batches"]) { await grab(`/students?batch_id=${b.id}`); await grab(`/analytics/batch/${b.id}`); }
  for (const p of out["/papers"]) await grab(`/papers/${p.id}`);
  for (const s of out["/students"]) await grab(`/analytics/student/${s.id}`);
  for (const test of out["/tests"]) {
    const d = await grab(`/tests/${test.id}`);
    for (const a of d.attempts) if (a.score != null) await grab(`/attempts/${a.id}`);
  }
  return out;
}

const admin = await staff("admin@demo.school");
const teacher = { ...admin, "/me": await get("/me", await login("teacher1@demo.school")) };

const st = await login("student");
const student = {};
for (const p of ["/me", "/my/tests", "/notices"]) student[p] = await get(p, st);
student[`/analytics/student/${student["/me"].user.id}`] = await get(`/analytics/student/${student["/me"].user.id}`, st);
for (const t of student["/my/tests"]) {
  if (t.results_published && t.score != null) student[`/attempts/${t.attempt_id}`] = await get(`/attempts/${t.attempt_id}`, st);
  if (t.mode === "cbt" && t.status === "pending") {
    const r = await fetch(`${BASE}/cbt/${t.id}/start`, { method: "POST", headers: { Authorization: `Bearer ${st}` } });
    student[`/cbt/${t.id}/start`] = await r.json();
  }
}

fs.writeFileSync(process.argv[2], JSON.stringify({ admin, teacher, student }));
console.log("routes:", Object.keys(admin).length, Object.keys(student).length, "bytes:", fs.statSync(process.argv[2]).size);
