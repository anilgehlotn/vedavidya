// Tests: scheduling, answer-sheet upload, AI evaluation, teacher review, result publishing and online (CBT) attempts.
import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { z } from "zod";
import { all, json, one, run, uid, UPLOAD_DIR } from "../db.js";
import { staff, requireRole } from "../auth.js";
import { evaluateSheet, AiError, aiProblem, modelFor } from "../ai/claude.js";
import { normalisePage, removeFiles, UploadError } from "../images.js";
import { queuePracticeForTest } from "./practice.js";
import { ensureSubtopics } from "./papers.js";
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

interface Paper { id: string; title: string; subject: string | null; instructions: string | null; total_marks: number; status: string; error: string | null; sections: Section[] }
const paperFor = (testId: string): Paper | null => {
  const p = one<any>("SELECT p.* FROM tests t JOIN question_papers p ON p.id = t.paper_id WHERE t.id = ?", testId);
  return p ? { ...p, sections: json<Section[]>(p.sections, []) } : null;
};
const questionsOf = (sections: Section[]) => sections.flatMap((s) => s.questions);
const isObjective = (q: Question) => q.type === "mcq" || q.type === "numeric";
/** Why a test's paper can't be used for marking yet, or null when it's ready. */
const paperProblem = (p: { status: string; sections: Section[]; total_marks: number; error?: string | null } | null) =>
  !p ? "Add the question paper first."
    : p.status === "generating" ? "The question paper is still being read. Try again in a minute."
    : p.status === "failed" ? `The question paper couldn't be read${p.error ? `: ${p.error}` : ""}. Upload it again.`
    : !questionsOf(p.sections).length || !(p.total_marks > 0) ? "The question paper has no questions yet. Add questions first." : null;
/** Checks a paper can be used for a test of this mode; returns an error message or null. */
function paperFitsTest(paper: any, mode: string): string | null {
  if (!paper) return "Pick a question paper from your institute";
  if (paper.status === "failed") return "That paper couldn't be read. Upload it again.";
  if (paper.status === "generating") return mode === "cbt" ? "Wait for the paper to be ready before using it in an online test" : null;
  const qs = questionsOf(json<Section[]>(paper.sections, []));
  if (!qs.length || !(paper.total_marks > 0)) return "This paper has no questions yet. Add questions first.";
  if (mode === "cbt" && !qs.every(isObjective)) return "Online (CBT) tests need a paper with only MCQ / numeric questions";
  return null;
}

testRoutes.get("/tests", staff, (req, res) => {
  res.json(all(`SELECT t.*, p.title AS paper_title, p.total_marks, p.status AS paper_status, coalesce(nullif(trim(t.subject),''), p.subject) AS subject,
      (SELECT group_concat(b.name, ', ') FROM test_batches tb JOIN batches b ON b.id = tb.batch_id WHERE tb.test_id = t.id) AS batch_names,
      (SELECT count(*) FROM attempts a WHERE a.test_id = t.id) AS candidates,
      (SELECT count(*) FROM attempts a WHERE a.test_id = t.id AND a.status = 'evaluated') AS evaluated,
      (SELECT count(*) FROM attempts a WHERE a.test_id = t.id AND a.files IS NOT NULL AND a.files != '[]') AS uploaded
    FROM tests t LEFT JOIN question_papers p ON p.id = t.paper_id WHERE t.org_id = ? ORDER BY coalesce(t.scheduled_at, t.created_at) DESC`, req.user!.org_id));
});

