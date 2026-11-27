// Tests: scheduling, answer-sheet upload, AI evaluation, teacher review, result publishing and online (CBT) attempts.
import { Router, type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { all, json, one, run, uid } from "../db.js";
import { staff, requireRole } from "../auth.js";
import { evaluateSheet, identifyPages, AiError, aiProblem, modelFor } from "../ai/claude.js";
import sharp from "sharp";
import { groupPages } from "../lib/sheetmap.js";
import { CreditError } from "../lib/credits.js";
import { storage } from "../lib/storage.js";
import { enqueueJob, latestJob, PermanentError, registerJob } from "../lib/jobs.js";
import { createDocument, deleteDocuments, documentPages, documentsOfTest, getDocument, onDocumentReady } from "../lib/documents.js";
import { FileProblem } from "../lib/files.js";
import { takeUploads } from "./uploads.js";
import { inOrg, subjectInCourse } from "../lib/scope.js";
import { charge, priceOf, refund, requireCredits } from "../lib/credits.js";
import { queuePracticeForTest } from "./practice.js";
import { ensureSubtopics } from "./papers.js";
import type { Question, Section, SheetEvaluation } from "../ai/schemas.js";

export const testRoutes = Router();
const student = requireRole("student");

// Express 4 doesn't catch rejected promises from async handlers.
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

interface Paper { id: string; title: string; subject: string | null; instructions: string | null; total_marks: number; status: string; error: string | null; sections: Section[]; marking_notes?: string | null }
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

/** draft (no paper yet) · scheduled (window not started) · live · completed (window over or results out). */
export function testStatus(t: { paper_id: string | null; scheduled_at: string | null; window_end: string | null; duration_min: number | null; results_published: number; mode: string }) {
  if (t.results_published) return "completed";
  if (!t.paper_id) return "draft";
  const start = t.scheduled_at ? Date.parse(t.scheduled_at) : NaN;
  const end = t.window_end ? Date.parse(t.window_end) : Number.isFinite(start) ? start + (t.duration_min ?? 60) * 60000 : NaN;
  if (Number.isFinite(start) && Date.now() < start) return "scheduled";
  if (Number.isFinite(end) && Date.now() > end) return "completed";
  return t.mode === "cbt" ? "live" : Number.isFinite(start) ? "completed" : "scheduled";
}

testRoutes.get("/tests", staff, (req, res) => {
  res.json(all<any>(`SELECT t.*, c.name AS course_name, s.name AS subject_name, p.title AS paper_title, p.total_marks, p.status AS paper_status, coalesce(nullif(trim(t.subject),''), p.subject) AS subject,
      (SELECT group_concat(b.name, ', ') FROM test_batches tb JOIN batches b ON b.id = tb.batch_id WHERE tb.test_id = t.id) AS batch_names,
      (SELECT count(*) FROM attempts a WHERE a.test_id = t.id) AS candidates,
      (SELECT count(*) FROM attempts a WHERE a.test_id = t.id AND a.status = 'evaluated') AS evaluated,
      (SELECT round(avg(a.score * 100.0 / a.max_score)) FROM attempts a WHERE a.test_id = t.id AND a.score IS NOT NULL AND a.max_score > 0) AS avg_pct,
      (SELECT count(*) FROM attempts a WHERE a.test_id = t.id AND a.files IS NOT NULL AND a.files != '[]') AS uploaded
    FROM tests t LEFT JOIN question_papers p ON p.id = t.paper_id LEFT JOIN courses c ON c.id = t.course_id LEFT JOIN subjects s ON s.id = t.subject_id
    WHERE t.org_id = ? ORDER BY coalesce(t.scheduled_at, t.created_at) DESC`, req.user!.org_id).map((t) => ({ ...t, state: testStatus(t) })));
});

// ---- Manage Tests: stats and a results summary, for a course / subject / time range ----
const TestScope = z.object({
  course_id: z.string().max(60).optional(), subject_id: z.string().max(60).optional(),
  range: z.enum(["30d", "90d", "180d", "365d", "all"]).default("all"),
});
const RANGE_DAYS: Record<string, number | null> = { "30d": 30, "90d": 90, "180d": 180, "365d": 365, all: null };
function testScope(org: string, q: z.infer<typeof TestScope>) {
  const where = ["t.org_id = ?"], args: unknown[] = [org];
  if (q.course_id) { where.push("t.course_id = ?"); args.push(q.course_id); }
  if (q.subject_id) { where.push("t.subject_id = ?"); args.push(q.subject_id); }
  const days = RANGE_DAYS[q.range];
  if (days) { where.push("coalesce(t.scheduled_at, t.created_at) >= ?"); args.push(new Date(Date.now() - days * 86400000).toISOString().replace("T", " ").slice(0, 19)); }
  return { where: where.join(" AND "), args };
}
testRoutes.get("/tests/stats", staff, (req, res) => {
  const q = TestScope.parse(req.query);
  const org = req.user!.org_id;
  const { where, args } = testScope(org, q);
  const tests = all<any>(`SELECT t.id, t.paper_id, t.scheduled_at, t.window_end, t.duration_min, t.results_published, t.mode,
      (SELECT count(*) FROM attempts a WHERE a.test_id = t.id AND a.status = 'evaluated') AS evaluated,
      (SELECT count(*) FROM attempts a WHERE a.test_id = t.id AND a.files IS NOT NULL AND a.files != '[]' AND a.status IN ('uploaded','failed')) AS to_mark
    FROM tests t WHERE ${where}`, ...args);
  // Monthly averages ignore the time range (they are "this month" and "last month"), but follow course / subject.
  const { where: w2, args: a2 } = testScope(org, { ...q, range: "all" });
  const monthAvg = (offset: number) => {
    const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - offset);
    const from = d.toISOString().slice(0, 7);
    return one<{ v: number | null; n: number }>(`SELECT avg(a.score * 100.0 / a.max_score) v, count(*) n FROM attempts a JOIN tests t ON t.id = a.test_id
      WHERE ${w2} AND a.score IS NOT NULL AND a.max_score > 0 AND substr(coalesce(t.scheduled_at, t.created_at), 1, 7) = ?`, ...a2, from);
  };
  const now = monthAvg(0), prev = monthAvg(1);
  const round = (v: number | null | undefined) => (v == null ? null : Math.round(v));
  const states = tests.map((t) => testStatus(t));
  res.json({
    tests: tests.length,
    sheets_marked: tests.reduce((t, x) => t + x.evaluated, 0),
    avg_this_month: round(now?.v), avg_last_month: round(prev?.v), results_this_month: now?.n ?? 0,
    change: now?.v != null && prev?.v != null ? Math.round(now.v - prev.v) : null,
    to_mark: tests.reduce((t, x) => t + x.to_mark, 0),
    to_publish: tests.filter((t) => !t.results_published && t.evaluated > 0).length,
    by_state: { draft: states.filter((s) => s === "draft").length, scheduled: states.filter((s) => s === "scheduled").length, live: states.filter((s) => s === "live").length, completed: states.filter((s) => s === "completed").length },
  });
});
/** One row per test: date, class, students, marked, average, highest, published. */
testRoutes.get("/tests/summary.csv", staff, (req, res) => {
  const q = TestScope.parse(req.query);
  const { where, args } = testScope(req.user!.org_id, q);
  const rows = all<any>(`SELECT t.title, coalesce(t.scheduled_at, t.created_at) AS d, co.name AS course, s.name AS subject_name, t.subject,
      (SELECT group_concat(b.name, ' / ') FROM test_batches tb JOIN batches b ON b.id = tb.batch_id WHERE tb.test_id = t.id) AS batches,
      (SELECT count(*) FROM attempts a WHERE a.test_id = t.id) AS students,
      (SELECT count(*) FROM attempts a WHERE a.test_id = t.id AND a.status = 'evaluated') AS marked,
      (SELECT round(avg(a.score * 100.0 / a.max_score), 1) FROM attempts a WHERE a.test_id = t.id AND a.score IS NOT NULL AND a.max_score > 0) AS avg_pct,
      (SELECT round(max(a.score * 100.0 / a.max_score), 1) FROM attempts a WHERE a.test_id = t.id AND a.score IS NOT NULL AND a.max_score > 0) AS high_pct,
      t.results_published
    FROM tests t LEFT JOIN courses co ON co.id = t.course_id LEFT JOIN subjects s ON s.id = t.subject_id WHERE ${where} ORDER BY d DESC`, ...args);
  const esc = (v: unknown) => `"${csvSafe(v).replace(/"/g, '""')}"`;
  res.type("text/csv").attachment("test_results_summary.csv").send([
    "Test,Date,Course,Subject,Batches,Students,Marked,Average %,Highest %,Published",
    ...rows.map((r) => [r.title, String(r.d).slice(0, 10), r.course, r.subject_name ?? r.subject, r.batches, r.students, r.marked, r.avg_pct, r.high_pct, r.results_published ? "Yes" : "No"].map(esc).join(",")),
  ].join("\n"));
});

