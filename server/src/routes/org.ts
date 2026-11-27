// Institute structure: centres, batches, people, notices, and the overview dashboard.
import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { z } from "zod";
import { all, one, run, uid, bumpTokenVersion } from "../db.js";
import { storage } from "../lib/storage.js";
import { deleteDocuments } from "../lib/documents.js";
import { studentDocuments, studentFiles } from "./tests.js";

class ClientError extends Error { constructor(msg: string, public status = 400) { super(msg); } }
const inOrg = (table: "batches" | "centres" | "users", id: string | null | undefined, org: string) =>
  !id || Boolean(one(`SELECT 1 FROM ${table} WHERE id = ? AND org_id = ?`, id, org));
import { adminOnly, staff } from "../auth.js";

export const orgRoutes = Router();

orgRoutes.get("/overview", staff, (req, res) => {
  const org = req.user!.org_id;
  const count = (sql: string) => (one<{ n: number }>(sql, org)?.n ?? 0);
  const stats = {
    students: count("SELECT count(*) n FROM users WHERE org_id = ? AND role = 'student'"),
    teachers: count("SELECT count(*) n FROM users WHERE org_id = ? AND role = 'teacher'"),
    batches: count("SELECT count(*) n FROM batches WHERE org_id = ?"),
    centres: count("SELECT count(*) n FROM centres WHERE org_id = ?"),
    papers: count("SELECT count(*) n FROM question_papers WHERE org_id = ?"),
    tests: count("SELECT count(*) n FROM tests WHERE org_id = ?"),
    sheets_evaluated: count("SELECT count(*) n FROM attempts a JOIN tests t ON t.id = a.test_id WHERE t.org_id = ? AND a.status = 'evaluated'"),
  };
  const recentTests = all(`
    SELECT t.id, t.title, t.mode, t.scheduled_at, t.results_published,
      (SELECT count(*) FROM attempts a WHERE a.test_id = t.id) AS candidates,
      (SELECT count(*) FROM attempts a WHERE a.test_id = t.id AND a.status = 'evaluated') AS evaluated,
      (SELECT avg(a.score * 100.0 / a.max_score) FROM attempts a WHERE a.test_id = t.id AND a.score IS NOT NULL AND a.max_score > 0) AS avg_pct
    FROM tests t WHERE t.org_id = ? ORDER BY coalesce(t.scheduled_at, t.created_at) DESC LIMIT 8`, org);
  const batchPerf = all(`
    SELECT b.id, b.name, count(a.id) AS attempts, avg(a.score * 100.0 / a.max_score) AS avg_pct
    FROM batches b JOIN enrollments e ON e.batch_id = b.id
    LEFT JOIN attempts a ON a.student_id = e.student_id AND a.score IS NOT NULL AND a.max_score > 0
    WHERE b.org_id = ? GROUP BY b.id ORDER BY b.name`, org);
  res.json({ stats, recentTests, batchPerf });
});

// ---- Centres
orgRoutes.get("/centres", staff, (req, res) => {
  res.json(all(`SELECT c.*, (SELECT count(*) FROM batches b WHERE b.centre_id = c.id) AS batch_count
    FROM centres c WHERE org_id = ? ORDER BY name`, req.user!.org_id));
});
orgRoutes.post("/centres", adminOnly, (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(100), city: z.string().max(80).optional() }).parse(req.body);
  const id = uid("ctr");
  run("INSERT INTO centres (id, org_id, name, city) VALUES (?, ?, ?, ?)", id, req.user!.org_id, b.name, b.city ?? null);
  res.json({ id });
});
orgRoutes.delete("/centres/:id", adminOnly, (req, res) => {
  run("DELETE FROM centres WHERE id = ? AND org_id = ?", req.params.id, req.user!.org_id);
  res.json({ ok: true });
});

