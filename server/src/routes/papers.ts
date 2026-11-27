import { Router } from "express";
import { z } from "zod";
import { wrap } from "../lib/http.js";
import { all, json, one, run, uid } from "../db.js";
import { staff } from "../auth.js";
import { rateLimit } from "../ratelimit.js";

// Each AI paper costs API credits; cap how many an institute can start in a short time.
const aiPaperLimit = rateLimit("ai-paper", 30, 60 * 60 * 1000, (r) => r.user?.org_id ?? r.ip ?? "?");
import { generatePaper, importPaper, tagSubtopics, aiProblem, assistQuestion, type AssistAction, type PaperSpec, type ImportMeta } from "../ai/claude.js";
import { enqueueJob, registerJob } from "../lib/jobs.js";
import { createDocument, processDocument } from "../lib/documents.js";
import { FileProblem } from "../lib/files.js";
import { takeUploads } from "./uploads.js";
import { charge, refund } from "../lib/credits.js";
import { inOrg, subjectInCourse } from "../lib/scope.js";
import { StoredSection as Section, StoredQuestion, type Section as SectionT, type Question as QuestionT } from "../ai/schemas.js";

export const paperRoutes = Router();

export const totalMarks = (sections: SectionT[]) => sections.reduce((t, s) => t + s.questions.reduce((a, q) => a + q.marks, 0), 0);

const serialize = (p: any) => p && { ...p, sections: json(p.sections, []), checked_questions: json<string[]>(p.checked_questions, []) };

paperRoutes.get("/papers", staff, (req, res) => {
  res.json(all<any>(`SELECT p.id, p.title, p.subject, p.board, p.class_level, p.language, p.total_marks, p.duration_min, p.status, p.error, p.created_at,
      coalesce(p.updated_at, p.created_at) AS updated_at, p.approved_at, p.source, p.folder_id, f.name AS folder_name,
      p.course_id, c.name AS course_name, p.subject_id, s.name AS subject_name, p.sections,
      u.name AS created_by_name, (SELECT count(*) FROM tests t WHERE t.paper_id = p.id) AS used_in_tests
    FROM question_papers p LEFT JOIN users u ON u.id = p.created_by LEFT JOIN paper_folders f ON f.id = p.folder_id
      LEFT JOIN courses c ON c.id = p.course_id LEFT JOIN subjects s ON s.id = p.subject_id
    WHERE p.org_id = ? ORDER BY coalesce(p.updated_at, p.created_at) DESC`, req.user!.org_id).map(({ sections, ...p }) => {
    // Card summary without sending every question: count and difficulty mix.
    const qs = json<SectionT[]>(sections, []).flatMap((x) => x.questions);
    const mix = { easy: 0, medium: 0, hard: 0 } as Record<string, number>;
    for (const q of qs) mix[q.difficulty] = (mix[q.difficulty] ?? 0) + 1;
    const difficulty = !qs.length ? null : mix.hard / qs.length >= 0.4 ? "hard" : mix.easy / qs.length >= 0.5 ? "easy" : "medium";
    return { ...p, question_count: qs.length, section_count: json<SectionT[]>(sections, []).length, difficulty };
  }));
});

// ---- Folders for question papers ----
paperRoutes.get("/paper-folders", staff, (req, res) => {
  res.json(all("SELECT f.id, f.name, f.created_at, (SELECT count(*) FROM question_papers p WHERE p.folder_id = f.id) AS papers FROM paper_folders f WHERE f.org_id = ? ORDER BY f.name", req.user!.org_id));
});
paperRoutes.post("/paper-folders", staff, (req, res) => {
  const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
  const id = uid("fld");
  run("INSERT INTO paper_folders (id, org_id, name, created_by) VALUES (?,?,?,?)", id, req.user!.org_id, name, req.user!.id);
  res.json({ id });
});
paperRoutes.put("/paper-folders/:id", staff, (req, res) => {
  const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
  const r = run("UPDATE paper_folders SET name = ? WHERE id = ? AND org_id = ?", name, req.params.id, req.user!.org_id);
  if (!r.changes) return res.status(404).json({ error: "Folder not found" });
  res.json({ ok: true });
});
paperRoutes.delete("/paper-folders/:id", staff, (req, res) => {
  // Papers inside are kept (they move out of the folder).
  const r = run("DELETE FROM paper_folders WHERE id = ? AND org_id = ?", req.params.id, req.user!.org_id);
  if (!r.changes) return res.status(404).json({ error: "Folder not found" });
  res.json({ ok: true });
});