testRoutes.post("/tests", staff, (req, res) => {
  const b = z.object({
    title: z.string().trim().min(1).max(160), paper_id: z.string().max(60).nullish(), mode: z.enum(["offline", "cbt"]),
    subject: z.string().trim().max(60).nullish(), course_id: z.string().max(60).nullish(), subject_id: z.string().max(60).nullish(),
    scheduled_at: z.string().max(40).nullish(), window_end: z.string().max(40).nullish(), duration_min: z.number().int().min(5).max(360).optional(),
    batch_ids: z.array(z.string().max(60)).min(1).max(50),
  }).parse(req.body);
  const org = req.user!.org_id;
  if (!inOrg("courses", b.course_id, org) || !inOrg("subjects", b.subject_id, org) || !subjectInCourse(b.subject_id, b.course_id))
    return res.status(400).json({ error: "Pick a course and subject from your institute" });
  if (b.window_end && b.scheduled_at && Date.parse(b.window_end) <= Date.parse(b.scheduled_at)) return res.status(400).json({ error: "The test window must end after it starts" });
  // The question paper is optional here: teachers often create the test first and add the paper later.
  const paper = b.paper_id ? one<any>("SELECT * FROM question_papers WHERE id = ? AND org_id = ?", b.paper_id, org) : null;
  if (b.paper_id) { const why = paperFitsTest(paper, b.mode); if (why) return res.status(400).json({ error: why }); }
  const batchIds = [...new Set(b.batch_ids)].filter((bid) => one("SELECT 1 FROM batches WHERE id = ? AND org_id = ?", bid, org));
  if (!batchIds.length) return res.status(400).json({ error: "Pick at least one batch from your institute" });
  // Course and subject: as given, otherwise from the batches' course and the subject name (created if new).
  const courseId = b.course_id ?? one<{ course_id: string }>(`SELECT course_id FROM batches WHERE id IN (${batchIds.map(() => "?").join(",")}) AND course_id IS NOT NULL LIMIT 1`, ...batchIds)?.course_id ?? null;
  const subjectName = b.subject || paper?.subject || null;
  let subjectId = b.subject_id ?? null;
  if (!subjectId && courseId && subjectName) {
    subjectId = one<{ id: string }>("SELECT id FROM subjects WHERE course_id = ? AND name = ? COLLATE NOCASE", courseId, subjectName)?.id ?? null;
    if (!subjectId) { subjectId = uid("sub"); run("INSERT INTO subjects (id, org_id, course_id, name) VALUES (?,?,?,?)", subjectId, org, courseId, subjectName); }
  }
  const subjectText = subjectName ?? (subjectId ? one<{ name: string }>("SELECT name FROM subjects WHERE id = ?", subjectId)?.name ?? null : null);
  const id = uid("tst");
  run("INSERT INTO tests (id, org_id, paper_id, title, subject, mode, scheduled_at, window_end, duration_min, course_id, subject_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    id, org, paper?.id ?? null, b.title, subjectText, b.mode, b.scheduled_at || null, b.window_end || null, b.duration_min ?? paper?.duration_min ?? 60, courseId, subjectId);
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
      (SELECT d.status FROM documents d WHERE d.attempt_id = a.id AND d.status IN ('queued','processing') ORDER BY d.created_at DESC LIMIT 1) AS processing,
      u.id AS student_id, u.name AS student_name, u.phone, e.parent_phone, e.roll_no, b.name AS batch_name,
      (SELECT token FROM share_tokens s WHERE s.attempt_id = a.id) AS share_token
    FROM attempts a JOIN users u ON u.id = a.student_id
    LEFT JOIN enrollments e ON e.student_id = u.id LEFT JOIN batches b ON b.id = e.batch_id
    WHERE a.test_id = ? ORDER BY b.name, CAST(e.roll_no AS INTEGER), u.name`, t.id)
    .map(({ evaluation, ...a }) => ({ ...a, files: json<string[]>(a.files, []).length,
      // Answers the teacher should look at (cleared once the sheet is reviewed).
      checks: a.reviewed ? 0 : (json<SheetEvaluation | null>(evaluation, null)?.questions ?? []).filter((q) => (q as CheckedQ).needs_review).length }));
  const paper = paperFor(t.id);
  // Whole-class uploads (scans / ZIPs) and how far their processing has got.
  const uploads = all<any>("SELECT id, title, status, error, pages, size, created_at FROM documents WHERE test_id = ? AND purpose = 'class_sheets' ORDER BY created_at DESC", t.id);
  const names = one<{ course_name: string | null; subject_name: string | null }>("SELECT (SELECT name FROM courses WHERE id = ?) course_name, (SELECT name FROM subjects WHERE id = ?) subject_name", t.course_id, t.subject_id);
  res.json({ ...t, ...names, state: testStatus(t), paper, paper_problem: paperProblem(paper), attempts, uploads });
});

testRoutes.delete("/tests/:id", staff, wrap(async (req, res) => {
  const t = one<{ results_published: number }>("SELECT id, results_published FROM tests WHERE id = ? AND org_id = ?", req.params.id, req.user!.org_id);
  if (!t) return res.status(404).json({ error: "Test not found" });
  if (t.results_published && req.user!.role !== "admin") return res.status(403).json({ error: "Results are published. Only an admin can delete this test." });
  const files = all<{ files: string }>("SELECT files FROM attempts WHERE test_id = ?", req.params.id).flatMap((a) => json<string[]>(a.files, []));
  const docs = documentsOfTest(req.params.id);
  await deleteDocuments(docs);
  run("DELETE FROM tests WHERE id = ? AND org_id = ?", req.params.id, req.user!.org_id);
  await storage.remove(files.filter((f) => !f.startsWith("docs/"))); // older uploads stored outside documents
  res.json({ ok: true });
}));

const attemptInOrg = (attemptId: string, orgId: string) =>
  one<any>("SELECT a.* FROM attempts a JOIN tests t ON t.id = a.test_id WHERE a.id = ? AND t.org_id = ?", attemptId, orgId);

// ---------------- Answer-sheet uploads ----------------
// Files arrive through resumable uploads (/uploads). Here they become documents; turning them into page
// images happens in a background job, and the pages are then attached to the student's attempt.

/** Gives an attempt its pages, and deletes the student's previous sheet files (pages of a class upload stay with that upload). */
async function setAttemptPages(attemptId: string, keys: string[]) {
  const a = one<{ files: string }>("SELECT files FROM attempts WHERE id = ?", attemptId);
  if (!a) return;
  const previous = json<string[]>(a.files, []);
  run("UPDATE attempts SET files = ?, status = 'uploaded', error = NULL, evaluation = NULL, score = NULL, reviewed = 0, submitted_at = CURRENT_TIMESTAMP WHERE id = ?",
    JSON.stringify(keys), attemptId);
  await storage.remove(previous.filter((k) => !k.startsWith("docs/") && !keys.includes(k)));
  const stale = all<{ id: string }>("SELECT id FROM documents WHERE attempt_id = ? AND purpose = 'student_sheet' AND status IN ('completed','failed')", attemptId)
    .map((d) => d.id).filter((id) => !documentPages(id).some((p) => keys.includes(p.storage_key)));
  await deleteDocuments(stale);
}

onDocumentReady("student_sheet", async (doc) => {
  if (doc.attempt_id) await setAttemptPages(doc.attempt_id, documentPages(doc.id).map((p) => p.storage_key));
}, (doc, message) => {
  if (doc.attempt_id) run("UPDATE attempts SET error = ? WHERE id = ?", `Upload failed: ${message}`, doc.attempt_id);
});
// A class upload: with "find students" on, the AI reads each page's header next; otherwise the teacher assigns pages.
onDocumentReady("class_sheets", (doc) => {
  if (!(doc as { identify?: number }).identify || !doc.test_id) return;
  const pages = documentPages(doc.id);
  run("INSERT OR IGNORE INTO sheet_pages (document_id, page_no, test_id) SELECT ?, page_no, ? FROM document_pages WHERE document_id = ?", doc.id, doc.test_id, doc.id);
  let chargeRef: string | null = null;
  try { chargeRef = charge(doc.org_id, "identify_pages", `identify:${doc.id}`, { units: pages.length, userId: one<{ created_by: string | null }>("SELECT created_by FROM documents WHERE id = ?", doc.id)?.created_by ?? undefined }); }
  catch (e) {
    if (e instanceof CreditError) { run("UPDATE documents SET error = ? WHERE id = ?", `Students weren't found automatically: ${e.message} You can still give pages to students by roll-number order.`, doc.id); return; }
    throw e;
  }
  enqueueJob("identify_pages", { document_id: doc.id, org_id: doc.org_id, charge_ref: chargeRef }, { orgId: doc.org_id, dedupeKey: `identify:${doc.id}` });
});