// ---- Batches
orgRoutes.get("/batches", staff, (req, res) => {
  res.json(all(`SELECT b.*, c.name AS centre_name, u.name AS teacher_name,
      (SELECT count(*) FROM enrollments e WHERE e.batch_id = b.id) AS student_count
    FROM batches b LEFT JOIN centres c ON c.id = b.centre_id LEFT JOIN users u ON u.id = b.teacher_id
    WHERE b.org_id = ? ORDER BY c.name, b.name`, req.user!.org_id));
});
const BatchBody = z.object({ name: z.string().trim().min(1).max(100), course: z.string().max(100).optional(), centre_id: z.string().max(40).nullable().optional(), teacher_id: z.string().max(40).nullable().optional() });
const checkBatchRefs = (b: z.infer<typeof BatchBody>, org: string) => {
  if (!inOrg("centres", b.centre_id, org)) throw new ClientError("Unknown centre");
  if (b.teacher_id && !one("SELECT 1 FROM users WHERE id = ? AND org_id = ? AND role IN ('admin','teacher')", b.teacher_id, org)) throw new ClientError("Unknown teacher");
};
orgRoutes.post("/batches", adminOnly, (req, res) => {
  const b = BatchBody.parse(req.body);
  checkBatchRefs(b, req.user!.org_id);
  const id = uid("bat");
  run("INSERT INTO batches (id, org_id, centre_id, name, course, teacher_id) VALUES (?,?,?,?,?,?)",
    id, req.user!.org_id, b.centre_id || null, b.name, b.course ?? null, b.teacher_id || null);
  res.json({ id });
});
orgRoutes.put("/batches/:id", adminOnly, (req, res) => {
  const b = BatchBody.parse(req.body);
  checkBatchRefs(b, req.user!.org_id);
  run("UPDATE batches SET name = ?, course = ?, centre_id = ?, teacher_id = ? WHERE id = ? AND org_id = ?",
    b.name, b.course ?? null, b.centre_id || null, b.teacher_id || null, req.params.id, req.user!.org_id);
  res.json({ ok: true });
});
orgRoutes.delete("/batches/:id", adminOnly, (req, res) => {
  run("DELETE FROM batches WHERE id = ? AND org_id = ?", req.params.id, req.user!.org_id);
  res.json({ ok: true });
});

// ---- People
const makeUsername = (name: string) => {
  const base = name.toLowerCase().replace(/[^a-z]/g, "").slice(0, 10) || "student";
  for (let i = 0; i < 50; i++) {
    const u = base + Math.floor(1000 + Math.random() * (i < 20 ? 9000 : 900000));
    if (!one("SELECT 1 FROM users WHERE username = ?", u)) return u;
  }
  throw new ClientError("Couldn't create a unique username. Please try again.", 500);
};
// 8 easy-to-read characters (no 0/O, 1/l/I), cryptographically random.
const PW_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";
const makePassword = () => Array.from(crypto.randomBytes(8), (b) => PW_CHARS[b % PW_CHARS.length]).join("");

orgRoutes.get("/students", staff, (req, res) => {
  const batch = req.query.batch_id as string | undefined;
  res.json(all(`SELECT u.id, u.name, u.email, u.phone, u.username, e.batch_id, e.roll_no, e.parent_name, e.parent_phone, e.parent_email,
      b.name AS batch_name
    FROM users u LEFT JOIN enrollments e ON e.student_id = u.id LEFT JOIN batches b ON b.id = e.batch_id
    WHERE u.org_id = ? AND u.role = 'student' ${batch ? "AND e.batch_id = ?" : ""} ORDER BY b.name, CAST(e.roll_no AS INTEGER), u.name`,
    ...(batch ? [req.user!.org_id, batch] : [req.user!.org_id])));
});

const StudentBody = z.object({
  name: z.string().trim().min(1).max(100), email: z.string().email().max(200).optional().or(z.literal("")), phone: z.string().max(20).optional(),
  batch_id: z.string().min(1).max(40), roll_no: z.string().trim().max(20).optional(),
  parent_name: z.string().max(100).optional(), parent_phone: z.string().max(20).optional(), parent_email: z.string().max(200).optional(),
});
const rollTaken = (batchId: string, roll: string | undefined, exceptStudent?: string) =>
  Boolean(roll) && Boolean(one("SELECT 1 FROM enrollments WHERE batch_id = ? AND lower(trim(roll_no)) = lower(?) AND student_id <> ?", batchId, roll!.trim(), exceptStudent ?? ""));

function createStudent(orgId: string, s: z.infer<typeof StudentBody>) {
  if (!one("SELECT 1 FROM batches WHERE id = ? AND org_id = ?", s.batch_id, orgId)) throw new ClientError("Pick a batch from your institute");
  if (s.email && one("SELECT 1 FROM users WHERE lower(email) = ?", s.email.toLowerCase())) throw new ClientError(`The email ${s.email} is already used by another account`, 409);
  if (rollTaken(s.batch_id, s.roll_no)) throw new ClientError(`Roll number ${s.roll_no} is already used in this batch`, 409);
  const id = uid("usr");
  const username = makeUsername(s.name);
  const password = makePassword();
  run("INSERT INTO users (id, org_id, role, name, email, phone, username, password_hash) VALUES (?,?, 'student', ?,?,?,?,?)",
    id, orgId, s.name, s.email ? s.email.toLowerCase() : null, s.phone || null, username, bcrypt.hashSync(password, 10));
  run("INSERT INTO enrollments (student_id, batch_id, roll_no, parent_name, parent_phone, parent_email) VALUES (?,?,?,?,?,?)",
    id, s.batch_id, s.roll_no || null, s.parent_name || null, s.parent_phone || null, s.parent_email || null);
  return { id, name: s.name, username, password };
}