/** Move a paper to a folder, or set its course / subject (each field optional; null clears it). */
paperRoutes.put("/papers/:id/meta", staff, (req, res) => {
  const b = z.object({ folder_id: z.string().max(60).nullable().optional(), course_id: z.string().max(60).nullable().optional(), subject_id: z.string().max(60).nullable().optional() }).parse(req.body);
  const org = req.user!.org_id;
  const p = one<any>("SELECT course_id FROM question_papers WHERE id = ? AND org_id = ?", req.params.id, org);
  if (!p) return res.status(404).json({ error: "Paper not found" });
  if (!inOrg("paper_folders", b.folder_id, org) || !inOrg("courses", b.course_id, org) || !inOrg("subjects", b.subject_id, org)) return res.status(400).json({ error: "Pick a folder, course and subject from your institute" });
  if (!subjectInCourse(b.subject_id, b.course_id === undefined ? p.course_id : b.course_id)) return res.status(400).json({ error: "That subject belongs to a different course" });
  for (const k of ["folder_id", "course_id", "subject_id"] as const)
    if (b[k] !== undefined) run(`UPDATE question_papers SET ${k} = ? WHERE id = ?`, b[k], req.params.id);
  res.json({ ok: true });
});

paperRoutes.get("/papers/:id", staff, (req, res) => {
  const p = one("SELECT * FROM question_papers WHERE id = ? AND org_id = ?", req.params.id, req.user!.org_id);
  if (!p) return res.status(404).json({ error: "Paper not found" });
  res.json(serialize(p));
});

const SpecBody = z.object({
  subject: z.string().trim().min(1).max(80), board: z.string().trim().min(1).max(80), class_level: z.string().trim().min(1).max(80), topics: z.string().trim().min(1).max(2000),
  language: z.string().max(60).default("English"), difficulty: z.enum(["easy", "medium", "hard", "mixed"]).default("mixed"),
  duration_min: z.number().int().min(5).max(360).default(60),
  sections: z.array(z.object({
    name: z.string().min(1).max(100), type: z.enum(["mcq", "numeric", "short", "long"]),
    count: z.number().int().min(1).max(60), marks_each: z.number().min(0.5).max(50), negative_marks: z.number().min(0).max(10).default(0),
  })).min(1).max(8),
  notes: z.string().max(1000).optional(),
});