const UploadIds = z.object({ upload_ids: z.array(z.string().max(60)).min(1, "Choose at least one file").max(400) });
const offlineAttempt = (id: string, orgId: string) =>
  one<any>("SELECT a.*, t.mode, t.org_id FROM attempts a JOIN tests t ON t.id = a.test_id WHERE a.id = ? AND t.org_id = ?", id, orgId);

// One student's sheet (photos or a PDF). Replaces their previous pages once the new ones are ready.
testRoutes.post("/attempts/:id/files", staff, wrap(async (req, res) => {
  const { upload_ids } = UploadIds.parse(req.body);
  const a = offlineAttempt(req.params.id, req.user!.org_id);
  if (!a) return res.status(404).json({ error: "Not found" });
  if (a.mode !== "offline") return res.status(400).json({ error: "Online tests don't take uploaded sheets" });
  if (a.status === "evaluating") return res.status(409).json({ error: "This sheet is being marked right now. Wait for it to finish, then upload again." });
  const ups = takeUploads(upload_ids, req.user!, "student_sheet");
  const pages = ups.reduce((t, u) => t + (u.pages ?? 1), 0);
  if (pages > 40) return res.status(400).json({ error: `That's ${pages} pages for one student. The limit is 40.` });
  run("UPDATE attempts SET error = NULL WHERE id = ?", a.id);
  const id = await createDocument({ orgId: req.user!.org_id, userId: req.user!.id, purpose: "student_sheet", uploads: ups, testId: undefined, attemptId: a.id });
  res.json({ document_id: id, pages });
}));

