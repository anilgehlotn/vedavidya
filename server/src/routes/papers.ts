import { Router } from "express";
import { z } from "zod";
import { all, json, one, run, uid } from "../db.js";
import { staff } from "../auth.js";
import { generatePaper, AiError, type PaperSpec } from "../ai/claude.js";
import { Section, type Section as SectionT } from "../ai/schemas.js";

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
  subject: z.string().min(1), board: z.string().min(1), class_level: z.string().min(1), topics: z.string().min(1),
  language: z.string().default("English"), difficulty: z.enum(["easy", "medium", "hard", "mixed"]).default("mixed"),
  duration_min: z.number().int().min(5).max(360).default(60),
  sections: z.array(z.object({
    name: z.string().min(1), type: z.enum(["mcq", "numeric", "short", "long"]),
    count: z.number().int().min(1).max(60), marks_each: z.number().min(0.5).max(50), negative_marks: z.number().min(0).max(10).default(0),
  })).min(1).max(8),
  notes: z.string().optional(),
});

// Generation runs in the background; the client polls the paper's status.
paperRoutes.post("/papers/generate", staff, (req, res) => {
  const spec = SpecBody.parse(req.body) as PaperSpec;
  const id = uid("qp");
  run(`INSERT INTO question_papers (id, org_id, title, subject, board, class_level, language, duration_min, status, created_by)
       VALUES (?,?,?,?,?,?,?,?, 'generating', ?)`,
    id, req.user!.org_id, `${spec.subject} - ${spec.class_level}`, spec.subject, spec.board, spec.class_level, spec.language, spec.duration_min, req.user!.id);
  res.json({ id });
  generatePaper(spec)
    .then((paper) => {
      run("UPDATE question_papers SET title = ?, instructions = ?, sections = ?, total_marks = ?, status = 'draft' WHERE id = ?",
        paper.title, paper.instructions, JSON.stringify(paper.sections), totalMarks(paper.sections), id);
    })
    .catch((e) => {
      run("UPDATE question_papers SET status = 'failed', error = ? WHERE id = ?", e instanceof AiError ? e.message : String(e), id);
    });
});

// Manual creation / full save from the editor.
const PaperBody = z.object({
  title: z.string().min(1), subject: z.string().optional(), board: z.string().optional(), class_level: z.string().optional(),
  language: z.string().optional(), duration_min: z.number().int().min(5).max(360), instructions: z.string().optional(),
  sections: z.array(Section),
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
  run("DELETE FROM question_papers WHERE id = ? AND org_id = ?", req.params.id, req.user!.org_id);
  res.json({ ok: true });
});
