// Institute structure: centres, batches, people, notices, and the overview dashboard.
import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { z } from "zod";
import { all, db, one, run, uid, bumpTokenVersion } from "../db.js";
import { storage } from "../lib/storage.js";
import { deleteDocuments } from "../lib/documents.js";
import { studentDocuments, studentFiles } from "./tests.js";

class ClientError extends Error { constructor(msg: string, public status = 400) { super(msg); } }
const inOrg = (table: "batches" | "centres" | "users", id: string | null | undefined, org: string) =>
  !id || Boolean(one(`SELECT 1 FROM ${table} WHERE id = ? AND org_id = ?`, id, org));
import { adminOnly, staff } from "../auth.js";

export const orgRoutes = Router();

/**
 * Home dashboard. Optional filters: ?centre_id= and ?course_id= (they narrow students, batches and tests to those batches).
 * Each stat has a "new in the last 30 days" count.
 */
orgRoutes.get("/overview", staff, (req, res) => {
  const org = req.user!.org_id;
  const q = z.object({ centre_id: z.string().max(60).optional(), course_id: z.string().max(60).optional() }).parse(req.query);
  // The batches in view (all when no filter).
  const batchWhere = `b.org_id = ?${q.centre_id ? " AND b.centre_id = ?" : ""}${q.course_id ? " AND b.course_id = ?" : ""}`;
  const bArgs = [org, ...(q.centre_id ? [q.centre_id] : []), ...(q.course_id ? [q.course_id] : [])];
  const filtered = Boolean(q.centre_id || q.course_id);
  const since = "datetime('now', '-30 days')";
  const pair = (sql: string, args: unknown[]) => {
    const r = one<{ n: number; recent: number }>(sql, ...args);
    return { total: r?.n ?? 0, new_30d: r?.recent ?? 0 };
  };
  const studentsIn = filtered
    ? `SELECT count(DISTINCT u.id) n, count(DISTINCT CASE WHEN u.created_at >= ${since} THEN u.id END) recent
         FROM users u JOIN enrollments e ON e.student_id = u.id JOIN batches b ON b.id = e.batch_id WHERE ${batchWhere}`
    : `SELECT count(*) n, sum(created_at >= ${since}) recent FROM users WHERE org_id = ? AND role = 'student'`;
  const cards = {
    students: pair(studentsIn, bArgs),
    teachers: filtered
      ? pair(`SELECT count(DISTINCT u.id) n, count(DISTINCT CASE WHEN u.created_at >= ${since} THEN u.id END) recent
           FROM users u JOIN batches b ON b.teacher_id = u.id WHERE ${batchWhere}`, bArgs)
      : pair(`SELECT count(*) n, sum(created_at >= ${since}) recent FROM users WHERE org_id = ? AND role IN ('teacher','admin')`, [org]),
    batches: pair(`SELECT count(*) n, sum(b.created_at >= ${since}) recent FROM batches b WHERE ${batchWhere}`, bArgs),
    tests: filtered
      ? pair(`SELECT count(DISTINCT t.id) n, count(DISTINCT CASE WHEN t.created_at >= ${since} THEN t.id END) recent
           FROM tests t JOIN test_batches tb ON tb.test_id = t.id JOIN batches b ON b.id = tb.batch_id WHERE ${batchWhere}`, bArgs)
      : pair(`SELECT count(*) n, sum(created_at >= ${since}) recent FROM tests WHERE org_id = ?`, [org]),
  };
  const count = (sql: string) => (one<{ n: number }>(sql, org)?.n ?? 0);
  const stats = {
    students: cards.students.total, teachers: cards.teachers.total, batches: cards.batches.total, tests: cards.tests.total,
    centres: count("SELECT count(*) n FROM centres WHERE org_id = ?"),
    papers: count("SELECT count(*) n FROM question_papers WHERE org_id = ?"),
    sheets_evaluated: count("SELECT count(*) n FROM attempts a JOIN tests t ON t.id = a.test_id WHERE t.org_id = ? AND a.status = 'evaluated'"),
  };
  // Students per batch, grouped by course (for the chart).
  const batches = all<{ id: string; name: string; course_id: string | null; course_name: string | null; centre_name: string | null; students: number; avg_pct: number | null }>(`
    SELECT b.id, b.name, b.course_id, co.name AS course_name, c.name AS centre_name,
      (SELECT count(*) FROM enrollments e WHERE e.batch_id = b.id) AS students,
      (SELECT avg(a.score * 100.0 / a.max_score) FROM enrollments e JOIN attempts a ON a.student_id = e.student_id
        WHERE e.batch_id = b.id AND a.score IS NOT NULL AND a.max_score > 0) AS avg_pct
    FROM batches b LEFT JOIN courses co ON co.id = b.course_id LEFT JOIN centres c ON c.id = b.centre_id
    WHERE ${batchWhere} ORDER BY co.name, b.name`, ...bArgs);
  const byCourse = new Map<string, { id: string | null; name: string; batches: typeof batches }>();
  for (const b of batches) {
    const k = b.course_id ?? "";
    if (!byCourse.has(k)) byCourse.set(k, { id: b.course_id, name: b.course_name ?? "No course", batches: [] });
    byCourse.get(k)!.batches.push(b);
  }
  const recentStudents = all(`SELECT u.id, u.name, u.created_at, e.roll_no, b.name AS batch_name, co.name AS course_name
    FROM users u JOIN enrollments e ON e.student_id = u.id JOIN batches b ON b.id = e.batch_id LEFT JOIN courses co ON co.id = b.course_id
    WHERE ${batchWhere} AND u.role = 'student' ORDER BY u.created_at DESC, u.name LIMIT 8`, ...bArgs);
  const testScope = filtered ? `AND t.id IN (SELECT tb.test_id FROM test_batches tb JOIN batches b ON b.id = tb.batch_id WHERE ${batchWhere})` : "";
  const recentTests = all(`
    SELECT t.id, t.title, t.mode, t.scheduled_at, t.results_published,
      (SELECT count(*) FROM attempts a WHERE a.test_id = t.id) AS candidates,
      (SELECT count(*) FROM attempts a WHERE a.test_id = t.id AND a.status = 'evaluated') AS evaluated,
      (SELECT avg(a.score * 100.0 / a.max_score) FROM attempts a WHERE a.test_id = t.id AND a.score IS NOT NULL AND a.max_score > 0) AS avg_pct
    FROM tests t WHERE t.org_id = ? ${testScope} ORDER BY coalesce(t.scheduled_at, t.created_at) DESC LIMIT 8`, org, ...(filtered ? bArgs : []));
  const batchPerf = batches.map((b) => ({ id: b.id, name: b.name, attempts: 0, avg_pct: b.avg_pct }));
  res.json({ stats, cards, courses: [...byCourse.values()], recentStudents, recentTests, batchPerf });
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
  res.json(all(`SELECT b.*, c.name AS centre_name, u.name AS teacher_name, co.name AS course_name,
      (SELECT count(*) FROM enrollments e WHERE e.batch_id = b.id) AS student_count,
      (SELECT count(*) FROM test_batches tb WHERE tb.batch_id = b.id) AS test_count,
      (SELECT round(avg(a.score * 100.0 / a.max_score)) FROM enrollments e JOIN attempts a ON a.student_id = e.student_id
        JOIN test_batches tb ON tb.test_id = a.test_id AND tb.batch_id = b.id
        WHERE e.batch_id = b.id AND a.score IS NOT NULL AND a.max_score > 0) AS avg_pct
    FROM batches b LEFT JOIN centres c ON c.id = b.centre_id LEFT JOIN users u ON u.id = b.teacher_id LEFT JOIN courses co ON co.id = b.course_id
    WHERE b.org_id = ? ORDER BY c.name, b.name`, req.user!.org_id));
});
const BatchBody = z.object({
  name: z.string().trim().min(1).max(100), course: z.string().trim().max(100).optional(), course_id: z.string().max(60).nullable().optional(),
  centre_id: z.string().max(40).nullable().optional(), teacher_id: z.string().max(40).nullable().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-06-01").nullable().optional(),
});
const checkBatchRefs = (b: z.infer<typeof BatchBody>, org: string) => {
  if (!inOrg("centres", b.centre_id, org)) throw new ClientError("Unknown centre");
  if (b.course_id && !one("SELECT 1 FROM courses WHERE id = ? AND org_id = ?", b.course_id, org)) throw new ClientError("Unknown course");
  if (b.teacher_id && !one("SELECT 1 FROM users WHERE id = ? AND org_id = ? AND role IN ('admin','teacher')", b.teacher_id, org)) throw new ClientError("Unknown teacher");
};
/** The batch's course: by id, or by name (an older client sending a course name gets a matching course, created if needed). */
function resolveCourse(b: z.infer<typeof BatchBody>, org: string): { id: string | null; name: string | null } {
  if (b.course_id) return { id: b.course_id, name: one<{ name: string }>("SELECT name FROM courses WHERE id = ?", b.course_id)!.name };
  if (!b.course) return { id: null, name: null };
  const id = findOrCreateCourse(org, b.course);
  return { id, name: one<{ name: string }>("SELECT name FROM courses WHERE id = ?", id)!.name }; // the course's own spelling
}
export function findOrCreateCourse(org: string, name: string) {
  const existing = one<{ id: string }>("SELECT id FROM courses WHERE org_id = ? AND name = ? COLLATE NOCASE", org, name.trim());
  if (existing) return existing.id;
  const id = uid("crs");
  run("INSERT INTO courses (id, org_id, name) VALUES (?,?,?)", id, org, name.trim());
  return id;
}
orgRoutes.post("/batches", adminOnly, (req, res) => {
  const b = BatchBody.parse(req.body);
  checkBatchRefs(b, req.user!.org_id);
  const c = resolveCourse(b, req.user!.org_id);
  const id = uid("bat");
  run("INSERT INTO batches (id, org_id, centre_id, name, course, course_id, teacher_id, start_date) VALUES (?,?,?,?,?,?,?,?)",
    id, req.user!.org_id, b.centre_id || null, b.name, c.name, c.id, b.teacher_id || null, b.start_date ?? null);
  res.json({ id });
});
orgRoutes.put("/batches/:id", adminOnly, (req, res) => {
  const b = BatchBody.parse(req.body);
  checkBatchRefs(b, req.user!.org_id);
  const c = resolveCourse(b, req.user!.org_id);
  run("UPDATE batches SET name = ?, course = ?, course_id = ?, centre_id = ?, teacher_id = ?, start_date = coalesce(?, start_date) WHERE id = ? AND org_id = ?",
    b.name, c.name, c.id, b.centre_id || null, b.teacher_id || null, b.start_date ?? null, req.params.id, req.user!.org_id);
  res.json({ ok: true });
});

