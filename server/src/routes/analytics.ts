// Analytics built from evaluated attempts: trends over tests and topic mastery from per-question marks.
import { Router } from "express";
import { all, json, one } from "../db.js";
import type { Section, SheetEvaluation } from "../ai/schemas.js";

export const analyticsRoutes = Router();

interface AttemptRow { test_id: string; title: string; date: string; score: number; max_score: number; evaluation: string; sections: string; student_id: string }

function topicMastery(rows: AttemptRow[]) {
  const topics = new Map<string, { got: number; max: number }>();
  for (const r of rows) {
    const ev = json<SheetEvaluation | null>(r.evaluation, null);
    const qs = new Map(json<Section[]>(r.sections, []).flatMap((s) => s.questions).map((q) => [q.id, q]));
    for (const qe of ev?.questions ?? []) {
      const topic = qs.get(qe.question_id)?.topic ?? "Other";
      const t = topics.get(topic) ?? { got: 0, max: 0 };
      t.got += Math.max(0, qe.marks_awarded);
      t.max += qe.max_marks;
      topics.set(topic, t);
    }
  }
  return [...topics.entries()].map(([topic, t]) => ({ topic, pct: t.max ? Math.round((t.got / t.max) * 100) : 0, max: t.max }))
    .sort((a, b) => a.pct - b.pct);
}

const BASE = `SELECT a.test_id, t.title, coalesce(t.scheduled_at, t.created_at) AS date, a.score, a.max_score, a.evaluation, p.sections, a.student_id
  FROM attempts a JOIN tests t ON t.id = a.test_id JOIN question_papers p ON p.id = t.paper_id
  WHERE a.score IS NOT NULL AND a.max_score > 0`;

analyticsRoutes.get("/analytics/student/:id", (req, res) => {
  const u = req.user!;
  if (u.role === "student" && u.id !== req.params.id) return res.status(403).json({ error: "Forbidden" });
  const student = one<any>(`SELECT u.id, u.name, u.username, e.roll_no, b.name AS batch_name, b.id AS batch_id FROM users u
    LEFT JOIN enrollments e ON e.student_id = u.id LEFT JOIN batches b ON b.id = e.batch_id
    WHERE u.id = ? AND u.org_id = ? AND u.role = 'student'`, req.params.id, u.org_id);
  if (!student) return res.status(404).json({ error: "Student not found" });
  const rows = all<AttemptRow>(`${BASE} AND a.student_id = ? ${u.role === "student" ? "AND t.results_published = 1" : ""} ORDER BY date`, student.id);
  const trend = rows.map((r) => {
    const classAvg = one<{ v: number }>("SELECT avg(score * 100.0 / max_score) v FROM attempts WHERE test_id = ? AND score IS NOT NULL AND max_score > 0", r.test_id)?.v ?? 0;
    return { test_id: r.test_id, title: r.title, date: r.date, pct: Math.round((r.score / r.max_score) * 100), class_avg: Math.round(classAvg) };
  });
  const gaps = rows.flatMap((r) => json<SheetEvaluation | null>(r.evaluation, null)?.gaps ?? []);
  res.json({ student, trend, topics: topicMastery(rows), gaps: [...new Set(gaps)].slice(-8),
    average: trend.length ? Math.round(trend.reduce((t, x) => t + x.pct, 0) / trend.length) : null });
});

analyticsRoutes.get("/analytics/batch/:id", (req, res) => {
  const u = req.user!;
  if (u.role === "student") return res.status(403).json({ error: "Forbidden" });
  const batch = one<any>("SELECT b.*, c.name AS centre_name FROM batches b LEFT JOIN centres c ON c.id = b.centre_id WHERE b.id = ? AND b.org_id = ?", req.params.id, u.org_id);
  if (!batch) return res.status(404).json({ error: "Batch not found" });
  const rows = all<AttemptRow>(`${BASE} AND a.student_id IN (SELECT student_id FROM enrollments WHERE batch_id = ?) ORDER BY date`, batch.id);
  const byTest = new Map<string, { title: string; date: string; pcts: number[] }>();
  const byStudent = new Map<string, number[]>();
  for (const r of rows) {
    const pct = (r.score / r.max_score) * 100;
    const t = byTest.get(r.test_id) ?? { title: r.title, date: r.date, pcts: [] };
    t.pcts.push(pct); byTest.set(r.test_id, t);
    byStudent.set(r.student_id, [...(byStudent.get(r.student_id) ?? []), pct]);
  }
  const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  const names = new Map(all<{ id: string; name: string }>("SELECT u.id, u.name FROM users u JOIN enrollments e ON e.student_id = u.id WHERE e.batch_id = ?", batch.id).map((s) => [s.id, s.name]));
  const leaderboard = [...byStudent.entries()].map(([id, p]) => ({ id, name: names.get(id) ?? "?", avg: avg(p), tests: p.length })).sort((a, b) => b.avg - a.avg);
  const buckets = [0, 0, 0, 0, 0];
  for (const s of leaderboard) buckets[Math.min(4, Math.floor(s.avg / 20))]++;
  res.json({
    batch, student_count: names.size,
    trend: [...byTest.entries()].map(([id, t]) => ({ test_id: id, title: t.title, date: t.date, avg: avg(t.pcts), top: Math.round(Math.max(...t.pcts)) })),
    topics: topicMastery(rows), leaderboard,
    distribution: ["0-20", "20-40", "40-60", "60-80", "80-100"].map((label, i) => ({ label, count: buckets[i] })),
  });
});
