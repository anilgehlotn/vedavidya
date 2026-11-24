// Tests: scheduling, answer-sheet upload, AI evaluation, teacher review, result publishing and online (CBT) attempts.
import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { z } from "zod";
import { all, json, one, run, uid, UPLOAD_DIR } from "../db.js";
import { staff, requireRole } from "../auth.js";
import { evaluateSheet, AiError, aiProblem } from "../ai/claude.js";
import { normalisePage, removeFiles, UploadError } from "../images.js";
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
// Bulk upload for a whole class: up to 400 pages in one request.
const bulkUpload = multer({ storage: (upload as any).storage, limits: { fileSize: 25 * 1024 * 1024, files: 400 },
  fileFilter: (_req, file, cb) => cb(null, /\.(jpe?g|png|webp|pdf)$/i.test(file.originalname)) });

// Express 4 doesn't catch rejected promises from async handlers.
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

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
  const qs = questionsOf(json<Section[]>(paper.sections, []));
  if (!qs.length || !(paper.total_marks > 0)) return res.status(400).json({ error: "This paper has no questions yet. Add questions before creating a test." });
  if (b.mode === "cbt" && !qs.every(isObjective))
    return res.status(400).json({ error: "Online (CBT) tests need a paper with only MCQ / numeric questions" });
  const batchIds = [...new Set(b.batch_ids)].filter((bid) => one("SELECT 1 FROM batches WHERE id = ? AND org_id = ?", bid, org));
  if (!batchIds.length) return res.status(400).json({ error: "Pick at least one batch from your institute" });
  const id = uid("tst");
  run("INSERT INTO tests (id, org_id, paper_id, title, mode, scheduled_at, duration_min) VALUES (?,?,?,?,?,?,?)",
    id, org, b.paper_id, b.title, b.mode, b.scheduled_at || null, b.duration_min ?? paper.duration_min);
  for (const batchId of batchIds) {
    run("INSERT OR IGNORE INTO test_batches (test_id, batch_id) VALUES (?, ?)", id, batchId);
    // One attempt row per enrolled student, so the roster is ready for uploads.
    for (const s of all<{ student_id: string }>("SELECT student_id FROM enrollments WHERE batch_id = ?", batchId))
      run("INSERT OR IGNORE INTO attempts (id, test_id, student_id, max_score) VALUES (?,?,?,?)", uid("att"), id, s.student_id, paper.total_marks);
  }
  res.json({ id });
});

testRoutes.get("/tests/:id", staff, (req, res) => {
  const t = one<any>(`SELECT t.*, (SELECT group_concat(b.name, ', ') FROM test_batches tb JOIN batches b ON b.id = tb.batch_id WHERE tb.test_id = t.id) AS batch_names
    FROM tests t WHERE t.id = ? AND t.org_id = ?`, req.params.id, req.user!.org_id);
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
  const t = one("SELECT id FROM tests WHERE id = ? AND org_id = ?", req.params.id, req.user!.org_id);
  if (!t) return res.status(404).json({ error: "Test not found" });
  const files = all<{ files: string }>("SELECT files FROM attempts WHERE test_id = ?", req.params.id).flatMap((a) => json<string[]>(a.files, []));
  run("DELETE FROM tests WHERE id = ? AND org_id = ?", req.params.id, req.user!.org_id);
  removeFiles(UPLOAD_DIR, files);
  res.json({ ok: true });
});

const attemptInOrg = (attemptId: string, orgId: string) =>
  one<any>("SELECT a.* FROM attempts a JOIN tests t ON t.id = a.test_id WHERE a.id = ? AND t.org_id = ?", attemptId, orgId);

async function normaliseAll(files: Express.Multer.File[]) {
  const out: { name: string; original: string }[] = [];
  const errors: string[] = [];
  for (const f of files) {
    try { out.push({ name: await normalisePage(UPLOAD_DIR, f.filename, f.originalname), original: f.originalname }); }
    catch (e) { errors.push(e instanceof UploadError ? e.message : `${f.originalname}: upload failed`); }
  }
  return { out, errors };
}

// Upload scanned pages (images or PDF) for one student's answer sheet.
testRoutes.post("/attempts/:id/files", staff, upload.array("files", 30), wrap(async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const drop = () => files.forEach((f) => fs.rmSync(f.path, { force: true }));
  const a = one<any>("SELECT a.*, t.mode FROM attempts a JOIN tests t ON t.id = a.test_id WHERE a.id = ? AND t.org_id = ?", req.params.id, req.user!.org_id);
  if (!a) { drop(); return res.status(404).json({ error: "Not found" }); }
  if (a.mode !== "offline") { drop(); return res.status(400).json({ error: "Online tests don't take uploaded sheets" }); }
  if (a.status === "evaluating") { drop(); return res.status(409).json({ error: "This sheet is being evaluated right now. Wait for it to finish, then upload again." }); }
  if (!files.length) return res.status(400).json({ error: "Upload JPG, PNG, WEBP or PDF files" });
  const { out, errors } = await normaliseAll(files);
  if (!out.length) return res.status(400).json({ error: errors.join(" ") });
  const replace = req.query.replace === "1";
  const previous = json<string[]>(a.files, []);
  const pages = [...(replace ? [] : previous), ...out.map((o) => o.name)];
  run("UPDATE attempts SET files = ?, status = 'uploaded', error = NULL, evaluation = NULL, score = NULL, reviewed = 0, submitted_at = CURRENT_TIMESTAMP WHERE id = ?",
    JSON.stringify(pages), a.id);
  if (replace) removeFiles(UPLOAD_DIR, previous);
  res.json({ ok: true, pages: pages.length, warnings: errors });
}));