testRoutes.post("/tests", staff, (req, res) => {
  const b = z.object({
    title: z.string().trim().min(1).max(160), paper_id: z.string().max(60).nullish(), mode: z.enum(["offline", "cbt"]),
    subject: z.string().trim().max(60).nullish(),
    scheduled_at: z.string().max(40).nullish(), duration_min: z.number().int().min(5).max(360).optional(),
    batch_ids: z.array(z.string().max(60)).min(1).max(50),
  }).parse(req.body);
  const org = req.user!.org_id;
  // The question paper is optional here: teachers often create the test first and add the paper later.
  const paper = b.paper_id ? one<any>("SELECT * FROM question_papers WHERE id = ? AND org_id = ?", b.paper_id, org) : null;
  if (b.paper_id) { const why = paperFitsTest(paper, b.mode); if (why) return res.status(400).json({ error: why }); }
  const batchIds = [...new Set(b.batch_ids)].filter((bid) => one("SELECT 1 FROM batches WHERE id = ? AND org_id = ?", bid, org));
  if (!batchIds.length) return res.status(400).json({ error: "Pick at least one batch from your institute" });
  const id = uid("tst");
  run("INSERT INTO tests (id, org_id, paper_id, title, subject, mode, scheduled_at, duration_min) VALUES (?,?,?,?,?,?,?,?)",
    id, org, paper?.id ?? null, b.title, b.subject || paper?.subject || null, b.mode, b.scheduled_at || null, b.duration_min ?? paper?.duration_min ?? 60);
  for (const batchId of batchIds) {
    run("INSERT OR IGNORE INTO test_batches (test_id, batch_id) VALUES (?, ?)", id, batchId);
    // One attempt row per enrolled student, so the roster is ready for uploads.
    for (const s of all<{ student_id: string }>("SELECT student_id FROM enrollments WHERE batch_id = ?", batchId))
      run("INSERT OR IGNORE INTO attempts (id, test_id, student_id, max_score) VALUES (?,?,?,?)", uid("att"), id, s.student_id, paper?.total_marks ?? 0);
  }
  res.json({ id });
});

// Add or swap the question paper of a test (allowed until sheets have been marked).
testRoutes.put("/tests/:id/paper", staff, (req, res) => {
  const { paper_id } = z.object({ paper_id: z.string().max(60) }).parse(req.body);
  const org = req.user!.org_id;
  const t = one<any>("SELECT * FROM tests WHERE id = ? AND org_id = ?", req.params.id, org);
  if (!t) return res.status(404).json({ error: "Test not found" });
  const paper = one<any>("SELECT * FROM question_papers WHERE id = ? AND org_id = ?", paper_id, org);
  const why = paperFitsTest(paper, t.mode);
  if (why) return res.status(400).json({ error: why });
  if (t.paper_id !== paper_id) {
    const marked = one<{ n: number }>("SELECT count(*) n FROM attempts WHERE test_id = ? AND (status IN ('evaluating','evaluated','in_progress') OR score IS NOT NULL)", t.id)!.n;
    if (marked) return res.status(409).json({ error: `${marked} sheet${marked > 1 ? "s are" : " is"} already marked with the current paper. Create a new test to use a different paper.` });
  }
  run("UPDATE tests SET paper_id = ?, subject = coalesce(nullif(trim(subject),''), ?) WHERE id = ?", paper_id, paper.subject || null, t.id);
  if (!t.paper_id && !t.scheduled_at && paper.duration_min) run("UPDATE tests SET duration_min = ? WHERE id = ?", paper.duration_min, t.id);
  run("UPDATE attempts SET max_score = ? WHERE test_id = ? AND score IS NULL", paper.total_marks ?? 0, t.id);
  void ensureSubtopics(paper_id);
  res.json({ ok: true });
});