// Generating and reading papers run as background jobs; the client polls the paper's status.
const failPaper = (id: string, message: string) => run("UPDATE question_papers SET status = 'failed', error = ? WHERE id = ?", message, id);
const savePaper = (id: string, paper: { title: string; instructions: string; sections: SectionT[] }) => {
  run("UPDATE question_papers SET title = ?, instructions = ?, sections = ?, total_marks = ?, status = 'draft', error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    paper.title, paper.instructions, JSON.stringify(paper.sections), totalMarks(paper.sections), id);
  syncTestMarks(id);
};

registerJob<{ paper_id: string; org_id: string; spec: PaperSpec; charge_ref?: string | null }>("generate_paper", {
  concurrency: 2,
  run: async ({ paper_id, org_id, spec }) => savePaper(paper_id, await generatePaper(org_id, spec)),
  onRetry: (p, msg) => run("UPDATE question_papers SET error = ? WHERE id = ?", `Retrying: ${msg}`, p.paper_id),
  onFail: (p, msg) => { failPaper(p.paper_id, msg); refund(p.org_id, p.charge_ref); },
});

paperRoutes.post("/papers/generate", staff, aiPaperLimit, (req, res) => {
  const spec = SpecBody.parse(req.body) as PaperSpec;
  const problem = aiProblem(req.user!.org_id);
  if (problem) return res.status(400).json({ error: problem });
  const id = uid("qp");
  const chargeRef = charge(req.user!.org_id, "paper_generate", `paper:${id}`, { userId: req.user!.id }); // throws when out of credits
  run(`INSERT INTO question_papers (id, org_id, title, subject, board, class_level, language, duration_min, status, created_by, source)
       VALUES (?,?,?,?,?,?,?,?, 'generating', ?, 'generated')`,
    id, req.user!.org_id, `${spec.subject} - ${spec.class_level}`, spec.subject, spec.board, spec.class_level, spec.language, spec.duration_min, req.user!.id);
  enqueueJob("generate_paper", { paper_id: id, org_id: req.user!.org_id, spec, charge_ref: chargeRef }, { orgId: req.user!.org_id, dedupeKey: `paper:${id}` });
  res.json({ id });
});

// Import an existing paper: uploaded PDF/photos of the question paper, plus the answer key if available.
// The files are already uploaded (resumable /uploads); here they become documents and a reading job is queued.
interface ImportJob { paper_id: string; org_id: string; paper_doc: string; key_doc: string | null; meta: ImportMeta; charge_ref?: string | null }
registerJob<ImportJob>("import_paper", {
  concurrency: 2,
  run: async ({ paper_id, org_id, paper_doc, key_doc, meta }) => {
    const paperPages = (await processDocument(paper_doc)).map((p) => p.storage_key);
    const keyPages = key_doc ? (await processDocument(key_doc)).map((p) => p.storage_key) : [];
    if (paperPages.length + keyPages.length > 100) throw new FileProblem("The paper and answer key together have more than 100 pages. Upload fewer pages.");
    savePaper(paper_id, await importPaper(org_id, paperPages, keyPages, meta));
  },
  onRetry: (p, msg) => run("UPDATE question_papers SET error = ? WHERE id = ?", `Retrying: ${msg}`, p.paper_id),
  onFail: (p, msg) => { failPaper(p.paper_id, msg); refund(p.org_id, p.charge_ref); },
});

paperRoutes.post("/papers/import", staff, aiPaperLimit, wrap(async (req, res) => {
  const b = z.object({
    paper_uploads: z.array(z.string().max(60)).min(1, "Add the question paper").max(50),
    key_uploads: z.array(z.string().max(60)).max(50).default([]),
    key_mode: z.enum(["auto", "in_paper", "separate"]).default("auto"),
    subject: z.string().max(80).optional(), board: z.string().max(80).optional(), class_level: z.string().max(80).optional(),
    language: z.string().max(60).optional(), duration_min: z.coerce.number().int().min(5).max(360).optional(), notes: z.string().max(1000).optional(),
    marking_notes: z.string().trim().max(2000).optional(),
    course_id: z.string().max(60).nullish(), subject_id: z.string().max(60).nullish(), folder_id: z.string().max(60).nullish(),
  }).parse(req.body ?? {});
  if (!inOrg("courses", b.course_id, req.user!.org_id) || !inOrg("subjects", b.subject_id, req.user!.org_id) || !inOrg("paper_folders", b.folder_id, req.user!.org_id) || !subjectInCourse(b.subject_id, b.course_id))
    return res.status(400).json({ error: "Pick a course, subject and folder from your institute" });
  if (b.key_mode === "separate" && !b.key_uploads.length) return res.status(400).json({ error: "Add the answer key file, or choose another answer key option" });
  const problem = aiProblem(req.user!.org_id);
  if (problem) return res.status(400).json({ error: problem });
  const user = req.user!;
  const paperUps = takeUploads(b.paper_uploads, user, "paper");
  const keyUps = b.key_mode === "separate" ? takeUploads(b.key_uploads, user, ["answer_key", "paper"]) : [];
  const pages = [...paperUps, ...keyUps].reduce((t, u) => t + (u.pages ?? 1), 0);
  if (pages > 100) return res.status(400).json({ error: `The paper and answer key together have ${pages} pages. The limit is 100.` });
  const id = uid("qp");
  const chargeRef = charge(user.org_id, "paper_import", `paper:${id}`, { userId: user.id }); // throws when out of credits
  run(`INSERT INTO question_papers (id, org_id, title, subject, board, class_level, language, duration_min, status, created_by, source, marking_notes, course_id, subject_id, folder_id, updated_at)
       VALUES (?,?,?,?,?,?,?,?, 'generating', ?, 'imported', ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    id, user.org_id, paperUps[0].filename.replace(/\.[^.]+$/, "").slice(0, 120) || "Imported paper", b.subject ?? null, b.board ?? null, b.class_level ?? null, b.language ?? "English", b.duration_min ?? 60, user.id,
    b.marking_notes || null, b.course_id ?? null, b.subject_id ?? null, b.folder_id ?? null);
  const paperDoc = await createDocument({ orgId: user.org_id, userId: user.id, purpose: "paper", uploads: paperUps, paperId: id, process: false });
  const keyDoc = keyUps.length ? await createDocument({ orgId: user.org_id, userId: user.id, purpose: "answer_key", uploads: keyUps, paperId: id, process: false }) : null;
  enqueueJob("import_paper", { paper_id: id, org_id: user.org_id, paper_doc: paperDoc, key_doc: keyDoc, meta: { ...b, key_mode: b.key_mode } satisfies ImportMeta, charge_ref: chargeRef },
    { orgId: user.org_id, dedupeKey: `paper:${id}` });
  res.json({ id });
}));

// Manual creation / full save from the editor.
const PaperBody = z.object({
  title: z.string().trim().min(1).max(200), subject: z.string().max(80).optional(), board: z.string().max(80).optional(), class_level: z.string().max(80).optional(),
  language: z.string().max(60).optional(), duration_min: z.number().int().min(5).max(360), instructions: z.string().max(5000).optional(),
  marking_notes: z.string().trim().max(2000).nullish(),
  sections: z.array(Section).max(20).refine((ss) => ss.reduce((t, x) => t + x.questions.length, 0) <= 300, "At most 300 questions")
    .refine((ss) => { const ids = ss.flatMap((x) => x.questions.map((q) => q.id)); return new Set(ids).size === ids.length; }, "Question ids must be unique"),
});

paperRoutes.post("/papers", staff, (req, res) => {
  const b = PaperBody.extend({ course_id: z.string().max(60).nullish(), subject_id: z.string().max(60).nullish(), folder_id: z.string().max(60).nullish() }).parse(req.body);
  const org = req.user!.org_id;
  if (!inOrg("courses", b.course_id, org) || !inOrg("subjects", b.subject_id, org) || !inOrg("paper_folders", b.folder_id, org) || !subjectInCourse(b.subject_id, b.course_id))
    return res.status(400).json({ error: "Pick a course, subject and folder from your institute" });
  const id = uid("qp");
  run(`INSERT INTO question_papers (id, org_id, title, subject, board, class_level, language, duration_min, instructions, sections, total_marks, status, created_by,
         source, course_id, subject_id, folder_id, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?, 'draft', ?, 'composed', ?, ?, ?, CURRENT_TIMESTAMP)`,
    id, org, b.title, b.subject ?? null, b.board ?? null, b.class_level ?? null, b.language ?? "English",
    b.duration_min, b.instructions ?? null, JSON.stringify(b.sections), totalMarks(b.sections), req.user!.id, b.course_id ?? null, b.subject_id ?? null, b.folder_id ?? null);
  res.json({ id });
});

paperRoutes.put("/papers/:id", staff, (req, res) => {
  const b = PaperBody.parse(req.body);
  const r = run(`UPDATE question_papers SET title = ?, subject = ?, board = ?, class_level = ?, language = ?, duration_min = ?, instructions = ?,
      sections = ?, total_marks = ?, status = CASE WHEN status = 'failed' THEN 'draft' ELSE status END, updated_at = CURRENT_TIMESTAMP,
      marking_notes = CASE WHEN ? THEN ? ELSE marking_notes END WHERE id = ? AND org_id = ?`,
    b.title, b.subject ?? null, b.board ?? null, b.class_level ?? null, b.language ?? "English", b.duration_min, b.instructions ?? null,
    JSON.stringify(b.sections), totalMarks(b.sections), b.marking_notes !== undefined ? 1 : 0, b.marking_notes || null, req.params.id, req.user!.org_id);
  if (!r.changes) return res.status(404).json({ error: "Paper not found" });
  syncTestMarks(req.params.id);
  res.json({ ok: true });
});

paperRoutes.post("/papers/:id/approve", staff, (req, res) => {
  run("UPDATE question_papers SET status = 'approved', approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND org_id = ? AND status = 'draft'", req.params.id, req.user!.org_id);
  res.json({ ok: true });
});

paperRoutes.post("/papers/:id/clone", staff, (req, res) => {
  const p = one<any>("SELECT * FROM question_papers WHERE id = ? AND org_id = ?", req.params.id, req.user!.org_id);
  if (!p) return res.status(404).json({ error: "Paper not found" });
  const id = uid("qp");
  run(`INSERT INTO question_papers (id, org_id, title, subject, board, class_level, language, duration_min, instructions, sections, total_marks, status, created_by,
         source, course_id, subject_id, folder_id, marking_notes, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?, 'draft', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    id, p.org_id, `${p.title} (copy)`, p.subject, p.board, p.class_level, p.language, p.duration_min, p.instructions, p.sections, p.total_marks, req.user!.id,
    p.source, p.course_id, p.subject_id, p.folder_id, p.marking_notes);
  res.json({ id });
});

paperRoutes.delete("/papers/:id", staff, (req, res) => {
  const used = one<{ n: number }>("SELECT count(*) n FROM tests WHERE paper_id = ? AND org_id = ?", req.params.id, req.user!.org_id)?.n ?? 0;
  if (used) return res.status(409).json({ error: `This paper is used by ${used} test${used > 1 ? "s" : ""}. Delete ${used > 1 ? "those tests" : "that test"} first, so no results are lost by accident.` });
  run("DELETE FROM question_papers WHERE id = ? AND org_id = ?", req.params.id, req.user!.org_id);
  res.json({ ok: true });
});

// Generation jobs live in memory; if the server restarted mid-generation, mark them failed so users can retry.
export function recoverPaperJobs() {
  // Papers left "generating" by an older version (before jobs existed) can't resume: mark them failed.
  run(`UPDATE question_papers SET status = 'failed', error = 'Interrupted by a server restart. Please try again.'
       WHERE status = 'generating' AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.dedupe_key = 'paper:' || question_papers.id AND j.status IN ('queued','processing'))`);
}

/** Tests using this paper show its current total for sheets that aren't marked yet. */
function syncTestMarks(paperId: string) {
  run(`UPDATE attempts SET max_score = (SELECT total_marks FROM question_papers WHERE id = ?)
       WHERE score IS NULL AND test_id IN (SELECT id FROM tests WHERE paper_id = ?)`, paperId, paperId);
}

// Papers made before sub-topics existed get them from AI once, so reports can name the exact concept to re-teach.
// This runs as a background job; reports simply show sub-topics once they are there.
const missingSubtopics = (sections: SectionT[]) => sections.some((sec) => sec.questions.some((q) => !String((q as { subtopic?: string }).subtopic ?? "").trim()));
registerJob<{ paper_id: string }>("tag_subtopics", {
  concurrency: 1,
  run: async ({ paper_id }) => {
    const p = one<any>("SELECT id, org_id, subject, class_level, sections, status FROM question_papers WHERE id = ?", paper_id);
    if (!p || !["draft", "approved"].includes(p.status) || !missingSubtopics(json<SectionT[]>(p.sections, []))) return;
    const qs = json<SectionT[]>(p.sections, []).flatMap((sec) => sec.questions).map((q) => ({ id: q.id, text: q.text.slice(0, 600), topic: q.topic, solution: q.solution.slice(0, 300) }));
    const tags = await tagSubtopics(p.org_id, { subject: p.subject, class_level: p.class_level, questions: qs });
    const byId = new Map((tags?.questions ?? []).map((t) => [t.id, t]));
    // Re-read so edits made while AI was working are kept; only empty sub-topics (and empty chapters) are filled.
    const cur = one<any>("SELECT sections FROM question_papers WHERE id = ?", paper_id);
    if (!cur) return;
    const sections = json<SectionT[]>(cur.sections, []).map((sec) => ({ ...sec, questions: sec.questions.map((q) => {
      const t = byId.get(q.id);
      const sub = String((q as { subtopic?: string }).subtopic ?? "").trim();
      return t ? { ...q, topic: q.topic?.trim() ? q.topic : t.topic.slice(0, 120), subtopic: sub || t.subtopic.slice(0, 160) } : q;
    }) }));
    run("UPDATE question_papers SET sections = ? WHERE id = ?", JSON.stringify(sections), paper_id);
  },
});
/** Queues sub-topic tagging for a paper that lacks it (no-op otherwise, or when AI isn't set up). */
export function ensureSubtopics(paperId: string) {
  const p = one<any>("SELECT org_id, sections, status FROM question_papers WHERE id = ?", paperId);
  if (!p || !["draft", "approved"].includes(p.status) || !missingSubtopics(json<SectionT[]>(p.sections, [])) || aiProblem(p.org_id)) return;
  enqueueJob("tag_subtopics", { paper_id: paperId }, { orgId: p.org_id, dedupeKey: `tag:${paperId}` });
}

// ---------------- Paper editor: one question at a time ----------------
type PaperRow = { id: string; org_id: string; status: string; sections: string; subject: string | null; class_level: string | null; board: string | null; language: string; marking_notes: string | null; checked_questions: string | null };
const paperInOrg = (id: string, org: string) => one<PaperRow>("SELECT * FROM question_papers WHERE id = ? AND org_id = ?", id, org);
const findQuestion = (sections: SectionT[], qid: string) => {
  for (const sec of sections) { const i = sec.questions.findIndex((q) => q.id === qid); if (i >= 0) return { sec, i, q: sec.questions[i] }; }
  return null;
};
/** Makes rubric step marks add up to the question's marks (AI or teacher slips), keeping their proportions. */
function fitRubric(rubric: { step: string; marks: number }[], marks: number) {
  const steps = rubric.filter((r) => r.step.trim());
  if (!steps.length) return [{ step: "Correct answer with working", marks }];
  const sum = steps.reduce((t, r) => t + r.marks, 0);
  if (Math.abs(sum - marks) < 0.01) return steps;
  const scaled = steps.map((r) => ({ ...r, marks: Math.round(((sum > 0 ? r.marks / sum : 1 / steps.length) * marks) * 2) / 2 }));
  const diff = Math.round((marks - scaled.reduce((t, r) => t + r.marks, 0)) * 2) / 2;
  scaled[scaled.length - 1].marks = Math.max(0, scaled[scaled.length - 1].marks + diff);
  return scaled;
}
const saveSections = (paperId: string, sections: SectionT[]) => {
  run("UPDATE question_papers SET sections = ?, total_marks = ?, status = CASE WHEN status = 'failed' THEN 'draft' ELSE status END, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    JSON.stringify(sections), totalMarks(sections), paperId);
  syncTestMarks(paperId);
};

/** Save one question (from the solution drawer). The id stays; checks the same rules as the full editor. */
paperRoutes.put("/papers/:id/questions/:qid", staff, (req, res) => {
  const p = paperInOrg(req.params.id, req.user!.org_id);
  if (!p) return res.status(404).json({ error: "Paper not found" });
  if (p.status === "generating") return res.status(409).json({ error: "The paper is still being prepared." });
  const sections = json<SectionT[]>(p.sections, []);
  const at = findQuestion(sections, req.params.qid);
  if (!at) return res.status(404).json({ error: "Question not found" });
  const q = StoredQuestion.parse({ ...req.body, id: req.params.qid });
  if (q.type === "mcq" && (q.options.length < 2 || q.correct_option == null || q.correct_option < 0 || q.correct_option >= q.options.length))
    return res.status(400).json({ error: "A multiple-choice question needs at least 2 options and the correct one marked." });
  const rubricSum = q.rubric.reduce((t, r) => t + r.marks, 0);
  if (q.rubric.length && Math.abs(rubricSum - q.marks) > 0.01) return res.status(400).json({ error: `The marking steps add up to ${rubricSum}, but the question is worth ${q.marks}. Make them match.` });
  at.sec.questions[at.i] = q;
  saveSections(p.id, sections);
  res.json({ ok: true, total_marks: totalMarks(sections) });
});

/** The teacher's "checked" tick on a question. */
paperRoutes.put("/papers/:id/checked", staff, (req, res) => {
  const b = z.object({ question_id: z.string().max(40), checked: z.boolean() }).parse(req.body);
  const p = paperInOrg(req.params.id, req.user!.org_id);
  if (!p) return res.status(404).json({ error: "Paper not found" });
  if (!findQuestion(json<SectionT[]>(p.sections, []), b.question_id)) return res.status(404).json({ error: "Question not found" });
  const set = new Set(json<string[]>(p.checked_questions, []));
  if (b.checked) set.add(b.question_id); else set.delete(b.question_id);
  run("UPDATE question_papers SET checked_questions = ? WHERE id = ?", JSON.stringify([...set]), p.id);
  res.json({ checked_questions: [...set] });
});

// AI help: queued as a job, paid with credits, and returned as a suggestion the teacher accepts or discards.
registerJob<{ suggestion_id: string; org_id: string; charge_ref: string | null }>("question_assist", {
  concurrency: 3,
  run: async ({ suggestion_id, org_id }) => {
    const sg = one<{ paper_id: string; question_id: string; action: AssistAction; instruction: string | null; status: string }>("SELECT * FROM question_suggestions WHERE id = ?", suggestion_id);
    if (!sg || sg.status !== "queued") return;
    const p = one<PaperRow>("SELECT * FROM question_papers WHERE id = ?", sg.paper_id);
    const at = p && findQuestion(json<SectionT[]>(p.sections, []), sg.question_id);
    if (!p || !at) { run("UPDATE question_suggestions SET status = 'failed', error = 'The question was removed.', updated_at = CURRENT_TIMESTAMP WHERE id = ?", suggestion_id); return; }
    const out = await assistQuestion(org_id, { subject: p.subject, class_level: p.class_level, board: p.board, language: p.language, marking_notes: p.marking_notes, question: at.q as QuestionT, action: sg.action, instruction: sg.instruction });
    // Keep what must not change, whatever the model returned.
    const fixed = { ...out, id: at.q.id, type: at.q.type, marks: at.q.marks, negative_marks: at.q.negative_marks, rubric: fitRubric(out.rubric ?? [], at.q.marks) };
    run("UPDATE question_suggestions SET status = 'ready', result = ?, error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?", JSON.stringify(fixed), suggestion_id);
  },
  onFail: ({ suggestion_id, org_id, charge_ref }, msg) => {
    run("UPDATE question_suggestions SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", msg, suggestion_id);
    refund(org_id, charge_ref, "Refund: AI help on a question didn't finish");
  },
});
paperRoutes.post("/papers/:id/questions/:qid/assist", staff, aiPaperLimit, (req, res) => {
  const b = z.object({ action: z.enum(["refine", "regenerate", "rewrite"]), instruction: z.string().trim().max(1000).optional() }).parse(req.body);
  if (b.action === "refine" && !b.instruction) return res.status(400).json({ error: "Say what to change, e.g. \"show the unit conversion step\"." });
  const org = req.user!.org_id;
  const p = paperInOrg(req.params.id, org);
  if (!p) return res.status(404).json({ error: "Paper not found" });
  if (p.status === "generating") return res.status(409).json({ error: "The paper is still being prepared." });
  if (!findQuestion(json<SectionT[]>(p.sections, []), req.params.qid)) return res.status(404).json({ error: "Question not found" });
  if (one("SELECT 1 FROM question_suggestions WHERE paper_id = ? AND question_id = ? AND status = 'queued'", p.id, req.params.qid))
    return res.status(409).json({ error: "The AI is already working on this question." });
  const problem = aiProblem(org);
  if (problem) return res.status(400).json({ error: problem });
  const id = uid("sug");
  const chargeRef = charge(org, "question_assist", `assist:${id}`, { userId: req.user!.id });
  run("INSERT INTO question_suggestions (id, org_id, paper_id, question_id, action, instruction, created_by) VALUES (?,?,?,?,?,?,?)",
    id, org, p.id, req.params.qid, b.action, b.instruction ?? null, req.user!.id);
  enqueueJob("question_assist", { suggestion_id: id, org_id: org, charge_ref: chargeRef }, { orgId: org, dedupeKey: `assist:${id}` });
  res.json({ id });
});
/** Suggestions still waiting for the teacher (or still being written), newest first. */
paperRoutes.get("/papers/:id/suggestions", staff, (req, res) => {
  if (!paperInOrg(req.params.id, req.user!.org_id)) return res.status(404).json({ error: "Paper not found" });
  res.json(all<any>(`SELECT id, question_id, action, instruction, status, result, error, created_at FROM question_suggestions
    WHERE paper_id = ? AND status IN ('queued','ready','failed') ORDER BY created_at DESC`, req.params.id).map((r) => ({ ...r, result: json(r.result, null) })));
});
paperRoutes.post("/papers/:id/suggestions/:sid/:verb", staff, (req, res) => {
  const verb = req.params.verb;
  if (verb !== "apply" && verb !== "discard") return res.status(404).json({ error: "Not found" });
  const p = paperInOrg(req.params.id, req.user!.org_id);
  const sg = p && one<{ id: string; question_id: string; action: AssistAction; status: string; result: string | null }>("SELECT * FROM question_suggestions WHERE id = ? AND paper_id = ?", req.params.sid, p.id);
  if (!p || !sg) return res.status(404).json({ error: "Suggestion not found" });
  if (verb === "discard") {
    run("UPDATE question_suggestions SET status = 'discarded', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('ready','failed')", sg.id);
    return res.json({ ok: true });
  }
  if (sg.status !== "ready") return res.status(409).json({ error: sg.status === "queued" ? "The suggestion isn't ready yet." : "This suggestion can't be used." });
  const sections = json<SectionT[]>(p.sections, []);
  const at = findQuestion(sections, sg.question_id);
  if (!at) return res.status(404).json({ error: "The question was removed." });
  const r = json<QuestionT>(sg.result, null as never);
  const cur = at.q;
  const next = sg.action === "rewrite"
    ? { ...cur, text: r.text, options: cur.type === "mcq" ? r.options : [], correct_option: cur.type === "mcq" ? r.correct_option : null, numeric_answer: cur.type === "numeric" ? r.numeric_answer : null,
        difficulty: r.difficulty, subtopic: r.subtopic || cur.subtopic, solution: r.solution, rubric: fitRubric(r.rubric, cur.marks) }
    : { ...cur, solution: r.solution, rubric: fitRubric(r.rubric, cur.marks),
        // A fresh solution may correct a wrong objective answer.
        correct_option: cur.type === "mcq" && r.correct_option != null && r.correct_option < cur.options.length ? r.correct_option : cur.correct_option,
        numeric_answer: cur.type === "numeric" && r.numeric_answer != null ? r.numeric_answer : cur.numeric_answer };
  at.sec.questions[at.i] = StoredQuestion.parse(next);
  saveSections(p.id, sections);
  // A changed question needs checking again.
  const checked = json<string[]>(p.checked_questions, []).filter((x) => x !== sg.question_id);
  run("UPDATE question_papers SET checked_questions = ? WHERE id = ?", JSON.stringify(checked), p.id);
  run("UPDATE question_suggestions SET status = 'applied', updated_at = CURRENT_TIMESTAMP WHERE id = ?", sg.id);
  res.json({ ok: true, question: at.sec.questions[at.i] });
});
