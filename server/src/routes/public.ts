import { loadTestReport, pdfName, studentReportPdf } from "../reports.js";
import { sendPdf, withSubtopics } from "./reports.js";
import { pageTypes, paperForViewer, withD6 } from "./tests.js";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { one, run, uid, json, all, bumpTokenVersion } from "../db.js";
import { storage } from "../lib/storage.js";
import { isSuperAdmin } from "./admin.js";
import { CHUNK_BYTES, LIMITS, MAX_IMAGE_BYTES } from "../lib/limits.js";
import { requireAuth, signToken, type AuthUser } from "../auth.js";
import { rateLimit } from "../ratelimit.js";
import { createStudent } from "./org.js";

export const publicRoutes = Router();

const ALLOW_SIGNUP = process.env.ALLOW_SIGNUP !== "false";
const loginLimit = rateLimit("login", 10, 5 * 60 * 1000, (r) => `${r.ip}:${String(r.body?.identifier ?? "").toLowerCase()}`);
// A whole class on one school Wi-Fi shares an IP, so the per-network limit is generous; per-account guessing stays tight.
const loginIpLimit = rateLimit("login-ip", 600, 15 * 60 * 1000);
// Locks an account after repeated failures no matter which networks they come from.
const accountLimit = rateLimit("login-account", 20, 15 * 60 * 1000, (r) => String(r.body?.identifier ?? "").trim().toLowerCase());
const passwordLimit = rateLimit("change-password", 10, 15 * 60 * 1000, (r) => r.user?.id ?? r.ip ?? "?");
// A fixed hash so a missing account costs the same time as a wrong password (no account discovery by timing).
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);
const signupLimit = rateLimit("signup", 5, 60 * 60 * 1000);
const contactLimit = rateLimit("contact", 5, 10 * 60 * 1000);

publicRoutes.get("/config", (_req, res) => {
  const demo = Boolean(one("SELECT 1 FROM users WHERE email = 'admin@demo.school'"));
  res.json({ signup: ALLOW_SIGNUP, demo, upload: { limits: LIMITS, max_image_bytes: MAX_IMAGE_BYTES, chunk_bytes: CHUNK_BYTES } });
});


publicRoutes.post("/auth/login", loginIpLimit, accountLimit, loginLimit, async (req, res, next) => {
  try {
    const { identifier, password } = z.object({ identifier: z.string().min(1).max(200), password: z.string().min(1).max(200) }).parse(req.body);
    const id = identifier.trim().toLowerCase();
    type Row = AuthUser & { password_hash: string };
    const cols = "id, org_id, role, name, email, password_hash";
    let user = one<Row>(`SELECT ${cols} FROM users WHERE lower(email) = ? OR lower(username) = ?`, id, id);
    if (!user && /^\+?[\d\s-]{6,20}$/.test(identifier.trim())) {
      // Phone login only when exactly one account uses that number (siblings may share a phone).
      const byPhone = all<Row>(`SELECT ${cols} FROM users WHERE phone = ? LIMIT 2`, identifier.trim());
      if (byPhone.length > 1) { await bcrypt.compare(password, DUMMY_HASH); return res.status(401).json({ error: "More than one account uses this phone number. Sign in with your username instead." }); }
      user = byPhone[0];
    }
    // Async compare keeps the server responsive while a whole class signs in at once.
    const valid = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !valid) return res.status(401).json({ error: "Wrong email/username or password" });
    const { password_hash: _, ...safe } = user;
    res.json({ token: signToken(safe), user: safe });
  } catch (e) { next(e); }
});