testRoutes.get("/tests/:id", staff, (req, res) => {
  const t = one<any>(`SELECT t.*, (SELECT group_concat(b.name, ', ') FROM test_batches tb JOIN batches b ON b.id = tb.batch_id WHERE tb.test_id = t.id) AS batch_names
    FROM tests t WHERE t.id = ? AND t.org_id = ?`, req.params.id, req.user!.org_id);
  if (!t) return res.status(404).json({ error: "Test not found" });
  // Safety net: every marked student of a published test has a parent report link.
  if (t.results_published)
    for (const m of all<{ id: string }>("SELECT a.id FROM attempts a WHERE a.test_id = ? AND a.score IS NOT NULL AND NOT EXISTS (SELECT 1 FROM share_tokens s WHERE s.attempt_id = a.id)", t.id))
      run("INSERT OR IGNORE INTO share_tokens (token, attempt_id) VALUES (?, ?)", crypto.randomBytes(12).toString("base64url"), m.id);
  const attempts = all<any>(`SELECT a.id, a.status, a.score, a.max_score, a.error, a.reviewed, a.files, a.submitted_at, a.evaluation,
      u.id AS student_id, u.name AS student_name, u.phone, e.parent_phone, e.roll_no, b.name AS batch_name,
      (SELECT token FROM share_tokens s WHERE s.attempt_id = a.id) AS share_token
    FROM attempts a JOIN users u ON u.id = a.student_id
    LEFT JOIN enrollments e ON e.student_id = u.id LEFT JOIN batches b ON b.id = e.batch_id
    WHERE a.test_id = ? ORDER BY b.name, CAST(e.roll_no AS INTEGER), u.name`, t.id)
    .map(({ evaluation, ...a }) => ({ ...a, files: json<string[]>(a.files, []).length,
      // Answers the teacher should look at (cleared once the sheet is reviewed).
      checks: a.reviewed ? 0 : (json<SheetEvaluation | null>(evaluation, null)?.questions ?? []).filter((q) => (q as CheckedQ).needs_review).length }));
  const paper = paperFor(t.id);
  res.json({ ...t, paper, paper_problem: paperProblem(paper), attempts });
});

testRoutes.delete("/tests/:id", staff, (req, res) => {
  const t = one<{ results_published: number }>("SELECT id, results_published FROM tests WHERE id = ? AND org_id = ?", req.params.id, req.user!.org_id);
  if (!t) return res.status(404).json({ error: "Test not found" });
  if (t.results_published && req.user!.role !== "admin") return res.status(403).json({ error: "Results are published. Only an admin can delete this test." });
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
    // Keep the mistake label consistent with the marks.
    const m = qe as typeof qe & { mistake_type?: string; mistake_note?: string };
    if (!qe.attempted) m.mistake_type = "not_attempted";
    else if (qe.marks_awarded >= q.marks) { m.mistake_type = "none"; m.mistake_note = ""; }
    else if (!m.mistake_type || m.mistake_type === "none") m.mistake_type = "incomplete";
  }
  return ev.questions.filter((qe) => byId.has(qe.question_id)).reduce((t, qe) => t + qe.marks_awarded, 0);
}

// ---- Second check (mixed mode): the low-cost model marks every sheet; doubtful answers are marked again,
// independently, by a stronger model. Big disagreements are flagged for the teacher. ----
type CheckedQ = SheetEvaluation["questions"][number] & { second_check?: "agreed" | "changed" | "failed"; first_marks?: number; needs_review?: boolean; check_note?: string };

/** Questions worth a second look: unsure handwriting, partial marks on longer written answers, marks that don't add up, or a total near the pass mark. */
export function doubtfulQuestions(ev: SheetEvaluation, questions: Question[]): string[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const max = questions.reduce((t, q) => t + q.marks, 0);
  const total = ev.questions.reduce((t, q) => t + (byId.has(q.question_id) ? q.marks_awarded : 0), 0);
  const nearPass = max > 0 && Math.abs(total / max - 0.33) <= 0.05;
  const ids: string[] = [];
  for (const qe of ev.questions) {
    const q = byId.get(qe.question_id);
    if (!q) continue;
    const written = !isObjective(q);
    const stepSum = qe.steps.reduce((t, st) => t + st.awarded, 0);
    if (qe.confidence !== "high"
      || (written && q.marks >= 4 && qe.marks_awarded > 0 && qe.marks_awarded < q.marks)
      || (written && qe.steps.length > 0 && Math.abs(stepSum - qe.marks_awarded) > 0.01)
      || (written && nearPass && qe.marks_awarded < q.marks)) ids.push(q.id);
  }
  return ids;
}