// Bulk upload for a whole test: files are matched to students by the roll number at the start of the
// file name, e.g. "7.jpg", "07-1.jpg", "7_2.jpg", "Roll 7 page 2.png". Pages are ordered by file name.
testRoutes.post("/tests/:id/bulk-files", staff, bulkUpload.array("files", 400), wrap(async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const drop = (fs_: Express.Multer.File[]) => fs_.forEach((f) => fs.rmSync(f.path, { force: true }));
  const t = one<any>("SELECT * FROM tests WHERE id = ? AND org_id = ?", req.params.id, req.user!.org_id);
  if (!t) { drop(files); return res.status(404).json({ error: "Test not found" }); }
  if (t.mode !== "offline") { drop(files); return res.status(400).json({ error: "Online tests don't take uploaded sheets" }); }
  if (!files.length) return res.status(400).json({ error: "Choose JPG, PNG, WEBP or PDF files named by roll number, e.g. 7.jpg or 7-1.jpg" });
  const batchId = typeof req.query.batch_id === "string" && req.query.batch_id ? req.query.batch_id : null;
  const roster = all<{ id: string; status: string; files: string; roll_no: string | null }>(`SELECT a.id, a.status, a.files, e.roll_no FROM attempts a
    LEFT JOIN enrollments e ON e.student_id = a.student_id WHERE a.test_id = ? ${batchId ? "AND e.batch_id = ?" : ""}`, ...(batchId ? [t.id, batchId] : [t.id]));
  const byRoll = new Map<string, typeof roster[number]>();
  const dupes = new Set<string>();
  for (const r of roster) {
    if (!r.roll_no) continue;
    const k = String(Number(r.roll_no.replace(/\D/g, "")) || r.roll_no.trim().toLowerCase());
    if (byRoll.has(k)) dupes.add(k); else byRoll.set(k, r);
  }
  for (const k of dupes) byRoll.delete(k);
  const ambiguous: string[] = [];
  const rollOf = (name: string) => { const m = name.match(/^\D{0,8}?(\d+)/); return m ? String(Number(m[1])) : null; };
  const groups = new Map<string, Express.Multer.File[]>();
  const unmatched: string[] = [];
  const busy: string[] = [];
  for (const f of files) {
    const roll = rollOf(f.originalname);
    if (roll && dupes.has(roll)) { ambiguous.push(f.originalname); fs.rmSync(f.path, { force: true }); continue; }
    const att = roll ? byRoll.get(roll) : undefined;
    if (!att) { unmatched.push(f.originalname); fs.rmSync(f.path, { force: true }); continue; }
    if (att.status === "evaluating") { busy.push(f.originalname); fs.rmSync(f.path, { force: true }); continue; }
    groups.set(roll!, [...(groups.get(roll!) ?? []), f]);
  }
  const collator = new Intl.Collator(undefined, { numeric: true });
  const warnings: string[] = [];
  let students = 0, pages = 0;
  for (const [roll, list] of groups) {
    list.sort((x, y) => collator.compare(x.originalname, y.originalname));
    const { out, errors } = await normaliseAll(list);
    warnings.push(...errors);
    if (!out.length) continue;
    const att = byRoll.get(roll)!;
    run("UPDATE attempts SET files = ?, status = 'uploaded', error = NULL, evaluation = NULL, score = NULL, reviewed = 0, submitted_at = CURRENT_TIMESTAMP WHERE id = ?",
      JSON.stringify(out.map((o) => o.name)), att.id);
    removeFiles(UPLOAD_DIR, json<string[]>(att.files, []));
    students++; pages += out.length;
  }
  res.json({ students, pages, unmatched, ambiguous, busy, warnings });
}));

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
  const paper = paperFor(a.test_id);
  const t = one<{ org_id: string }>("SELECT org_id FROM tests WHERE id = ?", a.test_id);
  if (!paper || !t) return;
  run("UPDATE attempts SET status = 'evaluating', error = NULL WHERE id = ?", attemptId);
  try {
    const files = json<string[]>(a.files, []).map((f) => path.join(UPLOAD_DIR, f));
    const ev = await evaluateSheet(t.org_id, paper, files);
    if (!Array.isArray(ev?.questions)) throw new AiError("Claude's answer couldn't be read. Please try again.");
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
  const problem = aiProblem(req.user!.org_id);
  if (problem) return res.status(400).json({ error: problem });
  const only = z.array(z.string()).max(1000).optional().parse(req.body?.attempt_ids) ?? null;
  // Without a selection only new and failed sheets are marked; already-marked sheets are re-marked only when picked explicitly.
  const allowed = only ? ["uploaded", "failed", "evaluated"] : ["uploaded", "failed"];
  const ids = all<{ id: string; files: string; status: string }>("SELECT id, files, status FROM attempts WHERE test_id = ?", req.params.id)
    .filter((a) => allowed.includes(a.status) && json<string[]>(a.files, []).length && (!only || only.includes(a.id))).map((a) => a.id);
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
  const r = run("UPDATE tests SET results_published = ? WHERE id = ? AND org_id = ?", publish ? 1 : 0, req.params.id, req.user!.org_id);
  if (!r.changes) return res.status(404).json({ error: "Test not found" });
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

// After a restart, sheets that were queued or mid-evaluation are queued again automatically.
export function recoverEvaluations() {
  const ids = all<{ id: string }>("SELECT id FROM attempts WHERE status = 'evaluating'").map((a) => a.id);
  if (ids.length) { console.log(`Resuming ${ids.length} interrupted evaluation(s)`); enqueue(ids); }
}

/** Files to delete when a student is removed. */
export const studentFiles = (studentId: string) =>
  all<{ files: string }>("SELECT files FROM attempts WHERE student_id = ?", studentId).flatMap((a) => json<string[]>(a.files, []));
