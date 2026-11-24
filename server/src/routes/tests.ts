// Tests: scheduling, answer-sheet upload, AI evaluation, teacher review, result publishing and online (CBT) attempts.
import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { z } from "zod";
import { all, json, one, run, uid, UPLOAD_DIR } from "../db.js";
import { staff, requireRole } from "../auth.js";
import { evaluateSheet, AiError } from "../ai/claude.js";
import type { Question, Section, SheetEvaluation } from "../ai/schemas.js";

export const testRoutes = Router();
const student = requireRole("student");

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, `${crypto.randomBytes(10).toString("hex")}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 30 },
  fileFilter: (_req, file, cb) => cb(null, /\.(jpe?g|png|webp|pdf)$/i.test(file.originalname)),
});

interface Paper { id: string; title: string; subject: string | null; instructions: string | null; total_marks: number; sections: Section[] }
const paperFor = (testId: string): Paper | null => {
  const p = one<any>("SELECT p.* FROM tests t JOIN question_papers p ON p.id = t.paper_id WHERE t.id = ?", testId);
  return p ? { ...p, sections: json<Section[]>(p.sections, []) } : null;
};
const questionsOf = (sections: Section[]) => sections.flatMap((s) => s.questions);
const isObjective = (q: Question) => q.type === "mcq" || q.type === "numeric";

testRoutes.get("/tests", staff, (req, res) => {
  res.json(all(`SELECT t.*, p.title AS paper_title, p.total_marks, p.subject,
      (SELECT group_concat(b.name, ', ') FROM test_batches tb JOIN batches b ON b.id = tb.batch_id WHERE tb.test_id = t.id) AS batch_names,
      (SELECT count(*) FROM attempts a WHERE a.test_id = t.id) AS candidates,
      (SELECT count(*) FROM attempts a WHERE a.test_id = t.id AND a.status = 'evaluated') AS evaluated
    FROM tests t JOIN question_papers p ON p.id = t.paper_id WHERE t.org_id = ? ORDER BY coalesce(t.scheduled_at, t.created_at) DESC`, req.user!.org_id));
});

testRoutes.post("/tests", staff, (req, res) => {
  const b = z.object({
    title: z.string().min(1), paper_id: z.string(), mode: z.enum(["offline", "cbt"]),
    scheduled_at: z.string().optional(), duration_min: z.number().int().min(5).max(360).optional(),
    batch_ids: z.array(z.string()).min(1),
  }).parse(req.body);
  const org = req.user!.org_id;
  const paper = one<any>("SELECT * FROM question_papers WHERE id = ? AND org_id = ?", b.paper_id, org);
  if (!paper || paper.status === "generating" || paper.status === "failed") return res.status(400).json({ error: "Pick a ready question paper" });
  if (b.mode === "cbt" && !questionsOf(json(paper.sections, [])).every(isObjective))
    return res.status(400).json({ error: "Online (CBT) tests need a paper with only MCQ / numeric questions" });
  const id = uid("tst");
  run("INSERT INTO tests (id, org_id, paper_id, title, mode, scheduled_at, duration_min) VALUES (?,?,?,?,?,?,?)",
    id, org, b.paper_id, b.title, b.mode, b.scheduled_at || null, b.duration_min ?? paper.duration_min);
  for (const batchId of b.batch_ids) {
    if (!one("SELECT 1 FROM batches WHERE id = ? AND org_id = ?", batchId, org)) continue;
    run("INSERT OR IGNORE INTO test_batches (test_id, batch_id) VALUES (?, ?)", id, batchId);
    // One attempt row per enrolled student, so the roster is ready for uploads.
    for (const s of all<{ student_id: string }>("SELECT student_id FROM enrollments WHERE batch_id = ?", batchId))
      run("INSERT OR IGNORE INTO attempts (id, test_id, student_id, max_score) VALUES (?,?,?,?)", uid("att"), id, s.student_id, paper.total_marks);
  }
  res.json({ id });
});

testRoutes.get("/tests/:id", staff, (req, res) => {
  const t = one<any>("SELECT * FROM tests WHERE id = ? AND org_id = ?", req.params.id, req.user!.org_id);
  if (!t) return res.status(404).json({ error: "Test not found" });
  const attempts = all<any>(`SELECT a.id, a.status, a.score, a.max_score, a.error, a.reviewed, a.files, a.submitted_at,
      u.id AS student_id, u.name AS student_name, e.roll_no, b.name AS batch_name,
      (SELECT token FROM share_tokens s WHERE s.attempt_id = a.id) AS share_token
    FROM attempts a JOIN users u ON u.id = a.student_id
    LEFT JOIN enrollments e ON e.student_id = u.id LEFT JOIN batches b ON b.id = e.batch_id
    WHERE a.test_id = ? ORDER BY b.name, CAST(e.roll_no AS INTEGER), u.name`, t.id)
    .map((a) => ({ ...a, files: json<string[]>(a.files, []).length }));
  res.json({ ...t, paper: paperFor(t.id), attempts });
});

testRoutes.delete("/tests/:id", staff, (req, res) => {
  run("DELETE FROM tests WHERE id = ? AND org_id = ?", req.params.id, req.user!.org_id);
  res.json({ ok: true });
});

const attemptInOrg = (attemptId: string, orgId: string) =>
  one<any>("SELECT a.* FROM attempts a JOIN tests t ON t.id = a.test_id WHERE a.id = ? AND t.org_id = ?", attemptId, orgId);

// Upload scanned pages (images or PDF) for one student's answer sheet.
testRoutes.post("/attempts/:id/files", staff, upload.array("files", 30), (req, res) => {
  const a = attemptInOrg(req.params.id, req.user!.org_id);
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!a) { files.forEach((f) => fs.rmSync(f.path, { force: true })); return res.status(404).json({ error: "Not found" }); }
  if (!files.length) return res.status(400).json({ error: "Upload JPG, PNG, WEBP or PDF files" });
  const existing = req.query.replace === "1" ? [] : json<string[]>(a.files, []);
  run("UPDATE attempts SET files = ?, status = 'uploaded', error = NULL, submitted_at = CURRENT_TIMESTAMP WHERE id = ?",
    JSON.stringify([...existing, ...files.map((f) => f.filename)]), a.id);
  res.json({ ok: true, pages: existing.length + files.length });
});

testRoutes.get("/attempts/:id/files/:n", staff, (req, res) => {
  const a = attemptInOrg(req.params.id, req.user!.org_id);
  const name = a && json<string[]>(a.files, [])[Number(req.params.n)];
  if (!name) return res.status(404).end();
  res.sendFile(path.join(UPLOAD_DIR, name));
});

function scoreEvaluation(ev: SheetEvaluation, questions: Question[]) {
  // Clamp each question to its paper marks so a model slip can never exceed the maximum.
  const byId = new Map(questions.map((q) => [q.id, q]));
  for (const qe of ev.questions) {
    const q = byId.get(qe.question_id);
    if (!q) continue;
    qe.max_marks = q.marks;
    qe.marks_awarded = Math.max(-q.negative_marks, Math.min(q.marks, qe.marks_awarded));
  }
  return ev.questions.filter((qe) => byId.has(qe.question_id)).reduce((t, qe) => t + qe.marks_awarded, 0);
}

async function runEvaluation(attemptId: string) {
  const a = one<any>("SELECT * FROM attempts WHERE id = ?", attemptId);
  if (!a) return;
  const paper = paperFor(a.test_id)!;
  run("UPDATE attempts SET status = 'evaluating', error = NULL WHERE id = ?", attemptId);
  try {
    const files = json<string[]>(a.files, []).map((f) => path.join(UPLOAD_DIR, f));
    const ev = await evaluateSheet(paper, files);
    const score = scoreEvaluation(ev, questionsOf(paper.sections));
    run("UPDATE attempts SET status = 'evaluated', evaluation = ?, score = ?, max_score = ?, reviewed = 0, evaluated_at = CURRENT_TIMESTAMP WHERE id = ?",
      JSON.stringify(ev), score, paper.total_marks, attemptId);
  } catch (e) {
    run("UPDATE attempts SET status = 'failed', error = ? WHERE id = ?", e instanceof AiError ? e.message : String(e), attemptId);
  }
}

// Small worker pool so a whole batch can be evaluated without flooding the API.
const queue: string[] = [];
let active = 0;
const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY ?? 3);
function enqueue(ids: string[]) {
  for (const id of ids) if (!queue.includes(id)) { queue.push(id); run("UPDATE attempts SET status = 'evaluating', error = NULL WHERE id = ?", id); }
  const pump = () => {
    while (active < CONCURRENCY && queue.length) {
      const id = queue.shift()!;
      active++;
      runEvaluation(id).finally(() => { active--; pump(); });
    }
  };
  pump();
}

testRoutes.post("/tests/:id/evaluate", staff, (req, res) => {
  const t = one("SELECT id FROM tests WHERE id = ? AND org_id = ?", req.params.id, req.user!.org_id);
  if (!t) return res.status(404).json({ error: "Test not found" });
  const only = (req.body?.attempt_ids as string[] | undefined) ?? null;
  const ids = all<{ id: string; files: string }>("SELECT id, files FROM attempts WHERE test_id = ? AND status IN ('uploaded','failed','evaluated')", req.params.id)
    .filter((a) => json<string[]>(a.files, []).length && (!only || only.includes(a.id))).map((a) => a.id);
  enqueue(ids);
  res.json({ queued: ids.length });
});

testRoutes.get("/attempts/:id", (req, res) => {
  const u = req.user!;
  const a = one<any>(`SELECT a.*, u.name AS student_name, t.title AS test_title, t.results_published, t.mode, t.org_id,
      (SELECT token FROM share_tokens s WHERE s.attempt_id = a.id) AS share_token
    FROM attempts a JOIN users u ON u.id = a.student_id JOIN tests t ON t.id = a.test_id WHERE a.id = ?`, req.params.id);
  if (!a || a.org_id !== u.org_id) return res.status(404).json({ error: "Not found" });
  if (u.role === "student" && (a.student_id !== u.id || !a.results_published)) return res.status(403).json({ error: "Results not published yet" });
  res.json({ ...a, files: json<string[]>(a.files, []).length, responses: json(a.responses, {}), evaluation: json(a.evaluation, null), paper: paperFor(a.test_id) });
});

// Teacher review: override marks on any question.
testRoutes.put("/attempts/:id/evaluation", staff, (req, res) => {
  const a = attemptInOrg(req.params.id, req.user!.org_id);
  if (!a) return res.status(404).json({ error: "Not found" });
  const ev = json<SheetEvaluation | null>(a.evaluation, null);
  if (!ev) return res.status(400).json({ error: "Not evaluated yet" });
  const edits = z.array(z.object({ question_id: z.string(), marks_awarded: z.number(), feedback: z.string().optional() })).parse(req.body.questions);
  for (const e of edits) {
    const qe = ev.questions.find((q) => q.question_id === e.question_id);
    if (qe) { qe.marks_awarded = e.marks_awarded; if (e.feedback !== undefined) qe.feedback = e.feedback; }
  }
  const score = scoreEvaluation(ev, questionsOf(paperFor(a.test_id)!.sections));
  run("UPDATE attempts SET evaluation = ?, score = ?, reviewed = 1 WHERE id = ?", JSON.stringify(ev), score, a.id);
  res.json({ ok: true, score });
});

testRoutes.post("/tests/:id/publish", staff, (req, res) => {
  const publish = req.body?.publish !== false;
  run("UPDATE tests SET results_published = ? WHERE id = ? AND org_id = ?", publish ? 1 : 0, req.params.id, req.user!.org_id);
  if (publish)
    for (const a of all<{ id: string }>("SELECT id FROM attempts WHERE test_id = ? AND score IS NOT NULL", req.params.id))
      run("INSERT OR IGNORE INTO share_tokens (token, attempt_id) VALUES (?, ?)", crypto.randomBytes(12).toString("base64url"), a.id);
  res.json({ ok: true });
});

testRoutes.get("/tests/:id/results.csv", staff, (req, res) => {
  const t = one<any>("SELECT * FROM tests WHERE id = ? AND org_id = ?", req.params.id, req.user!.org_id);
  if (!t) return res.status(404).end();
  const rows = all<any>(`SELECT u.name, e.roll_no, b.name AS batch, a.score, a.max_score, a.status FROM attempts a
    JOIN users u ON u.id = a.student_id LEFT JOIN enrollments e ON e.student_id = u.id LEFT JOIN batches b ON b.id = e.batch_id
    WHERE a.test_id = ? ORDER BY a.score DESC`, t.id);
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  res.type("text/csv").attachment(`${t.title.replace(/\W+/g, "_")}_results.csv`)
    .send(["Rank,Name,Roll No,Batch,Score,Max,Status", ...rows.map((r, i) => [r.score == null ? "" : i + 1, r.name, r.roll_no, r.batch, r.score, r.max_score, r.status].map(esc).join(","))].join("\n"));
});

// ---------------- Student side ----------------
testRoutes.get("/my/tests", student, (req, res) => {
  res.json(all(`SELECT t.id, t.title, t.mode, t.scheduled_at, t.duration_min, t.results_published, p.subject, p.total_marks,
      a.id AS attempt_id, a.status, a.score, a.max_score
    FROM attempts a JOIN tests t ON t.id = a.test_id JOIN question_papers p ON p.id = t.paper_id
    WHERE a.student_id = ? ORDER BY coalesce(t.scheduled_at, t.created_at) DESC`, req.user!.id));
});

const myCbtAttempt = (testId: string, studentId: string) =>
  one<any>(`SELECT a.*, t.mode, t.duration_min, t.scheduled_at, t.title FROM attempts a JOIN tests t ON t.id = a.test_id
    WHERE a.test_id = ? AND a.student_id = ?`, testId, studentId);

const remainingSeconds = (a: any) =>
  a.started_at ? Math.max(0, a.duration_min * 60 - Math.floor((Date.now() - Date.parse(a.started_at.replace(" ", "T") + "Z")) / 1000)) : a.duration_min * 60;

testRoutes.post("/cbt/:testId/start", student, (req, res) => {
  const a = myCbtAttempt(req.params.testId, req.user!.id);
  if (!a || a.mode !== "cbt") return res.status(404).json({ error: "Test not found" });
  if (a.scheduled_at && Date.parse(a.scheduled_at) > Date.now()) return res.status(400).json({ error: "This test hasn't started yet" });
  if (["uploaded", "evaluating", "evaluated"].includes(a.status)) return res.status(400).json({ error: "You've already submitted this test" });
  if (a.status === "pending") run("UPDATE attempts SET status = 'in_progress', started_at = CURRENT_TIMESTAMP WHERE id = ?", a.id);
  const fresh = myCbtAttempt(req.params.testId, req.user!.id);
  const paper = paperFor(a.test_id)!;
  // Strip answers and solutions before sending the paper to the student.
  const sections = paper.sections.map((s) => ({ ...s, questions: s.questions.map(({ correct_option, numeric_answer, solution, rubric, ...q }) => q) }));
  res.json({ attempt_id: a.id, title: a.title, remaining_seconds: remainingSeconds(fresh), responses: json(fresh.responses, {}), sections, instructions: paper.instructions });
});

testRoutes.put("/cbt/:testId/responses", student, (req, res) => {
  const a = myCbtAttempt(req.params.testId, req.user!.id);
  if (!a || a.status !== "in_progress") return res.status(400).json({ error: "Test is not in progress" });
  run("UPDATE attempts SET responses = ? WHERE id = ?", JSON.stringify(req.body.responses ?? {}), a.id);
  res.json({ ok: true, remaining_seconds: remainingSeconds(a) });
});

testRoutes.post("/cbt/:testId/submit", student, (req, res) => {
  const a = myCbtAttempt(req.params.testId, req.user!.id);
  if (!a || a.status !== "in_progress") return res.status(400).json({ error: "Test is not in progress" });
  const responses = (req.body.responses ?? json(a.responses, {})) as Record<string, { answer: number | null; review?: boolean }>;
  const paper = paperFor(a.test_id)!;
  const evQuestions = questionsOf(paper.sections).map((q) => {
    const given = responses[q.id]?.answer;
    const attempted = given !== null && given !== undefined && given !== ("" as any);
    const correct = q.type === "mcq" ? Number(given) === q.correct_option : Math.abs(Number(given) - (q.numeric_answer ?? NaN)) < 1e-6;
    const marks = !attempted ? 0 : correct ? q.marks : -q.negative_marks;
    return {
      question_id: q.id, attempted, transcription: attempted ? String(q.type === "mcq" ? q.options[Number(given)] ?? given : given) : "",
      steps: [], marks_awarded: marks, max_marks: q.marks, confidence: "high" as const,
      feedback: !attempted ? "Not attempted." : correct ? "Correct." : `Incorrect. ${q.solution}`,
    };
  });
  const score = evQuestions.reduce((t, q) => t + q.marks_awarded, 0);
  const ev: SheetEvaluation = { student_name_on_sheet: null, questions: evQuestions, overall_feedback: "", strengths: [], gaps: [] };
  run(`UPDATE attempts SET responses = ?, evaluation = ?, score = ?, max_score = ?, status = 'evaluated', submitted_at = CURRENT_TIMESTAMP,
       evaluated_at = CURRENT_TIMESTAMP WHERE id = ?`, JSON.stringify(responses), JSON.stringify(ev), score, paper.total_marks, a.id);
  res.json({ ok: true });
});