/** Merges the second marking into the first. Returns how many answers now need the teacher. */
export function mergeSecondCheck(ev: SheetEvaluation, second: SheetEvaluation | null, ids: string[], questions: Question[]) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const again = new Map((second?.questions ?? []).map((q) => [q.question_id, q]));
  ev.questions = ev.questions.map((qe0) => {
    const qe = qe0 as CheckedQ;
    const q = byId.get(qe.question_id);
    if (!q || !ids.includes(qe.question_id)) return qe;
    const b = again.get(qe.question_id) as CheckedQ | undefined;
    if (!b) return { ...qe, second_check: "failed", needs_review: true, check_note: "The second check didn't finish. Please check this answer." } as CheckedQ;
    const gap = Math.abs(qe.marks_awarded - b.marks_awarded);
    if (gap <= Math.max(0.5, q.marks * 0.1)) return { ...qe, second_check: "agreed", needs_review: qe.confidence === "low" && b.confidence === "low" } as CheckedQ;
    // They disagree: trust the stronger model, keep the first mark for the teacher to see.
    const big = gap >= Math.max(1, q.marks * 0.25) || b.confidence === "low";
    return { ...b, second_check: "changed", first_marks: qe.marks_awarded, needs_review: big,
      check_note: big ? `Two AI checks disagreed (${qe.marks_awarded} vs ${b.marks_awarded} of ${q.marks}). Please check.` : "" } as CheckedQ;
  });
  return ev.questions.filter((q) => (q as CheckedQ).needs_review).length;
}

async function runEvaluation(attemptId: string) {
  const a = one<any>("SELECT * FROM attempts WHERE id = ?", attemptId);
  if (!a) return;
  const paper = paperFor(a.test_id);
  const t = one<{ org_id: string }>("SELECT org_id FROM tests WHERE id = ?", a.test_id);
  if (!t) return;
  const problem = paperProblem(paper);
  if (problem) { run("UPDATE attempts SET status = 'failed', error = ? WHERE id = ?", problem, attemptId); return; }
  run("UPDATE attempts SET status = 'evaluating', error = NULL WHERE id = ?", attemptId);
  try {
    const files = json<string[]>(a.files, []).map((f) => path.join(UPLOAD_DIR, f));
    const ev = await evaluateSheet(t.org_id, paper!, files, "marking");
    if (!Array.isArray(ev?.questions)) throw new AiError("Claude's answer couldn't be read. Please try again.");
    const questions = questionsOf(paper!.sections);
    scoreEvaluation(ev, questions);
    // Unsure answers are always flagged; in mixed mode doubtful ones are also marked again by a stronger model.
    for (const qe of ev.questions as CheckedQ[]) if (qe.confidence === "low") { qe.needs_review = true; qe.check_note = "Handwriting was hard to read. Please check."; }
    const doubtful = modelFor(t.org_id, "recheck") ? doubtfulQuestions(ev, questions) : [];
    if (doubtful.length) {
      const subset = { ...paper!, sections: paper!.sections.map((sec) => ({ ...sec, questions: sec.questions.filter((q) => doubtful.includes(q.id)) })).filter((sec) => sec.questions.length) };
      let second: SheetEvaluation | null = null;
      try { second = await evaluateSheet(t.org_id, subset, files, "recheck"); if (second?.questions) scoreEvaluation(second, questions); }
      catch (e) { console.error(`Second check failed for ${attemptId}:`, e instanceof AiError ? e.message : e); }
      mergeSecondCheck(ev, second, doubtful, questions);
    }
    const score = scoreEvaluation(ev, questions);
    run("UPDATE attempts SET status = 'evaluated', evaluation = ?, score = ?, max_score = ?, reviewed = 0, evaluated_at = CURRENT_TIMESTAMP WHERE id = ?",
      JSON.stringify(ev), score, paper!.total_marks, attemptId);
    // A re-marked sheet gets a fresh Fix-it plan (if results are already out).
    if (one("SELECT 1 FROM practice_sets WHERE attempt_id = ?", attemptId)) {
      run("DELETE FROM practice_sets WHERE attempt_id = ?", attemptId);
      if (one("SELECT 1 FROM tests WHERE id = ? AND results_published = 1", a.test_id)) queuePracticeForTest(a.test_id, [attemptId]);
    }
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
  const paperIssue = paperProblem(paperFor(req.params.id));
  if (paperIssue) return res.status(400).json({ error: paperIssue });
  const problem = aiProblem(req.user!.org_id);
  if (problem) return res.status(400).json({ error: problem });
  const only = z.array(z.string()).max(1000).optional().parse(req.body?.attempt_ids) ?? null;
  // Without a selection only new and failed sheets are marked; already-marked sheets are re-marked only when picked explicitly.
  const allowed = only ? ["uploaded", "failed", "evaluated"] : ["uploaded", "failed"];
  const ids = all<{ id: string; files: string; status: string }>("SELECT id, files, status FROM attempts WHERE test_id = ?", req.params.id)
    .filter((a) => allowed.includes(a.status) && json<string[]>(a.files, []).length && (!only || only.includes(a.id))).map((a) => a.id);
  enqueue(ids);
  const pid = one<{ paper_id: string }>("SELECT paper_id FROM tests WHERE id = ?", req.params.id)?.paper_id;
  if (pid) void ensureSubtopics(pid);
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
  const edits = z.array(z.object({ question_id: z.string().max(40), marks_awarded: z.number().finite().min(-1000).max(1000), feedback: z.string().max(2000).optional() })).max(500).parse(req.body?.questions);
  for (const e of edits) {
    const qe = ev.questions.find((q) => q.question_id === e.question_id);
    if (qe) { qe.marks_awarded = e.marks_awarded; if (e.feedback !== undefined) qe.feedback = e.feedback; }
  }
  const score = scoreEvaluation(ev, questionsOf(paperFor(a.test_id)?.sections ?? []));
  run("UPDATE attempts SET evaluation = ?, score = ?, reviewed = 1 WHERE id = ?", JSON.stringify(ev), score, a.id);
  res.json({ ok: true, score });
});