// ---- Courses (e.g. "10th CBSE", "II PUC Karnataka Board") and their subjects ----
orgRoutes.get("/courses", staff, (req, res) => {
  const org = req.user!.org_id;
  const courses = all<any>(`SELECT c.*, (SELECT count(*) FROM batches b WHERE b.course_id = c.id) AS batches,
      (SELECT count(DISTINCT e.student_id) FROM batches b JOIN enrollments e ON e.batch_id = b.id WHERE b.course_id = c.id) AS students
    FROM courses c WHERE c.org_id = ? ORDER BY c.name`, org);
  const subjects = all<any>("SELECT id, course_id, name FROM subjects WHERE org_id = ? ORDER BY name", org);
  res.json(courses.map((c) => ({ ...c, subjects: subjects.filter((s) => s.course_id === c.id) })));
});
const CourseBody = z.object({ name: z.string().trim().min(1).max(100), board: z.string().trim().max(80).nullable().optional() });
/** Names are compared ignoring case and extra spaces, so "10th CBSE" and "10th cbse" can't both exist. */
const courseTaken = (org: string, name: string, exceptId = "") =>
  one("SELECT 1 FROM courses WHERE org_id = ? AND lower(trim(name)) = lower(?) AND id != ?", org, name, exceptId);
const subjectTaken = (courseId: string, name: string, exceptId = "") =>
  one("SELECT 1 FROM subjects WHERE course_id = ? AND lower(trim(name)) = lower(?) AND id != ?", courseId, name, exceptId);
