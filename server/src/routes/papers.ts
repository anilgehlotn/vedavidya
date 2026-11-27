import { Router } from "express";
import { z } from "zod";
import { wrap } from "../lib/http.js";
import { all, json, one, run, uid } from "../db.js";
import { staff } from "../auth.js";
import { rateLimit } from "../ratelimit.js";

// Each AI paper costs API credits; cap how many an institute can start in a short time.
const aiPaperLimit = rateLimit("ai-paper", 30, 60 * 60 * 1000, (r) => r.user?.org_id ?? r.ip ?? "?");
import { generatePaper, importPaper, tagSubtopics, aiProblem, type PaperSpec, type ImportMeta } from "../ai/claude.js";
import { enqueueJob, registerJob } from "../lib/jobs.js";
import { createDocument, processDocument } from "../lib/documents.js";
import { FileProblem } from "../lib/files.js";
import { takeUploads } from "./uploads.js";
import { StoredSection as Section, type Section as SectionT } from "../ai/schemas.js";

export const paperRoutes = Router();

export const totalMarks = (sections: SectionT[]) => sections.reduce((t, s) => t + s.questions.reduce((a, q) => a + q.marks, 0), 0);

const serialize = (p: any) => p && { ...p, sections: json(p.sections, []) };

paperRoutes.get("/papers", staff, (req, res) => {
  res.json(all(`SELECT p.id, p.title, p.subject, p.board, p.class_level, p.language, p.total_marks, p.duration_min, p.status, p.error, p.created_at,
      u.name AS created_by_name FROM question_papers p LEFT JOIN users u ON u.id = p.created_by
    WHERE p.org_id = ? ORDER BY p.created_at DESC`, req.user!.org_id));
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
  run("UPDATE question_papers SET title = ?, instructions = ?, sections = ?, total_marks = ?, status = 'draft', error = NULL WHERE id = ?",
    paper.title, paper.instructions, JSON.stringify(paper.sections), totalMarks(paper.sections), id);
  syncTestMarks(id);
};

registerJob<{ paper_id: string; org_id: string; spec: PaperSpec }>("generate_paper", {
  concurrency: 2,
  run: async ({ paper_id, org_id, spec }) => savePaper(paper_id, await generatePaper(org_id, spec)),
  onRetry: (p, msg) => run("UPDATE question_papers SET error = ? WHERE id = ?", `Retrying: ${msg}`, p.paper_id),
  onFail: (p, msg) => failPaper(p.paper_id, msg),
});

paperRoutes.post("/papers/generate", staff, aiPaperLimit, (req, res) => {
  const spec = SpecBody.parse(req.body) as PaperSpec;
  const problem = aiProblem(req.user!.org_id);
  if (problem) return res.status(400).json({ error: problem });
  const id = uid("qp");
  run(`INSERT INTO question_papers (id, org_id, title, subject, board, class_level, language, duration_min, status, created_by)
       VALUES (?,?,?,?,?,?,?,?, 'generating', ?)`,
    id, req.user!.org_id, `${spec.subject} - ${spec.class_level}`, spec.subject, spec.board, spec.class_level, spec.language, spec.duration_min, req.user!.id);
  enqueueJob("generate_paper", { paper_id: id, org_id: req.user!.org_id, spec }, { orgId: req.user!.org_id, dedupeKey: `paper:${id}` });
  res.json({ id });
});

// Import an existing paper: uploaded PDF/photos of the question paper, plus the answer key if available.
// The files are already uploaded (resumable /uploads); here they become documents and a reading job is queued.
interface ImportJob { paper_id: string; org_id: string; paper_doc: string; key_doc: string | null; meta: ImportMeta }
registerJob<ImportJob>("import_paper", {
  concurrency: 2,
  run: async ({ paper_id, org_id, paper_doc, key_doc, meta }) => {
    const paperPages = (await processDocument(paper_doc)).map((p) => p.storage_key);
    const keyPages = key_doc ? (await processDocument(key_doc)).map((p) => p.storage_key) : [];
    if (paperPages.length + keyPages.length > 100) throw new FileProblem("The paper and answer key together have more than 100 pages. Upload fewer pages.");
    savePaper(paper_id, await importPaper(org_id, paperPages, keyPages, meta));
  },
  onRetry: (p, msg) => run("UPDATE question_papers SET error = ? WHERE id = ?", `Retrying: ${msg}`, p.paper_id),
  onFail: (p, msg) => failPaper(p.paper_id, msg),
});

paperRoutes.post("/papers/import", staff, aiPaperLimit, wrap(async (req, res) => {
  const b = z.object({
    paper_uploads: z.array(z.string().max(60)).min(1, "Add the question paper").max(50),
    key_uploads: z.array(z.string().max(60)).max(50).default([]),
    key_mode: z.enum(["auto", "in_paper", "separate"]).default("auto"),
    subject: z.string().max(80).optional(), board: z.string().max(80).optional(), class_level: z.string().max(80).optional(),
    language: z.string().max(60).optional(), duration_min: z.coerce.number().int().min(5).max(360).optional(), notes: z.string().max(1000).optional(),
  }).parse(req.body ?? {});
  if (b.key_mode === "separate" && !b.key_uploads.length) return res.status(400).json({ error: "Add the answer key file, or choose another answer key option" });
  const problem = aiProblem(req.user!.org_id);
  if (problem) return res.status(400).json({ error: problem });
  const user = req.user!;
  const paperUps = takeUploads(b.paper_uploads, user, "paper");
  const keyUps = b.key_mode === "separate" ? takeUploads(b.key_uploads, user, ["answer_key", "paper"]) : [];
  const pages = [...paperUps, ...keyUps].reduce((t, u) => t + (u.pages ?? 1), 0);
  if (pages > 100) return res.status(400).json({ error: `The paper and answer key together have ${pages} pages. The limit is 100.` });
  const id = uid("qp");
  run(`INSERT INTO question_papers (id, org_id, title, subject, board, class_level, language, duration_min, status, created_by)
       VALUES (?,?,?,?,?,?,?,?, 'generating', ?)`,
    id, user.org_id, paperUps[0].filename.replace(/\.[^.]+$/, "").slice(0, 120) || "Imported paper", b.subject ?? null, b.board ?? null, b.class_level ?? null, b.language ?? "English", b.duration_min ?? 60, user.id);
  const paperDoc = await createDocument({ orgId: user.org_id, userId: user.id, purpose: "paper", uploads: paperUps, paperId: id, process: false });
  const keyDoc = keyUps.length ? await createDocument({ orgId: user.org_id, userId: user.id, purpose: "answer_key", uploads: keyUps, paperId: id, process: false }) : null;
  enqueueJob("import_paper", { paper_id: id, org_id: user.org_id, paper_doc: paperDoc, key_doc: keyDoc, meta: { ...b, key_mode: b.key_mode } satisfies ImportMeta },
    { orgId: user.org_id, dedupeKey: `paper:${id}` });
  res.json({ id });
}));

// Manual creation / full save from the editor.
const PaperBody = z.object({
  title: z.string().trim().min(1).max(200), subject: z.string().max(80).optional(), board: z.string().max(80).optional(), class_level: z.string().max(80).optional(),
  language: z.string().max(60).optional(), duration_min: z.number().int().min(5).max(360), instructions: z.string().max(5000).optional(),
  sections: z.array(Section).max(20).refine((ss) => ss.reduce((t, x) => t + x.questions.length, 0) <= 300, "At most 300 questions")
    .refine((ss) => { const ids = ss.flatMap((x) => x.questions.map((q) => q.id)); return new Set(ids).size === ids.length; }, "Question ids must be unique"),
});

paperRoutes.post("/papers", staff, (req, res) => {
  const b = PaperBody.parse(req.body);
  const id = uid("qp");
  run(`INSERT INTO question_papers (id, org_id, title, subject, board, class_level, language, duration_min, instructions, sections, total_marks, status, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?, 'draft', ?)`,
    id, req.user!.org_id, b.title, b.subject ?? null, b.board ?? null, b.class_level ?? null, b.language ?? "English",
    b.duration_min, b.instructions ?? null, JSON.stringify(b.sections), totalMarks(b.sections), req.user!.id);
  res.json({ id });
});

paperRoutes.put("/papers/:id", staff, (req, res) => {
  const b = PaperBody.parse(req.body);
  const r = run(`UPDATE question_papers SET title = ?, subject = ?, board = ?, class_level = ?, language = ?, duration_min = ?, instructions = ?,
      sections = ?, total_marks = ?, status = CASE WHEN status = 'failed' THEN 'draft' ELSE status END WHERE id = ? AND org_id = ?`,
    b.title, b.subject ?? null, b.board ?? null, b.class_level ?? null, b.language ?? "English", b.duration_min, b.instructions ?? null,
    JSON.stringify(b.sections), totalMarks(b.sections), req.params.id, req.user!.org_id);
  if (!r.changes) return res.status(404).json({ error: "Paper not found" });
  syncTestMarks(req.params.id);
  res.json({ ok: true });
});

paperRoutes.post("/papers/:id/approve", staff, (req, res) => {
  run("UPDATE question_papers SET status = 'approved' WHERE id = ? AND org_id = ? AND status = 'draft'", req.params.id, req.user!.org_id);
  res.json({ ok: true });
});

paperRoutes.post("/papers/:id/clone", staff, (req, res) => {
  const p = one<any>("SELECT * FROM question_papers WHERE id = ? AND org_id = ?", req.params.id, req.user!.org_id);
  if (!p) return res.status(404).json({ error: "Paper not found" });
  const id = uid("qp");
  run(`INSERT INTO question_papers (id, org_id, title, subject, board, class_level, language, duration_min, instructions, sections, total_marks, status, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?, 'draft', ?)`,
    id, p.org_id, `${p.title} (copy)`, p.subject, p.board, p.class_level, p.language, p.duration_min, p.instructions, p.sections, p.total_marks, req.user!.id);
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
