import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { one, run, uid, json, all } from "../db.js";
import { requireAuth, signToken, type AuthUser } from "../auth.js";

export const publicRoutes = Router();

publicRoutes.post("/auth/login", (req, res) => {
  const { identifier, password } = z.object({ identifier: z.string().min(1), password: z.string().min(1) }).parse(req.body);
  const id = identifier.trim().toLowerCase();
  const user = one<AuthUser & { password_hash: string }>(
    "SELECT id, org_id, role, name, email, password_hash FROM users WHERE lower(email) = ? OR lower(username) = ? OR phone = ?",
    id, id, identifier.trim(),
  );
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: "Wrong email/username or password" });
  const { password_hash: _, ...safe } = user;
  res.json({ token: signToken(safe), user: safe });
});

// Self-serve signup: creates an institute and its first admin.
publicRoutes.post("/auth/register", (req, res) => {
  const body = z.object({
    institute: z.string().min(2), city: z.string().optional(),
    name: z.string().min(2), email: z.string().email(), password: z.string().min(8),
  }).parse(req.body);
  if (one("SELECT 1 FROM users WHERE lower(email) = ?", body.email.toLowerCase())) return res.status(409).json({ error: "That email is already registered" });
  const orgId = uid("org");
  const userId = uid("usr");
  run("INSERT INTO orgs (id, name, city) VALUES (?, ?, ?)", orgId, body.institute, body.city ?? null);
  run("INSERT INTO users (id, org_id, role, name, email, password_hash) VALUES (?, ?, 'admin', ?, ?, ?)",
    userId, orgId, body.name, body.email.toLowerCase(), bcrypt.hashSync(body.password, 10));
  const user: AuthUser = { id: userId, org_id: orgId, role: "admin", name: body.name, email: body.email.toLowerCase() };
  res.json({ token: signToken(user), user });
});

publicRoutes.get("/me", requireAuth, (req, res) => {
  const org = one("SELECT id, name, city FROM orgs WHERE id = ?", req.user!.org_id);
  res.json({ user: req.user, org });
});

publicRoutes.post("/auth/change-password", requireAuth, (req, res) => {
  const { current, next } = z.object({ current: z.string(), next: z.string().min(8) }).parse(req.body);
  const u = one<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", req.user!.id)!;
  if (!bcrypt.compareSync(current, u.password_hash)) return res.status(400).json({ error: "Current password is wrong" });
  run("UPDATE users SET password_hash = ? WHERE id = ?", bcrypt.hashSync(next, 10), req.user!.id);
  res.json({ ok: true });
});

publicRoutes.post("/contact", (req, res) => {
  const b = z.object({
    first_name: z.string().min(1), last_name: z.string().min(1), phone: z.string().min(6),
    institute: z.string().min(1), students: z.string().min(1),
    email: z.string().email().optional().or(z.literal("")), message: z.string().optional(),
  }).parse(req.body);
  run("INSERT INTO leads (id, first_name, last_name, phone, institute, students, email, message) VALUES (?,?,?,?,?,?,?,?)",
    uid("lead"), b.first_name, b.last_name, b.phone, b.institute, b.students, b.email || null, b.message ?? null);
  res.json({ ok: true });
});

// Public report card shared with parents by link.
publicRoutes.get("/public/report/:token", (req, res) => {
  const row = one<any>(`
    SELECT a.*, t.title AS test_title, t.results_published, u.name AS student_name, o.name AS org_name,
           p.sections, p.subject, p.total_marks
    FROM share_tokens s JOIN attempts a ON a.id = s.attempt_id JOIN tests t ON t.id = a.test_id
    JOIN users u ON u.id = a.student_id JOIN orgs o ON o.id = t.org_id JOIN question_papers p ON p.id = t.paper_id
    WHERE s.token = ?`, req.params.token);
  if (!row || !row.results_published) return res.status(404).json({ error: "This report is not available" });
  const rank = all<{ student_id: string }>("SELECT student_id FROM attempts WHERE test_id = ? AND score IS NOT NULL ORDER BY score DESC", row.test_id)
    .findIndex((r) => r.student_id === row.student_id) + 1;
  res.json({
    org_name: row.org_name, student_name: row.student_name, test_title: row.test_title, subject: row.subject,
    score: row.score, max_score: row.max_score, rank, evaluation: json(row.evaluation, null), sections: json(row.sections, []),
  });
});