orgRoutes.post("/students", staff, (req, res) => {
  res.json(createStudent(req.user!.org_id, StudentBody.parse(req.body)));
});

// Bulk onboarding from pasted CSV rows: name,roll_no,phone,email,parent_phone
orgRoutes.post("/students/bulk", staff, (req, res) => {
  const { batch_id, csv } = z.object({ batch_id: z.string(), csv: z.string().max(200_000) }).parse(req.body);
  if (!one("SELECT 1 FROM batches WHERE id = ? AND org_id = ?", batch_id, req.user!.org_id)) return res.status(400).json({ error: "Pick a batch from your institute" });
  const rows = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (rows.length > 1000) return res.status(400).json({ error: "Add at most 1,000 students at a time" });
  const created: ReturnType<typeof createStudent>[] = [];
  const skipped: { line: number; reason: string }[] = [];
  rows.forEach((line, i) => {
    const [name, roll_no, phone, email, parent_phone] = line.split(/[,\t]/).map((c) => c?.trim().replace(/^"|"$/g, ""));
    if (!name || /^name$/i.test(name)) return;
    try {
      created.push(createStudent(req.user!.org_id, StudentBody.parse({ name, roll_no, phone, email: email && email.includes("@") ? email : "", parent_phone, batch_id })));
    } catch (e) {
      skipped.push({ line: i + 1, reason: e instanceof ClientError ? e.message : e instanceof z.ZodError ? "invalid details" : "could not be added" });
    }
  });
  res.json({ created, skipped });
});

orgRoutes.put("/students/:id", staff, (req, res) => {
  const s = StudentBody.parse(req.body);
  const org = req.user!.org_id;
  if (!one("SELECT 1 FROM users WHERE id = ? AND org_id = ? AND role = 'student'", req.params.id, org)) return res.status(404).json({ error: "Not found" });
  if (!inOrg("batches", s.batch_id, org)) return res.status(400).json({ error: "Pick a batch from your institute" });
  if (s.email && one("SELECT 1 FROM users WHERE lower(email) = ? AND id <> ?", s.email.toLowerCase(), req.params.id)) return res.status(409).json({ error: "That email is already used by another account" });
  if (rollTaken(s.batch_id, s.roll_no, req.params.id)) return res.status(409).json({ error: `Roll number ${s.roll_no} is already used in this batch` });
  run("UPDATE users SET name = ?, email = ?, phone = ? WHERE id = ?", s.name, s.email || null, s.phone || null, req.params.id);
  run("DELETE FROM enrollments WHERE student_id = ?", req.params.id);
  run("INSERT INTO enrollments (student_id, batch_id, roll_no, parent_name, parent_phone, parent_email) VALUES (?,?,?,?,?,?)",
    req.params.id, s.batch_id, s.roll_no || null, s.parent_name || null, s.parent_phone || null, s.parent_email || null);
  res.json({ ok: true });
});

orgRoutes.post("/students/:id/reset-password", staff, (req, res) => {
  const u = one<{ username: string }>("SELECT username FROM users WHERE id = ? AND org_id = ? AND role = 'student'", req.params.id, req.user!.org_id);
  if (!u) return res.status(404).json({ error: "Not found" });
  const password = makePassword();
  run("UPDATE users SET password_hash = ? WHERE id = ?", bcrypt.hashSync(password, 10), req.params.id);
  bumpTokenVersion(req.params.id);
  res.json({ username: u.username, password });
});

// Hand out logins for a whole batch: sets a fresh password for every student in it.
orgRoutes.post("/students/reset-logins", adminOnly, (req, res) => {
  const { batch_id } = z.object({ batch_id: z.string() }).parse(req.body);
  if (!one("SELECT 1 FROM batches WHERE id = ? AND org_id = ?", batch_id, req.user!.org_id)) return res.status(404).json({ error: "Batch not found" });
  const students = all<{ id: string; name: string; username: string; roll_no: string | null }>(`SELECT u.id, u.name, u.username, e.roll_no FROM users u
    JOIN enrollments e ON e.student_id = u.id WHERE e.batch_id = ? AND u.role = 'student' ORDER BY CAST(e.roll_no AS INTEGER), u.name`, batch_id);
  const out = students.map((st) => {
    const password = makePassword();
    run("UPDATE users SET password_hash = ? WHERE id = ?", bcrypt.hashSync(password, 10), st.id);
    bumpTokenVersion(st.id);
    return { name: st.name, roll_no: st.roll_no, username: st.username, password };
  });
  res.json({ created: out });
});