// Files named by roll number ("7.jpg", "07-1.jpg", "Roll 7 page 2.png"): matched to students, one document each.
testRoutes.post("/tests/:id/bulk-files", staff, wrap(async (req, res) => {
  const { upload_ids } = UploadIds.parse(req.body);
  const batchId = typeof req.body?.batch_id === "string" && req.body.batch_id ? req.body.batch_id : null;
  const t = one<any>("SELECT * FROM tests WHERE id = ? AND org_id = ?", req.params.id, req.user!.org_id);
  if (!t) return res.status(404).json({ error: "Test not found" });
  if (t.mode !== "offline") return res.status(400).json({ error: "Online tests don't take uploaded sheets" });
  const ups = takeUploads(upload_ids, req.user!, "student_sheet");
  const roster = all<{ id: string; status: string; roll_no: string | null }>(`SELECT a.id, a.status, e.roll_no FROM attempts a
    LEFT JOIN enrollments e ON e.student_id = a.student_id WHERE a.test_id = ? ${batchId ? "AND e.batch_id = ?" : ""}`, ...(batchId ? [t.id, batchId] : [t.id]));
  const byRoll = new Map<string, typeof roster[number]>();
  const dupes = new Set<string>();
  for (const r of roster) {
    if (!r.roll_no) continue;
    const k = String(Number(r.roll_no.replace(/\D/g, "")) || r.roll_no.trim().toLowerCase());
    if (byRoll.has(k)) dupes.add(k); else byRoll.set(k, r);
  }
  for (const k of dupes) byRoll.delete(k);
  const rollOf = (name: string) => { const m = name.match(/^\D{0,8}?(\d+)/); return m ? String(Number(m[1])) : null; };
  const groups = new Map<string, typeof ups>();
  const unmatched: string[] = [], ambiguous: string[] = [], busy: string[] = [];
  for (const u of ups) {
    const roll = rollOf(u.filename);
    if (roll && dupes.has(roll)) { ambiguous.push(u.filename); continue; }
    const att = roll ? byRoll.get(roll) : undefined;
    if (!att) { unmatched.push(u.filename); continue; }
    if (att.status === "evaluating") { busy.push(u.filename); continue; }
    groups.set(roll!, [...(groups.get(roll!) ?? []), u]);
  }
  const collator = new Intl.Collator(undefined, { numeric: true });
  let students = 0, files = 0;
  for (const [roll, list] of groups) {
    list.sort((x, y) => collator.compare(x.filename, y.filename));
    await createDocument({ orgId: req.user!.org_id, userId: req.user!.id, purpose: "student_sheet", uploads: list, attemptId: byRoll.get(roll)!.id });
    students++; files += list.length;
  }
  // Files that matched nobody are discarded.
  for (const name of [...unmatched, ...ambiguous, ...busy]) {
    const u = ups.find((x) => x.filename === name);
    if (u) run("UPDATE upload_sessions SET status = 'aborted' WHERE id = ?", u.id);
  }
  res.json({ students, files, unmatched, ambiguous, busy, warnings: [] });
}));

// A whole class's scanned sheets: one PDF (or a ZIP of PDFs/photos). Pages are rendered in the background,
// then the teacher assigns page ranges to students (or confirms the suggested split).
testRoutes.post("/tests/:id/sheets", staff, wrap(async (req, res) => {
  const { upload_id, identify } = z.object({ upload_id: z.string().max(60), identify: z.boolean().optional() }).parse(req.body);
  const t = one<any>("SELECT * FROM tests WHERE id = ? AND org_id = ?", req.params.id, req.user!.org_id);
  if (!t) return res.status(404).json({ error: "Test not found" });
  if (t.mode !== "offline") return res.status(400).json({ error: "Online tests don't take uploaded sheets" });
  const [u] = takeUploads([upload_id], req.user!, "class_sheets");
  if (identify) { const problem = aiProblem(req.user!.org_id); if (problem) return res.status(400).json({ error: problem }); }
  const id = await createDocument({ orgId: req.user!.org_id, userId: req.user!.id, purpose: "class_sheets", uploads: [u], testId: t.id, process: false });
  if (identify) run("UPDATE documents SET identify = 1 WHERE id = ?", id);
  enqueueJob("process_document", { document_id: id }, { orgId: req.user!.org_id, dedupeKey: `doc:${id}` });
  res.json({ document_id: id });
}));

const docInOrg = (id: string, orgId: string) => {
  const d = getDocument(id);
  return d && d.org_id === orgId ? d : null;
};

/** Status and pages of an uploaded document (polled by the browser while it is processed). */
testRoutes.get("/documents/:id", staff, (req, res) => {
  const d = docInOrg(req.params.id, req.user!.org_id);
  if (!d) return res.status(404).json({ error: "Upload not found" });
  const job = latestJob(`doc:${d.id}`);
  const pages = documentPages(d.id);
  const assigned = d.test_id ? all<{ files: string }>("SELECT files FROM attempts WHERE test_id = ?", d.test_id).flatMap((a) => json<string[]>(a.files, [])) : [];
  res.json({ id: d.id, purpose: d.purpose, title: d.title, status: d.status, error: d.error, test_id: d.test_id, created_at: d.created_at,
    job: job && { status: job.status, attempts: job.attempts, max_attempts: job.max_attempts, last_error: job.last_error, next_try_at: job.status === "queued" && job.attempts ? job.run_at : null },
    pages: pages.map((p) => ({ n: p.page_no, width: p.width, height: p.height, source: p.source_name, assigned: assigned.includes(p.storage_key) })) });
});

