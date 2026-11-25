import { Router } from "express";
import { z } from "zod";
import { all, json, one, run, uid } from "../db.js";
import { staff } from "../auth.js";
import { rateLimit } from "../ratelimit.js";

// Each AI paper costs API credits; cap how many an institute can start in a short time.
const aiPaperLimit = rateLimit("ai-paper", 30, 60 * 60 * 1000, (r) => r.user?.org_id ?? r.ip ?? "?");
import { generatePaper, importPaper, tagSubtopics, AiError, aiProblem, type PaperSpec } from "../ai/claude.js";
import multer from "multer";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { UPLOAD_DIR } from "../db.js";
import { normalisePage, removeFiles, UploadError } from "../images.js";
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

// Generation runs in the background; the client polls the paper's status.
paperRoutes.post("/papers/generate", staff, aiPaperLimit, (req, res) => {
  const spec = SpecBody.parse(req.body) as PaperSpec;
  const problem = aiProblem(req.user!.org_id);
  if (problem) return res.status(400).json({ error: problem });
  const id = uid("qp");
  run(`INSERT INTO question_papers (id, org_id, title, subject, board, class_level, language, duration_min, status, created_by)
       VALUES (?,?,?,?,?,?,?,?, 'generating', ?)`,
    id, req.user!.org_id, `${spec.subject} - ${spec.class_level}`, spec.subject, spec.board, spec.class_level, spec.language, spec.duration_min, req.user!.id);
  res.json({ id });
  generatePaper(req.user!.org_id, spec)
    .then((paper) => {
      run("UPDATE question_papers SET title = ?, instructions = ?, sections = ?, total_marks = ?, status = 'draft' WHERE id = ?",
        paper.title, paper.instructions, JSON.stringify(paper.sections), totalMarks(paper.sections), id);
      syncTestMarks(id);
    })
    .catch((e) => {
      run("UPDATE question_papers SET status = 'failed', error = ? WHERE id = ?", e instanceof AiError ? e.message : String(e), id);
    });
});