testRoutes.post("/tests/:id/publish", staff, (req, res) => {
  const publish = req.body?.publish !== false;
  const r = run("UPDATE tests SET results_published = ? WHERE id = ? AND org_id = ?", publish ? 1 : 0, req.params.id, req.user!.org_id);
  if (!r.changes) return res.status(404).json({ error: "Test not found" });
  let practiceQueued = 0;
  if (publish) {
    for (const a of all<{ id: string }>("SELECT id FROM attempts WHERE test_id = ? AND score IS NOT NULL", req.params.id))
      run("INSERT OR IGNORE INTO share_tokens (token, attempt_id) VALUES (?, ?)", crypto.randomBytes(12).toString("base64url"), a.id);
    // Each student who lost marks gets a personal Fix-it practice set (only once per sheet).
    if (req.body?.practice !== false) practiceQueued = queuePracticeForTest(req.params.id);
  }
  res.json({ ok: true, practice_queued: practiceQueued });
});

testRoutes.get("/tests/:id/results.csv", staff, (req, res) => {
  const t = one<any>("SELECT * FROM tests WHERE id = ? AND org_id = ?", req.params.id, req.user!.org_id);
  if (!t) return res.status(404).end();
  const rows = all<any>(`SELECT u.name, e.roll_no, b.name AS batch, a.score, a.max_score, a.status FROM attempts a
    JOIN users u ON u.id = a.student_id LEFT JOIN enrollments e ON e.student_id = u.id LEFT JOIN batches b ON b.id = e.batch_id
    WHERE a.test_id = ? ORDER BY a.score DESC`, t.id);
  const esc = (v: unknown) => `"${csvSafe(v).replace(/"/g, '""')}"`;
  res.type("text/csv").attachment(`${t.title.replace(/\W+/g, "_")}_results.csv`)
    .send(["Rank,Name,Roll No,Batch,Score,Max,Status", ...rows.map((r, i) => [r.score == null ? "" : i + 1, r.name, r.roll_no, r.batch, r.score, r.max_score, r.status].map(esc).join(","))].join("\n"));
});

// Spreadsheet apps run cells starting with = + - @ as formulas; prefix them so names can't inject formulas.
const csvSafe = (v: unknown) => { const t = String(v ?? ""); return /^[=+\-@\t\r]/.test(t) ? `'${t}` : t; };