orgRoutes.post("/courses", adminOnly, (req, res) => {
  const b = CourseBody.parse(req.body);
  if (courseTaken(req.user!.org_id, b.name)) return res.status(409).json({ error: `A course called "${b.name}" already exists.` });
  const id = uid("crs");
  run("INSERT INTO courses (id, org_id, name, board) VALUES (?,?,?,?)", id, req.user!.org_id, b.name, b.board ?? null);
  res.json({ id });
});
orgRoutes.put("/courses/:id", adminOnly, (req, res) => {
  const b = CourseBody.parse(req.body);
  if (courseTaken(req.user!.org_id, b.name, req.params.id)) return res.status(409).json({ error: `A course called "${b.name}" already exists.` });
  const r = run("UPDATE courses SET name = ?, board = ? WHERE id = ? AND org_id = ?", b.name, b.board ?? null, req.params.id, req.user!.org_id);
  if (!r.changes) return res.status(404).json({ error: "Course not found" });
  run("UPDATE batches SET course = ? WHERE course_id = ?", b.name, req.params.id); // keep the old text column in step
  res.json({ ok: true });
});
orgRoutes.delete("/courses/:id", adminOnly, (req, res) => {
  const used = one<{ n: number }>("SELECT count(*) n FROM batches WHERE course_id = ? AND org_id = ?", req.params.id, req.user!.org_id)!.n;
  if (used) return res.status(409).json({ error: `${used} batch${used > 1 ? "es use" : " uses"} this course. Move ${used > 1 ? "them" : "it"} to another course first.` });
  const r = run("DELETE FROM courses WHERE id = ? AND org_id = ?", req.params.id, req.user!.org_id);
  if (!r.changes) return res.status(404).json({ error: "Course not found" });
  res.json({ ok: true });
});
orgRoutes.post("/courses/:id/subjects", adminOnly, (req, res) => {
  const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
  if (!one("SELECT 1 FROM courses WHERE id = ? AND org_id = ?", req.params.id, req.user!.org_id)) return res.status(404).json({ error: "Course not found" });
  if (subjectTaken(req.params.id, name)) return res.status(409).json({ error: `This course already has the subject "${name}".` });
  const id = uid("sub");
  run("INSERT INTO subjects (id, org_id, course_id, name) VALUES (?,?,?,?)", id, req.user!.org_id, req.params.id, name);
  res.json({ id });
});
orgRoutes.put("/subjects/:id", adminOnly, (req, res) => {
  const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
  const cur = one<{ course_id: string }>("SELECT course_id FROM subjects WHERE id = ? AND org_id = ?", req.params.id, req.user!.org_id);
  if (cur && subjectTaken(cur.course_id, name, req.params.id)) return res.status(409).json({ error: `This course already has the subject "${name}".` });
  const r = run("UPDATE subjects SET name = ? WHERE id = ? AND org_id = ?", name, req.params.id, req.user!.org_id);
  if (!r.changes) return res.status(404).json({ error: "Subject not found" });
  res.json({ ok: true });
});
orgRoutes.delete("/subjects/:id", adminOnly, (req, res) => {
  // Papers and tests keep working: their subject link is cleared (their subject text stays).
  const r = run("DELETE FROM subjects WHERE id = ? AND org_id = ?", req.params.id, req.user!.org_id);
  if (!r.changes) return res.status(404).json({ error: "Subject not found" });
  res.json({ ok: true });
});
/**
 * Moves students to another batch (all of them, or `student_ids`). A student whose roll number is already used
 * in the new batch keeps no roll number there; the reply lists them so the teacher can set new ones.
 */