testRoutes.get("/documents/:id/pages/:n", staff, (req, res) => {
  const d = docInOrg(req.params.id, req.user!.org_id);
  const page = d && documentPages(d.id).find((p) => p.page_no === Number(req.params.n));
  if (!page?.storage_key) return res.status(404).end(); // removed (e.g. the student was deleted)
  storage.send(res, page.storage_key);
});

// Assign pages of a class upload to students: [{attempt_id, pages: [1,2,3]}]. Each listed student gets exactly those pages.
testRoutes.post("/documents/:id/assign", staff, wrap(async (req, res) => {
  const b = z.object({ assignments: z.array(z.object({ attempt_id: z.string().max(60), pages: z.array(z.number().int().min(1)).min(1).max(40) })).min(1).max(500) }).parse(req.body);
  const d = docInOrg(req.params.id, req.user!.org_id);
  if (!d || d.purpose !== "class_sheets" || !d.test_id) return res.status(404).json({ error: "Upload not found" });
  if (d.status !== "completed") return res.status(409).json({ error: "This upload is still being processed." });
  const pages = documentPages(d.id);
  const keyOf = new Map(pages.map((p) => [p.page_no, p.storage_key]));
  const seen = new Set<number>();
  for (const a of b.assignments) {
    const att = one<{ status: string }>("SELECT status FROM attempts WHERE id = ? AND test_id = ?", a.attempt_id, d.test_id);
    if (!att) return res.status(400).json({ error: "A student in the list is not in this test." });
    if (att.status === "evaluating") return res.status(409).json({ error: "One of these sheets is being marked right now. Wait for it to finish." });
    for (const n of a.pages) {
      if (!keyOf.has(n)) return res.status(400).json({ error: `Page ${n} doesn't exist in this upload.` });
      if (seen.has(n)) return res.status(400).json({ error: `Page ${n} is given to two students.` });
      seen.add(n);
    }
  }
  for (const a of b.assignments) await setAttemptPages(a.attempt_id, a.pages.map((n) => keyOf.get(n)!));
  res.json({ students: b.assignments.length, pages: seen.size });
}));

testRoutes.delete("/documents/:id", staff, wrap(async (req, res) => {
  const d = docInOrg(req.params.id, req.user!.org_id);
  if (!d || !d.test_id) return res.status(404).json({ error: "Upload not found" });
  const keys = new Set(documentPages(d.id).map((p) => p.storage_key));
  const inUse = all<{ files: string }>("SELECT files FROM attempts WHERE test_id = ?", d.test_id).some((a) => json<string[]>(a.files, []).some((k) => keys.has(k)));
  if (inUse) return res.status(409).json({ error: "Some pages of this upload are already given to students. Re-upload those students' sheets first." });
  await deleteDocuments([d.id]);
  res.json({ ok: true });
}));