// Import an existing paper: photos/PDF of the question paper, plus the answer key if available.
const paperUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, `${crypto.randomBytes(10).toString("hex")}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 40 },
  fileFilter: (_req, file, cb) => cb(null, /\.(jpe?g|png|webp|pdf)$/i.test(file.originalname)),
}).fields([{ name: "paper", maxCount: 20 }, { name: "key", maxCount: 20 }]);

paperRoutes.post("/papers/import", staff, aiPaperLimit, paperUpload, async (req, res, next) => {
  const got = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
  const all_ = [...(got.paper ?? []), ...(got.key ?? [])];
  try {
    const meta = z.object({
      subject: z.string().max(80).optional(), board: z.string().max(80).optional(), class_level: z.string().max(80).optional(),
      language: z.string().max(60).optional(), duration_min: z.coerce.number().int().min(5).max(360).optional(), notes: z.string().max(1000).optional(),
    }).parse(req.body ?? {});
    const problem = aiProblem(req.user!.org_id);
    if (problem) { all_.forEach((f) => fs.rmSync(f.path, { force: true })); return res.status(400).json({ error: problem }); }
    if (!got.paper?.length) { all_.forEach((f) => fs.rmSync(f.path, { force: true })); return res.status(400).json({ error: "Add photos or a PDF of the question paper" }); }
    const norm = async (list: Express.Multer.File[] = []) => {
      const out: string[] = [];
      for (const f of list) out.push(await normalisePage(UPLOAD_DIR, f.filename, f.originalname));
      return out;
    };
    let paperFiles: string[] = [], keyFiles: string[] = [];
    try { paperFiles = await norm(got.paper); keyFiles = await norm(got.key); }
    catch (e) {
      removeFiles(UPLOAD_DIR, [...paperFiles, ...keyFiles]);
      all_.forEach((f) => fs.rmSync(f.path, { force: true }));
      if (e instanceof UploadError) return res.status(400).json({ error: e.message });
      throw e;
    }
    const id = uid("qp");
    run(`INSERT INTO question_papers (id, org_id, title, subject, board, class_level, language, duration_min, status, created_by)
         VALUES (?,?,?,?,?,?,?,?, 'generating', ?)`,
      id, req.user!.org_id, "Imported paper", meta.subject ?? null, meta.board ?? null, meta.class_level ?? null, meta.language ?? "English", meta.duration_min ?? 60, req.user!.id);
    res.json({ id });
    importPaper(req.user!.org_id, paperFiles.map((f) => path.join(UPLOAD_DIR, f)), keyFiles.map((f) => path.join(UPLOAD_DIR, f)), meta)
      .then((paper) => {
        run("UPDATE question_papers SET title = ?, instructions = ?, sections = ?, total_marks = ?, status = 'draft' WHERE id = ?",
          paper.title, paper.instructions, JSON.stringify(paper.sections), totalMarks(paper.sections), id);
        syncTestMarks(id);
      })
      .catch((e) => run("UPDATE question_papers SET status = 'failed', error = ? WHERE id = ?", e instanceof AiError ? e.message : String(e), id))
      .finally(() => removeFiles(UPLOAD_DIR, [...paperFiles, ...keyFiles]));
  } catch (e) { next(e); }
});

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
  run("UPDATE question_papers SET status = 'failed', error = 'Interrupted by a server restart. Please generate it again.' WHERE status = 'generating'");
}

/** Tests using this paper show its current total for sheets that aren't marked yet. */
function syncTestMarks(paperId: string) {
  run(`UPDATE attempts SET max_score = (SELECT total_marks FROM question_papers WHERE id = ?)
       WHERE score IS NULL AND test_id IN (SELECT id FROM tests WHERE paper_id = ?)`, paperId, paperId);
}

// Papers made before sub-topics existed get them from AI once, so reports can name the exact concept to re-teach.
const tagging = new Map<string, Promise<void>>();
const missingSubtopics = (sections: SectionT[]) => sections.some((sec) => sec.questions.some((q) => !String((q as { subtopic?: string }).subtopic ?? "").trim()));
export function ensureSubtopics(paperId: string): Promise<void> {
  if (tagging.has(paperId)) return tagging.get(paperId)!;
  const p = one<any>("SELECT id, org_id, subject, class_level, sections, status FROM question_papers WHERE id = ?", paperId);
  if (!p || !["draft", "approved"].includes(p.status) || !missingSubtopics(json<SectionT[]>(p.sections, [])) || aiProblem(p.org_id)) return Promise.resolve();
  const qs = json<SectionT[]>(p.sections, []).flatMap((sec) => sec.questions).map((q) => ({ id: q.id, text: q.text.slice(0, 600), topic: q.topic, solution: q.solution.slice(0, 300) }));
  const job = tagSubtopics(p.org_id, { subject: p.subject, class_level: p.class_level, questions: qs })
    .then((tags) => {
      const byId = new Map((tags?.questions ?? []).map((t) => [t.id, t]));
      // Re-read so edits made while AI was working are kept; only empty sub-topics (and empty chapters) are filled.
      const cur = one<any>("SELECT sections FROM question_papers WHERE id = ?", paperId);
      if (!cur) return;
      const sections = json<SectionT[]>(cur.sections, []).map((sec) => ({ ...sec, questions: sec.questions.map((q) => {
        const t = byId.get(q.id);
        const sub = String((q as { subtopic?: string }).subtopic ?? "").trim();
        return t ? { ...q, topic: q.topic?.trim() ? q.topic : t.topic.slice(0, 120), subtopic: sub || t.subtopic.slice(0, 160) } : q;
      }) }));
      run("UPDATE question_papers SET sections = ? WHERE id = ?", JSON.stringify(sections), paperId);
    })
    .catch((e) => console.error(`Sub-topic tagging failed for ${paperId}:`, e instanceof AiError ? e.message : e))
    .finally(() => tagging.delete(paperId));
  tagging.set(paperId, job);
  return job;
}
