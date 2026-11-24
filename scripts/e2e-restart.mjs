// Restart-recovery test. Phase "start": sets up 50 sheets and starts evaluation, prints ids.
// Phase "check": after the server was killed and restarted, waits for every sheet to finish.
import { createRequire } from "node:module";
const require = createRequire(new URL("../server/package.json", import.meta.url));
const sharp = require("sharp");
const API = process.env.API ?? "http://localhost:4300/api";
const call = async (m, p, { token, body, form } = {}) => {
  const h = {}; if (token) h.Authorization = `Bearer ${token}`; if (body) h["Content-Type"] = "application/json";
  const r = await fetch(API + p, { method: m, headers: h, body: form ?? (body ? JSON.stringify(body) : undefined) });
  return r.json();
};
if (process.argv[2] === "start") {
  const s = Date.now().toString(36);
  const { token } = await call("POST", "/auth/register", { body: { institute: "Restart Test", name: "Owner One", email: `r-${s}@example.com`, password: "password-123" } });
  await call("PUT", "/settings/ai", { token, body: { key: "sk-ant-test-valid-restart-key-000000" } });
  const { id: batch } = await call("POST", "/batches", { token, body: { name: "B" } });
  await call("POST", "/students/bulk", { token, body: { batch_id: batch, csv: Array.from({ length: 50 }, (_, i) => `S${i + 1},${i + 1}`).join("\n") } });
  const { id: paper } = await call("POST", "/papers", { token, body: { title: "P", duration_min: 30, sections: [{ name: "A", instructions: "", questions: [
    { id: "q1", type: "short", text: "x", options: [], correct_option: null, numeric_answer: null, marks: 2, negative_marks: 0, difficulty: "easy", topic: "T", solution: "s", rubric: [{ step: "a", marks: 1 }, { step: "b", marks: 1 }] }] }] } });
  const { id: test } = await call("POST", "/tests", { token, body: { title: "T", paper_id: paper, mode: "offline", batch_ids: [batch] } });
  const img = await sharp({ create: { width: 800, height: 1000, channels: 3, background: "#fff" } }).jpeg().toBuffer();
  const form = new FormData();
  for (let i = 1; i <= 50; i++) form.append("files", new Blob([img], { type: "image/jpeg" }), `${i}.jpg`);
  const up = await call("POST", `/tests/${test}/bulk-files`, { token, form });
  const q = await call("POST", `/tests/${test}/evaluate`, { token, body: {} });
  console.log(JSON.stringify({ token, test, uploaded: up.students, queued: q.queued }));
} else {
  const { token, test } = JSON.parse(process.argv[3]);
  const t0 = Date.now();
  let d;
  do { d = await call("GET", `/tests/${test}`, { token }); await new Promise((r) => setTimeout(r, 700)); }
  while (d.attempts.some((a) => a.status === "evaluating") && Date.now() - t0 < 180000);
  const c = (s) => d.attempts.filter((a) => a.status === s).length;
  console.log(`after restart: evaluated=${c("evaluated")} failed=${c("failed")} evaluating=${c("evaluating")} uploaded=${c("uploaded")}`);
  process.exit(c("evaluated") === 50 ? 0 : 1);
}