// ---------------- Finding students on a class scan, and the teacher's review of it ----------------
const IDENTIFY_BATCH = 8; // pages per AI request
registerJob<{ document_id: string; org_id: string; charge_ref: string | null }>("identify_pages", {
  concurrency: 2,
  run: async ({ document_id, org_id }) => {
    const d = getDocument(document_id);
    if (!d || !d.test_id) return;
    const roster = all<{ id: string; name: string; roll: string | null }>(`SELECT a.id, u.name, e.roll_no AS roll FROM attempts a JOIN users u ON u.id = a.student_id
      LEFT JOIN enrollments e ON e.student_id = u.id WHERE a.test_id = ? ORDER BY CAST(e.roll_no AS INTEGER), u.name`, d.test_id);
    const pages = documentPages(document_id);
    const reads: { n: number; first_page: boolean; student_id: string; confidence: "high" | "medium" | "low"; name_written: string; roll_written: string }[] = [];
    for (let i = 0; i < pages.length; i += IDENTIFY_BATCH) {
      const batch = [];
      for (const p of pages.slice(i, i + IDENTIFY_BATCH)) {
        if (!p.storage_key || /\.pdf$/i.test(p.storage_key)) continue;
        // Only the top third of the page: the header with name and roll number. Small and cheap to send.
        const img = sharp(await storage.read(p.storage_key)).rotate();
        const meta = await img.metadata();
        const h = Math.max(1, Math.round((meta.height ?? 1000) * 0.33));
        batch.push({ n: p.page_no, image: await img.extract({ left: 0, top: 0, width: meta.width ?? 1000, height: Math.min(h, meta.height ?? h) }).resize({ width: 900, withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer() });
      }
      if (!batch.length) continue;
      const out = await identifyPages(org_id, roster, batch);
      const asked = new Set(batch.map((b) => b.n));
      for (const r of out.pages ?? []) if (asked.has(r.page)) reads.push({ n: r.page, first_page: r.first_page, student_id: r.student_id, confidence: r.confidence, name_written: r.name_written, roll_written: r.roll_written });
      // Pages the model skipped: unknown continuation pages.
      for (const n of asked) if (!reads.some((r) => r.n === n)) reads.push({ n, first_page: false, student_id: "", confidence: "low", name_written: "", roll_written: "" });
    }
    const map = groupPages(reads, new Set(roster.map((r) => r.id)));
    for (const m of map)
      run(`UPDATE sheet_pages SET attempt_id = ?, first_page = ?, name_written = ?, roll_written = ?, confidence = ?, method = 'ai', updated_at = CURRENT_TIMESTAMP
        WHERE document_id = ? AND page_no = ? AND approved = 0`, m.attempt_id, m.first_page || (m.group >= 0 && map.find((x) => x.group === m.group) === m) ? 1 : 0,
        m.name_written || null, m.roll_written || null, m.confidence, document_id, m.n);
  },
  onFail: ({ document_id, org_id, charge_ref }, msg) => {
    run("UPDATE documents SET error = ? WHERE id = ?", `Students couldn't be found automatically (${msg}). You can give pages to students by roll-number order instead.`, document_id);
    refund(org_id, charge_ref, "Refund: finding students on a class scan didn't finish");
  },
});

/** The page → student mapping of a class upload, for the Review Mapping screen. */
testRoutes.get("/documents/:id/mapping", staff, (req, res) => {
  const d = docInOrg(req.params.id, req.user!.org_id);
  if (!d || d.purpose !== "class_sheets" || !d.test_id) return res.status(404).json({ error: "Upload not found" });
  const job = latestJob(`identify:${d.id}`);
  const pages = documentPages(d.id);
  const rows = new Map(all<any>("SELECT * FROM sheet_pages WHERE document_id = ?", d.id).map((r) => [r.page_no, r]));
  const students = all<any>(`SELECT a.id AS attempt_id, u.name, e.roll_no, a.status, a.score, json_array_length(coalesce(a.files, '[]')) AS files
    FROM attempts a JOIN users u ON u.id = a.student_id LEFT JOIN enrollments e ON e.student_id = u.id WHERE a.test_id = ? ORDER BY CAST(e.roll_no AS INTEGER), u.name`, d.test_id);
  res.json({
    document: { id: d.id, title: d.title, status: d.status, error: d.error, identify: Boolean((d as { identify?: number }).identify) },
    identifying: Boolean(job && (job.status === "queued" || job.status === "processing")) || (Boolean((d as { identify?: number }).identify) && d.status !== "completed" && d.status !== "failed"),
    pages: pages.map((p) => {
      const r = rows.get(p.page_no);
      return { n: p.page_no, width: p.width, height: p.height, attempt_id: r?.attempt_id ?? null, first_page: Boolean(r?.first_page), name_written: r?.name_written ?? null,
        roll_written: r?.roll_written ?? null, confidence: r?.confidence ?? null, method: r?.method ?? null, approved: Boolean(r?.approved) };
    }),
    students,
  });
});

/** Teacher changes: give pages to a student (or nobody). Approved pages can be changed too (they are given again on approve). */
testRoutes.put("/documents/:id/mapping", staff, (req, res) => {
  const b = z.object({ pages: z.array(z.object({ n: z.number().int().min(1), attempt_id: z.string().max(60).nullable(), first_page: z.boolean().optional() })).min(1).max(2000) }).parse(req.body);
  const d = docInOrg(req.params.id, req.user!.org_id);
  if (!d || d.purpose !== "class_sheets" || !d.test_id) return res.status(404).json({ error: "Upload not found" });
  if (d.status !== "completed") return res.status(409).json({ error: "This upload is still being processed." });
  const valid = new Set(all<{ id: string }>("SELECT id FROM attempts WHERE test_id = ?", d.test_id).map((a) => a.id));
  const have = new Set(documentPages(d.id).map((p) => p.page_no));
  for (const p of b.pages) {
    if (!have.has(p.n)) return res.status(400).json({ error: `Page ${p.n} doesn't exist in this upload.` });
    if (p.attempt_id && !valid.has(p.attempt_id)) return res.status(400).json({ error: "A student in the list is not in this test." });
  }
  for (const p of b.pages) {
    run("INSERT OR IGNORE INTO sheet_pages (document_id, page_no, test_id) VALUES (?,?,?)", d.id, p.n, d.test_id);
    run(`UPDATE sheet_pages SET attempt_id = ?, method = 'teacher', approved = 0, first_page = coalesce(?, first_page), updated_at = CURRENT_TIMESTAMP WHERE document_id = ? AND page_no = ?`,
      p.attempt_id, p.first_page == null ? null : p.first_page ? 1 : 0, d.id, p.n);
  }
  res.json({ ok: true });
});

/** No AI: give pages in roll-number order, `pages_per_student` each (students without a sheet can be skipped). */
testRoutes.post("/documents/:id/map-by-order", staff, (req, res) => {
  const b = z.object({ pages_per_student: z.number().int().min(1).max(40), skip_attempt_ids: z.array(z.string().max(60)).max(1000).default([]) }).parse(req.body);
  const d = docInOrg(req.params.id, req.user!.org_id);
  if (!d || d.purpose !== "class_sheets" || !d.test_id) return res.status(404).json({ error: "Upload not found" });
  if (d.status !== "completed") return res.status(409).json({ error: "This upload is still being processed." });
  const order = all<{ id: string }>(`SELECT a.id FROM attempts a JOIN users u ON u.id = a.student_id LEFT JOIN enrollments e ON e.student_id = u.id
    WHERE a.test_id = ? ORDER BY CAST(e.roll_no AS INTEGER), u.name`, d.test_id).map((a) => a.id).filter((id) => !b.skip_attempt_ids.includes(id));
  const pages = documentPages(d.id);
  pages.forEach((p, i) => {
    const who = order[Math.floor(i / b.pages_per_student)] ?? null;
    run("INSERT OR IGNORE INTO sheet_pages (document_id, page_no, test_id) VALUES (?,?,?)", d.id, p.page_no, d.test_id);
    run(`UPDATE sheet_pages SET attempt_id = ?, first_page = ?, method = 'order', confidence = NULL, approved = 0, updated_at = CURRENT_TIMESTAMP WHERE document_id = ? AND page_no = ?`,
      who, i % b.pages_per_student === 0 ? 1 : 0, d.id, p.page_no);
  });
  res.json({ students: Math.min(order.length, Math.ceil(pages.length / b.pages_per_student)), extra_pages: Math.max(0, pages.length - order.length * b.pages_per_student) });
});

/**
 * Approve: each student (all mapped ones, or `attempt_ids`) gets exactly their mapped pages, in page order.
 * With `mark`, their sheets are queued for AI marking straight away (paid with credits).
 */
testRoutes.post("/documents/:id/approve", staff, wrap(async (req, res) => {
  const b = z.object({ attempt_ids: z.array(z.string().max(60)).max(1000).optional(), mark: z.boolean().optional() }).parse(req.body ?? {});
  const d = docInOrg(req.params.id, req.user!.org_id);
  if (!d || d.purpose !== "class_sheets" || !d.test_id) return res.status(404).json({ error: "Upload not found" });
  if (d.status !== "completed") return res.status(409).json({ error: "This upload is still being processed." });
  const keyOf = new Map(documentPages(d.id).map((p) => [p.page_no, p.storage_key]));
  const rows = all<{ page_no: number; attempt_id: string }>("SELECT page_no, attempt_id FROM sheet_pages WHERE document_id = ? AND attempt_id IS NOT NULL ORDER BY page_no", d.id)
    .filter((r) => !b.attempt_ids || b.attempt_ids.includes(r.attempt_id));
  const byStudent = new Map<string, number[]>();
  for (const r of rows) byStudent.set(r.attempt_id, [...(byStudent.get(r.attempt_id) ?? []), r.page_no]);
  if (!byStudent.size) return res.status(400).json({ error: "No pages are given to students yet." });
  for (const [aid, pgs] of byStudent) {
    const att = one<{ status: string }>("SELECT status FROM attempts WHERE id = ? AND test_id = ?", aid, d.test_id);
    if (att?.status === "evaluating") return res.status(409).json({ error: "One of these sheets is being marked right now. Wait for it to finish." });
    if (pgs.length > 40) return res.status(400).json({ error: "A student has more than 40 pages. Check the mapping." });
  }
  if (b.mark) {
    const paperIssue = paperProblem(paperFor(d.test_id));
    if (paperIssue) return res.status(400).json({ error: paperIssue });
    requireCredits(req.user!.org_id, [...byStudent.values()].reduce((t, pg) => t + priceOf(req.user!.org_id, "mark_sheet", 1, pg.length), 0));
  }
  for (const [aid, pgs] of byStudent) {
    await setAttemptPages(aid, pgs.map((n) => keyOf.get(n)!));
    run("UPDATE sheet_pages SET approved = 1, updated_at = CURRENT_TIMESTAMP WHERE document_id = ? AND attempt_id = ?", d.id, aid);
  }
  if (b.mark) enqueue([...byStudent.keys()], req.user!.id);
  res.json({ students: byStudent.size, pages: rows.length, marking: Boolean(b.mark) });
}));

// One page of an answer sheet: staff of the institute, or the student once results are published.
testRoutes.get("/attempts/:id/files/:n", (req, res) => {
  const u = req.user!;
  const a = one<any>("SELECT a.files, a.student_id, t.org_id, t.results_published FROM attempts a JOIN tests t ON t.id = a.test_id WHERE a.id = ?", req.params.id);
  if (!a || a.org_id !== u.org_id || (u.role === "student" && (a.student_id !== u.id || !a.results_published))) return res.status(404).end();
  const name = json<string[]>(a.files, [])[Number(req.params.n)];
  if (!name) return res.status(404).end();
  storage.send(res, name);
});

/** Kind of each stored page, so the viewer knows which pages it can draw marks on. */
export const pageTypes = (files: string | null) => json<string[]>(files, []).map((f) => (/\.pdf$/i.test(f) ? "pdf" : "image"));

/** Answer key and solutions stay hidden from students and parents while another unpublished test still uses the same paper. */
export function paperIsPrivate(testId: string) {
  return Boolean(one(`SELECT 1 FROM tests t JOIN tests o ON o.paper_id = t.paper_id AND o.id != t.id AND o.results_published = 0 WHERE t.id = ?`, testId));
}
/** The paper as a student or parent may see it after results: question text always; answers and solutions when safe. */
export function paperForViewer(testId: string) {
  const p = paperFor(testId);
  if (!p) return null;
  const hide = paperIsPrivate(testId);
  return { ...p, answers_hidden: hide, sections: p.sections.map((sec) => ({ ...sec, questions: sec.questions.map((q) => (hide ? { ...q, correct_option: null, numeric_answer: null, solution: "", rubric: [] } : q)) })) };
}

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
  if (problem) throw new PermanentError(problem);
  const files = json<string[]>(a.files, []);
  if (!files.length) throw new PermanentError("No pages uploaded for this student.");
  run("UPDATE attempts SET status = 'evaluating' WHERE id = ?", attemptId);
  {
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
    // Keep what the AI gave (and which model), so later teacher changes can be compared with it.
    for (const qe of ev.questions as (CheckedQ & { ai_marks?: number })[]) qe.ai_marks = qe.marks_awarded;
    (ev as SheetEvaluation & { meta?: unknown }).meta = { model: modelFor(t.org_id, "marking"), recheck_model: modelFor(t.org_id, "recheck"), marked_at: new Date().toISOString() };
    run("UPDATE attempts SET status = 'evaluated', error = NULL, evaluation = ?, score = ?, max_score = ?, reviewed = 0, evaluated_at = CURRENT_TIMESTAMP WHERE id = ?",
      JSON.stringify(ev), score, paper!.total_marks, attemptId);
    // A re-marked sheet gets a fresh Fix-it plan (if results are already out).
    if (one("SELECT 1 FROM practice_sets WHERE attempt_id = ?", attemptId)) {
      run("DELETE FROM practice_sets WHERE attempt_id = ?", attemptId);
      if (one("SELECT 1 FROM tests WHERE id = ? AND results_published = 1", a.test_id)) queuePracticeForTest(a.test_id, [attemptId]);
    }
  }
}

// Marking runs as background jobs: up to EVAL_CONCURRENCY sheets at once, 3 tries with backoff.
registerJob<{ attempt_id: string; org_id?: string; charge_ref?: string | null }>("mark_attempt", {
  concurrency: Number(process.env.EVAL_CONCURRENCY ?? 3),
  run: ({ attempt_id }) => runEvaluation(attempt_id),
  onRetry: ({ attempt_id }, message, job, wait) =>
    run("UPDATE attempts SET status = 'evaluating', error = ? WHERE id = ?", `Try ${job.attempts} of ${job.max_attempts} failed (${message}). Trying again in ${Math.round(wait)} s.`, attempt_id),
  onFail: ({ attempt_id, org_id, charge_ref }, message) => {
    run("UPDATE attempts SET status = 'failed', error = ? WHERE id = ?", message, attempt_id);
    refund(org_id, charge_ref, "Refund: the sheet couldn't be marked");
  },
});
const sheetPages = (id: string) => json<string[]>(one<{ files: string }>("SELECT files FROM attempts WHERE id = ?", id)?.files ?? null, []).length;
/** Queues sheets for marking. With `chargeUserId`, each sheet is paid with credits (refunded if marking fails for good). */
function enqueue(ids: string[], chargeUserId?: string) {
  for (const id of ids) {
    const org = one<{ org_id: string }>("SELECT t.org_id FROM attempts a JOIN tests t ON t.id = a.test_id WHERE a.id = ?", id)?.org_id;
    if (one("SELECT 1 FROM jobs WHERE dedupe_key = ? AND status IN ('queued','processing')", `mark:${id}`)) continue; // already queued: never charge twice
    const chargeRef = chargeUserId && org ? charge(org, "mark_sheet", `mark:${id}:${uid("c")}`, { pages: sheetPages(id), userId: chargeUserId }) : null;
    run("UPDATE attempts SET status = 'evaluating', error = NULL WHERE id = ?", id);
    enqueueJob("mark_attempt", { attempt_id: id, org_id: org, charge_ref: chargeRef }, { orgId: org, dedupeKey: `mark:${id}` });
  }
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
  // All or nothing: check the whole batch can be paid before queuing any of it.
  requireCredits(req.user!.org_id, ids.reduce((t, id) => t + priceOf(req.user!.org_id, "mark_sheet", 1, sheetPages(id)), 0));
  enqueue(ids, req.user!.id);
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
  res.json({ ...a, files: json<string[]>(a.files, []).length, page_types: pageTypes(a.files), responses: json(a.responses, {}), evaluation: json(a.evaluation, null),
    paper: u.role === "student" ? paperForViewer(a.test_id) : paperFor(a.test_id) });
});