orgRoutes.delete("/students/:id", adminOnly, async (req, res, next) => {
  try {
    if (!one("SELECT 1 FROM users WHERE id = ? AND org_id = ? AND role = 'student'", req.params.id, req.user!.org_id)) return res.status(404).json({ error: "Not found" });
    const files = studentFiles(req.params.id);
    await deleteDocuments(studentDocuments(req.params.id));
    run("DELETE FROM users WHERE id = ? AND org_id = ? AND role = 'student'", req.params.id, req.user!.org_id);
    // Their pages inside a class scan go too (the scan's other pages stay); the page entry is kept but emptied.
    for (const k of files.filter((f) => f.startsWith("docs/"))) run("UPDATE document_pages SET storage_key = '' WHERE storage_key = ?", k);
    await storage.remove(files.filter((f) => f));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

orgRoutes.get("/teachers", staff, (req, res) => {
  res.json(all(`SELECT id, name, email, phone, subject, role FROM users WHERE org_id = ? AND role IN ('admin','teacher') ORDER BY role, name`, req.user!.org_id));
});
orgRoutes.post("/teachers", adminOnly, (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(100), email: z.string().email().max(200), phone: z.string().max(20).optional(), subject: z.string().max(80).optional(), role: z.enum(["teacher", "admin"]).default("teacher") }).parse(req.body);
  if (one("SELECT 1 FROM users WHERE lower(email) = ?", b.email.toLowerCase())) return res.status(409).json({ error: "Email already in use" });
  const password = makePassword();
  const id = uid("usr");
  run("INSERT INTO users (id, org_id, role, name, email, phone, subject, password_hash) VALUES (?,?,?,?,?,?,?,?)",
    id, req.user!.org_id, b.role, b.name, b.email.toLowerCase(), b.phone || null, b.subject || null, bcrypt.hashSync(password, 10));
  res.json({ id, email: b.email.toLowerCase(), password });
});
orgRoutes.post("/teachers/:id/reset-password", adminOnly, (req, res) => {
  const u = one<{ email: string }>("SELECT email FROM users WHERE id = ? AND org_id = ? AND role IN ('teacher','admin')", req.params.id, req.user!.org_id);
  if (!u) return res.status(404).json({ error: "Not found" });
  const password = makePassword();
  run("UPDATE users SET password_hash = ? WHERE id = ?", bcrypt.hashSync(password, 10), req.params.id);
  bumpTokenVersion(req.params.id);
  res.json({ email: u.email, password });
});
orgRoutes.delete("/teachers/:id", adminOnly, (req, res) => {
  if (req.params.id === req.user!.id) return res.status(400).json({ error: "You can't remove yourself" });
  if (!one("SELECT 1 FROM users WHERE id = ? AND org_id = ? AND role IN ('teacher','admin')", req.params.id, req.user!.org_id)) return res.status(404).json({ error: "Not found" });
  run("DELETE FROM users WHERE id = ? AND org_id = ? AND role IN ('teacher','admin')", req.params.id, req.user!.org_id);
  res.json({ ok: true });
});

// ---- Notices (students see notices for their batch + org-wide ones)
orgRoutes.get("/notices", (req, res) => {
  const u = req.user!;
  const rows = u.role === "student"
    ? all(`SELECT n.*, b.name AS batch_name FROM notices n LEFT JOIN batches b ON b.id = n.batch_id
        WHERE n.org_id = ? AND (n.batch_id IS NULL OR n.batch_id IN (SELECT batch_id FROM enrollments WHERE student_id = ?))
        ORDER BY n.created_at DESC`, u.org_id, u.id)
    : all(`SELECT n.*, b.name AS batch_name FROM notices n LEFT JOIN batches b ON b.id = n.batch_id WHERE n.org_id = ? ORDER BY n.created_at DESC`, u.org_id);
  res.json(rows);
});
orgRoutes.post("/notices", staff, (req, res) => {
  const b = z.object({ title: z.string().min(1).max(200), body: z.string().min(1).max(5000), batch_id: z.string().nullable().optional() }).parse(req.body);
  if (!inOrg("batches", b.batch_id, req.user!.org_id)) return res.status(400).json({ error: "Unknown batch" });
  run("INSERT INTO notices (id, org_id, title, body, batch_id, created_by) VALUES (?,?,?,?,?,?)",
    uid("ntc"), req.user!.org_id, b.title, b.body, b.batch_id || null, req.user!.id);
  res.json({ ok: true });
});
orgRoutes.delete("/notices/:id", staff, (req, res) => {
  run("DELETE FROM notices WHERE id = ? AND org_id = ?", req.params.id, req.user!.org_id);
  res.json({ ok: true });
});

orgRoutes.put("/organisation", adminOnly, (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(120), city: z.string().max(80).optional() }).parse(req.body);
  run("UPDATE orgs SET name = ?, city = ? WHERE id = ?", b.name, b.city ?? null, req.user!.org_id);
  res.json({ ok: true });
});

export { ClientError };