// Self-serve signup: creates an institute and its first admin.
publicRoutes.post("/auth/register", signupLimit, (req, res) => {
  if (!ALLOW_SIGNUP) return res.status(403).json({ error: "New institutes are created by invitation. Please book a demo." });
  const body = z.object({
    institute: z.string().min(2).max(120), city: z.string().max(80).optional(),
    name: z.string().min(2).max(80), email: z.string().email().max(200), password: z.string().min(8).max(200),
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

// ---- Joining a batch from an invite link (no login) ----
const joinLimit = rateLimit("invite-join", 200, 60 * 60 * 1000); // a whole class may join from one school Wi-Fi
type Invite = { id: string; org_id: string; batch_id: string; expires_at: string; max_uses: number | null; uses: number; revoked: number; institute: string; batch: string; is_demo: number };
function liveInvite(token: string): { invite?: Invite; problem?: [number, string] } {
  const invite = one<Invite>(`SELECT i.*, o.name AS institute, b.name AS batch, o.is_demo FROM invite_links i JOIN orgs o ON o.id = i.org_id JOIN batches b ON b.id = i.batch_id
    WHERE i.token = ?`, token);
  if (!invite || invite.revoked) return { problem: [404, "This invite link isn't valid. Ask your teacher for a new one."] };
  if (Date.parse(invite.expires_at) < Date.now()) return { problem: [410, "This invite link has expired. Ask your teacher for a new one."] };
  if (invite.max_uses != null && invite.uses >= invite.max_uses) return { problem: [410, "This invite link has been used the maximum number of times. Ask your teacher for a new one."] };
  if (invite.is_demo) return { problem: [403, "The demo institute can't take new students."] };
  return { invite };
}
publicRoutes.get("/public/invite/:token", (req, res) => {
  const { invite, problem } = liveInvite(req.params.token);
  if (!invite) return res.status(problem![0]).json({ error: problem![1] });
  res.json({ institute: invite.institute, batch: invite.batch, expires_at: invite.expires_at });
});
publicRoutes.post("/public/invite/:token/join", joinLimit, (req, res) => {
  const { invite, problem } = liveInvite(req.params.token);
  if (!invite) return res.status(problem![0]).json({ error: problem![1] });
  const b = z.object({
    name: z.string().trim().min(2, "Enter your full name").max(100), roll_no: z.string().trim().max(20).optional(),
    phone: z.string().trim().max(20).optional(), email: z.string().trim().email("Enter a valid email").max(200).optional().or(z.literal("")),
    parent_phone: z.string().trim().max(20).optional(), password: z.string().min(8, "Choose a password of at least 8 characters").max(200),
  }).parse(req.body);
  // Count the use first (atomically), so two people can't both take the last place.
  const took = run("UPDATE invite_links SET uses = uses + 1 WHERE id = ? AND (max_uses IS NULL OR uses < max_uses)", invite.id);
  if (!took.changes) return res.status(410).json({ error: "This invite link has been used the maximum number of times. Ask your teacher for a new one." });
  let s;
  try { s = createStudent(invite.org_id, { name: b.name, roll_no: b.roll_no || undefined, phone: b.phone || undefined, email: b.email || "", parent_phone: b.parent_phone || undefined, batch_id: invite.batch_id }); }
  catch (e) { run("UPDATE invite_links SET uses = uses - 1 WHERE id = ?", invite.id); return res.status((e as { status?: number }).status ?? 400).json({ error: (e as Error).message }); }
  run("UPDATE users SET password_hash = ? WHERE id = ?", bcrypt.hashSync(b.password, 10), s.id);
  const user: AuthUser = { id: s.id, org_id: invite.org_id, role: "student", name: s.name, email: b.email ? b.email.toLowerCase() : null };
  res.json({ token: signToken(user), username: s.username, institute: invite.institute, batch: invite.batch });
});

publicRoutes.get("/me", requireAuth, (req, res) => {
  const o = one<{ id: string; name: string; city: string | null; is_demo: number; own_key: number }>(
    "SELECT id, name, city, is_demo, claude_key_enc IS NOT NULL AS own_key FROM orgs WHERE id = ?", req.user!.org_id);
  // plan: shown as a badge under the avatar. "demo" (public demo), "own_key" (institute pays Anthropic), "credits" (Veda Vidya AI).
  const org = o && { id: o.id, name: o.name, city: o.city, is_demo: o.is_demo, plan: o.is_demo ? "demo" : o.own_key ? "own_key" : "credits" };
  res.json({ user: { ...req.user, is_super_admin: isSuperAdmin(req.user!.id) }, org });
});

publicRoutes.post("/auth/change-password", requireAuth, passwordLimit, async (req, res, next) => {
  try {
    if (req.user!.is_demo) return res.status(403).json({ error: "The demo institute is read-only." });
    const { current, next: nextPw } = z.object({ current: z.string().max(200), next: z.string().min(8).max(200) }).parse(req.body);
    if (current === nextPw) return res.status(400).json({ error: "Choose a different password" });
    const u = one<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", req.user!.id)!;
    if (!(await bcrypt.compare(current, u.password_hash))) return res.status(400).json({ error: "Current password is wrong" });
    run("UPDATE users SET password_hash = ? WHERE id = ?", await bcrypt.hash(nextPw, 10), req.user!.id);
    bumpTokenVersion(req.user!.id); // signs out other devices
    res.json({ ok: true, token: signToken(req.user!) });
  } catch (e) { next(e); }
});

publicRoutes.post("/contact", contactLimit, (req, res) => {
  const b = z.object({
    first_name: z.string().min(1).max(80), last_name: z.string().min(1).max(80), phone: z.string().min(6).max(30),
    institute: z.string().min(1).max(150), students: z.string().min(1).max(40),
    email: z.string().email().max(200).optional().or(z.literal("")), message: z.string().max(3000).optional(),
  }).parse(req.body);
  run("INSERT INTO leads (id, first_name, last_name, phone, institute, students, email, message) VALUES (?,?,?,?,?,?,?,?)",
    uid("lead"), b.first_name, b.last_name, b.phone, b.institute, b.students, b.email || null, b.message ?? null);
  res.json({ ok: true });
});

// Public report card shared with parents by link.
publicRoutes.get("/public/report/:token", (req, res) => {
  const row = one<any>(`
    SELECT a.*, t.title AS test_title, t.results_published, u.name AS student_name, o.name AS org_name,
           p.sections, coalesce(nullif(trim(t.subject),''), p.subject) AS subject, p.total_marks
    FROM share_tokens s JOIN attempts a ON a.id = s.attempt_id JOIN tests t ON t.id = a.test_id
    JOIN users u ON u.id = a.student_id JOIN orgs o ON o.id = t.org_id JOIN question_papers p ON p.id = t.paper_id
    WHERE s.token = ?`, req.params.token);
  if (!row || !row.results_published) return res.status(404).json({ error: "This report is not available" });
  const rank = all<{ student_id: string }>("SELECT student_id FROM attempts WHERE test_id = ? AND score IS NOT NULL ORDER BY score DESC", row.test_id)
    .findIndex((r) => r.student_id === row.student_id) + 1;
  res.json({
    org_name: row.org_name, student_name: row.student_name, test_title: row.test_title, subject: row.subject,
    score: row.score, max_score: row.max_score, rank, evaluation: withD6(json<{ questions: unknown[] } | null>(row.evaluation, null)),
    files: json<string[]>(row.files, []).length, page_types: pageTypes(row.files),
    // Questions with the student's marks; answers and solutions only once no other unpublished test uses this paper.
    sections: paperForViewer(row.test_id)?.sections ?? [], answers_hidden: paperForViewer(row.test_id)?.answers_hidden ?? true,
  });
});

// A page of the shared answer sheet, for the parent's report link.
publicRoutes.get("/public/report/:token/files/:n", (req, res) => {
  const row = one<any>(`SELECT a.files, t.results_published FROM share_tokens s JOIN attempts a ON a.id = s.attempt_id JOIN tests t ON t.id = a.test_id WHERE s.token = ?`, req.params.token);
  const name = row?.results_published ? json<string[]>(row.files, [])[Number(req.params.n)] : null;
  if (!name) return res.status(404).end();
  storage.send(res, name);
});

// The same report as a PDF, for parents who open the shared link.
publicRoutes.get("/public/report/:token/pdf", (req, res, next) => { (async () => {
  const row = one<any>(`SELECT a.id, a.test_id, t.org_id, t.results_published FROM share_tokens s JOIN attempts a ON a.id = s.attempt_id
    JOIN tests t ON t.id = a.test_id WHERE s.token = ?`, req.params.token);
  if (!row || !row.results_published) return res.status(404).json({ error: "This report is not available" });
  await withSubtopics(row.test_id);
  const r = loadTestReport(row.test_id, row.org_id);
  const s = r?.results.find((x) => x.attemptId === row.id);
  if (!r || !s) return res.status(404).json({ error: "This report is not available" });
  sendPdf(res, studentReportPdf(r, [row.id]), pdfName(r.test.title, s.name));
})().catch(next); });