// Teacher review: override marks on any question.
testRoutes.put("/attempts/:id/evaluation", staff, (req, res) => {
  const a = attemptInOrg(req.params.id, req.user!.org_id);
  if (!a) return res.status(404).json({ error: "Not found" });
  const ev = json<SheetEvaluation | null>(a.evaluation, null);
  if (!ev) return res.status(400).json({ error: "Not evaluated yet" });
  const edits = z.array(z.object({ question_id: z.string().max(40), marks_awarded: z.number().finite().min(-1000).max(1000), feedback: z.string().max(2000).optional(),
    note: z.string().max(1000).optional() })).max(500).parse(req.body?.questions);
  const paper = paperFor(a.test_id);
  const qById = new Map(questionsOf(paper?.sections ?? []).map((q) => [q.id, q]));
  const meta = (ev as SheetEvaluation & { meta?: { model?: string | null; recheck_model?: string | null } }).meta;
  const pages = json<string[]>(a.files, []);
  // Check every mark first, so a bad one changes (and logs) nothing.
  const order = [...qById.keys()];
  for (const e of edits) {
    const q = qById.get(e.question_id);
    if (q && (e.marks_awarded > q.marks || e.marks_awarded < -(q.negative_marks ?? 0)))
      return res.status(400).json({ error: `Question ${order.indexOf(q.id) + 1}: marks must be between ${-(q.negative_marks ?? 0)} and ${q.marks}.` });
  }
  for (const e of edits) {
    const qe = ev.questions.find((q) => q.question_id === e.question_id) as (CheckedQ & { ai_marks?: number; teacher_override?: boolean; teacher_note?: string }) | undefined;
    if (!qe) continue;
    const changed = e.marks_awarded !== qe.marks_awarded;
    // Every change to the AI's marks is logged for improving the marking later (never deleted).
    if (changed || e.note) {
      const q = qById.get(qe.question_id);
      run(`INSERT INTO grade_corrections (org_id, test_id, attempt_id, paper_id, question_id, question_text, question_type, max_marks,
             ai_marks, ai_criteria, ai_reason, ai_confidence, teacher_marks, teacher_note, model, page_refs, teacher_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        req.user!.org_id, a.test_id, a.id, paper?.id ?? null, qe.question_id, q?.text?.slice(0, 4000) ?? null, q?.type ?? null, qe.max_marks,
        qe.ai_marks ?? qe.marks_awarded, JSON.stringify(qe.steps ?? []), [qe.mistake_note, qe.feedback].filter(Boolean).join(" | ").slice(0, 2000) || null,
        qe.confidence ?? null, e.marks_awarded, e.note ?? null,
        qe.second_check === "changed" ? meta?.recheck_model ?? null : meta?.model ?? null,
        JSON.stringify({ pages, location: (qe as { location?: unknown }).location ?? null }), req.user!.id);
    }
    if (changed) { qe.marks_awarded = e.marks_awarded; qe.teacher_override = true; }
    if (e.note) qe.teacher_note = e.note;
    if (e.feedback !== undefined) qe.feedback = e.feedback;
  }
  const score = scoreEvaluation(ev, questionsOf(paper?.sections ?? []));
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
      location: { page: 0, top: 0, bottom: 0, mark_x: 0, mark_y: 0 }, // online answers have no paper
    };
  });
  const score = evQuestions.reduce((t, q) => t + q.marks_awarded, 0);
  const ev: SheetEvaluation = { student_name_on_sheet: null, questions: evQuestions, overall_feedback: "", strengths: [], gaps: [] };
  run(`UPDATE attempts SET responses = ?, evaluation = ?, score = ?, max_score = ?, status = 'evaluated', submitted_at = CURRENT_TIMESTAMP,
       evaluated_at = CURRENT_TIMESTAMP WHERE id = ?`, JSON.stringify(responses), JSON.stringify(ev), score, paper.total_marks, a.id);
  res.json({ ok: true });
});

// After a restart, sheets that were queued or mid-evaluation are queued again automatically.
/** Sheets left "evaluating" without a job (e.g. queued by an older version) are queued again. Jobs themselves resume on their own. */
export function recoverEvaluations() {
  const ids = all<{ id: string }>(`SELECT id FROM attempts a WHERE status = 'evaluating'
    AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.dedupe_key = 'mark:' || a.id AND j.status IN ('queued','processing'))`).map((a) => a.id);
  if (ids.length) { console.log(`Queuing ${ids.length} sheet(s) left without a marking job`); enqueue(ids); }
}

/** Files to delete when a student is removed. */
/** Every answer-sheet page of a student (their own uploads and their pages of class scans), to delete with them. */
export const studentFiles = (studentId: string) =>
  all<{ files: string }>("SELECT files FROM attempts WHERE student_id = ?", studentId).flatMap((a) => json<string[]>(a.files, []));
/** The student's own sheet uploads (documents), deleted with the student. */
export const studentDocuments = (studentId: string) =>
  all<{ id: string }>("SELECT d.id FROM documents d JOIN attempts a ON a.id = d.attempt_id WHERE a.student_id = ?", studentId).map((d) => d.id);