// ---------------- Student side ----------------
testRoutes.get("/my/tests", student, (req, res) => {
  // Scores stay hidden until the teacher publishes the results.
  res.json(all(`SELECT t.id, t.title, t.mode, t.scheduled_at, t.duration_min, t.results_published, coalesce(nullif(trim(t.subject),''), p.subject) AS subject, p.total_marks, (t.paper_id IS NOT NULL AND p.status IN ('draft','approved')) AS paper_ready,
      a.id AS attempt_id, a.status,
      CASE WHEN t.results_published = 1 THEN a.score END AS score, CASE WHEN t.results_published = 1 THEN a.max_score END AS max_score
    FROM attempts a JOIN tests t ON t.id = a.test_id LEFT JOIN question_papers p ON p.id = t.paper_id
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
  const ready = paperFor(a.test_id);
  if (paperProblem(ready)) return res.status(400).json({ error: "Your teacher hasn't added the question paper yet" });
  if (a.status === "pending") run("UPDATE attempts SET status = 'in_progress', started_at = CURRENT_TIMESTAMP WHERE id = ?", a.id);
  const fresh = myCbtAttempt(req.params.testId, req.user!.id);
  const paper = ready!;
  // Strip answers and solutions before sending the paper to the student.
  const sections = paper.sections.map((s) => ({ ...s, questions: s.questions.map(({ correct_option, numeric_answer, solution, rubric, ...q }) => q) }));
  res.json({ attempt_id: a.id, title: a.title, remaining_seconds: remainingSeconds(fresh), responses: json(fresh.responses, {}), sections, instructions: paper.instructions });
});

const Responses = z.record(z.string().max(40), z.object({ answer: z.number().finite().nullable(), review: z.boolean().optional() }))
  .refine((r) => Object.keys(r).length <= 500, "Too many answers");
const GRACE_SECONDS = 120; // allows for slow connections at the final auto-submit

testRoutes.put("/cbt/:testId/responses", student, (req, res) => {
  const a = myCbtAttempt(req.params.testId, req.user!.id);
  if (!a || a.status !== "in_progress") return res.status(400).json({ error: "Test is not in progress" });
  if (remainingSeconds(a) <= 0) return res.status(400).json({ error: "Time is up" });
  run("UPDATE attempts SET responses = ? WHERE id = ?", JSON.stringify(Responses.parse(req.body?.responses ?? {})), a.id);
  res.json({ ok: true, remaining_seconds: remainingSeconds(a) });
});

testRoutes.post("/cbt/:testId/submit", student, (req, res) => {
  const a = myCbtAttempt(req.params.testId, req.user!.id);
  if (!a || a.status !== "in_progress") return res.status(400).json({ error: "Test is not in progress" });
  // After time (plus a short grace) only the last autosaved answers count.
  const late = remainingSeconds(a) <= 0 && a.started_at && Date.now() - Date.parse(a.started_at.replace(" ", "T") + "Z") > (a.duration_min * 60 + GRACE_SECONDS) * 1000;
  const responses = late || !req.body?.responses ? Responses.parse(json(a.responses, {})) : Responses.parse(req.body.responses);
  const paper = paperFor(a.test_id);
  if (!paper) return res.status(400).json({ error: "This test has no question paper" });
  const evQuestions = questionsOf(paper.sections).map((q) => {
    const given = responses[q.id]?.answer;
    const attempted = given !== null && given !== undefined && given !== ("" as any);
    const correct = q.type === "mcq" ? Number(given) === q.correct_option : Math.abs(Number(given) - (q.numeric_answer ?? NaN)) < 1e-6;
    const marks = !attempted ? 0 : correct ? q.marks : -q.negative_marks;
    return {
      question_id: q.id, attempted, transcription: attempted ? String(q.type === "mcq" ? q.options[Number(given)] ?? given : given) : "",
      steps: [], marks_awarded: marks, max_marks: q.marks, confidence: "high" as const,
      feedback: !attempted ? "Not attempted." : correct ? "Correct." : `Incorrect. ${q.solution}`,
      mistake_type: (!attempted ? "not_attempted" : correct ? "none" : "concept") as "none" | "concept" | "not_attempted",
      mistake_note: !attempted || correct ? "" : "Chose a wrong answer",
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