orgRoutes.post("/batches/:id/transfer", staff, (req, res) => {
  const org = req.user!.org_id;
  const b = z.object({ to_batch_id: z.string().max(60), student_ids: z.array(z.string().max(60)).max(5000).optional() }).parse(req.body);
  if (!one("SELECT 1 FROM batches WHERE id = ? AND org_id = ?", req.params.id, org)) return res.status(404).json({ error: "Batch not found" });
  if (!one("SELECT 1 FROM batches WHERE id = ? AND org_id = ?", b.to_batch_id, org)) return res.status(400).json({ error: "Pick a batch from your institute to move them to" });
  if (b.to_batch_id === req.params.id) return res.status(400).json({ error: "Pick a different batch" });
  const rows = all<{ student_id: string; roll_no: string | null; name: string }>(`SELECT e.student_id, e.roll_no, u.name FROM enrollments e JOIN users u ON u.id = e.student_id
    WHERE e.batch_id = ?`, req.params.id).filter((r) => !b.student_ids || b.student_ids.includes(r.student_id));
  if (!rows.length) return res.status(400).json({ error: "No students to move" });
  const rollCleared: string[] = [];
  db.exec("BEGIN");
  try {
    for (const r of rows) {
      const clash = r.roll_no && one("SELECT 1 FROM enrollments WHERE batch_id = ? AND roll_no = ? AND student_id != ?", b.to_batch_id, r.roll_no, r.student_id);
      if (clash) rollCleared.push(r.name);
      run("UPDATE enrollments SET batch_id = ?, roll_no = ? WHERE student_id = ? AND batch_id = ?", b.to_batch_id, clash ? null : r.roll_no, r.student_id, req.params.id);
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  res.json({ moved: rows.length, roll_cleared: rollCleared });
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
