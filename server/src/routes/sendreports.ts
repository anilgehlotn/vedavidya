// Send Reports: email each student's report card PDF to the parent (and/or the student) with Resend, and keep a
// log of every send (report_sends). WhatsApp links already exist; opening one is logged too.
import { Router } from "express";
import { z } from "zod";
import { all, one, run, uid } from "../db.js";
import { staff } from "../auth.js";
import { enqueueJob, PermanentError, registerJob } from "../lib/jobs.js";
import { emailConfigured, emailFrom, escapeHtml, looksLikeEmail, sendEmail } from "../lib/email.js";
import { loadTestReport, pdfName, studentReportPdf } from "../reports.js";
import { withSubtopics } from "./reports.js";
import { rateLimit } from "../ratelimit.js";

export const sendReportRoutes = Router();
const APP_URL = () => (process.env.APP_URL ?? "https://app.vedavidya.co").replace(/\/$/, "");
const DAILY_LIMIT = Number(process.env.REPORT_EMAILS_PER_DAY ?? 2000); // per institute
const sendLimit = rateLimit("send-reports", 30, 60 * 60 * 1000, (r) => r.user?.org_id ?? r.ip ?? "?");

const pdfBuffer = (doc: PDFKit.PDFDocument) => new Promise<Buffer>((resolve, reject) => {
  const parts: Buffer[] = [];
  doc.on("data", (c: Buffer) => parts.push(c)); doc.on("end", () => resolve(Buffer.concat(parts))); doc.on("error", reject);
  doc.end();
});

interface SendRow { id: string; org_id: string; test_id: string; attempt_id: string; to_address: string; recipient: "parent" | "student"; status: string }
registerJob<{ send_id: string }>("send_report", {
  concurrency: 3,
  run: async ({ send_id }) => {
    const s = one<SendRow>("SELECT * FROM report_sends WHERE id = ?", send_id);
    if (!s || s.status !== "queued") return;
    const t = one<{ results_published: number }>("SELECT results_published FROM tests WHERE id = ?", s.test_id);
    if (!t?.results_published) throw new PermanentError("Results were unpublished before the report was sent.");
    const r = loadTestReport(s.test_id, s.org_id);
    const st = r?.results.find((x) => x.attemptId === s.attempt_id);
    if (!r || !st) throw new PermanentError("This student's sheet isn't marked any more.");
    const pdf = await pdfBuffer(studentReportPdf(r, [s.attempt_id]));
    const token = one<{ token: string }>("SELECT token FROM share_tokens WHERE attempt_id = ?", s.attempt_id)?.token;
    const link = token ? `${APP_URL()}/report/${token}` : null;
    const staffReply = one<{ email: string | null }>("SELECT u.email FROM report_sends r JOIN users u ON u.id = r.created_by WHERE r.id = ?", send_id)?.email ?? null; // replies go to the teacher who sent it
    const first = st.name.split(" ")[0];
    const greet = s.recipient === "parent" ? `Dear parent of ${st.name},` : `Hi ${first},`;
    const lines = [
      `${s.recipient === "parent" ? `${st.name}'s` : "Your"} result for "${r.test.title}"${r.test.subject ? ` (${r.test.subject})` : ""} at ${r.org}:`,
      `Score: ${st.score} / ${st.max} (${Math.round(st.pct)}%) · Class rank ${st.rank} of ${r.results.length} · Class average ${Math.round(r.classAvg)}%`,
      "The report card is attached as a PDF. It shows marks for every question, the topics to revise and what to practise next.",
    ];
    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#17171c;line-height:1.5">
      <p>${escapeHtml(greet)}</p>${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("")}
      ${link ? `<p><a href="${escapeHtml(link)}" style="color:#e4522f;font-weight:bold">View the full report online</a></p>` : ""}
      <p style="color:#8b8b96;font-size:13px">Sent by ${escapeHtml(r.org)} using Veda Vidya. Reply to this email to contact the institute.</p></div>`;
    const text = [greet, "", ...lines, ...(link ? ["", `View online: ${link}`] : []), "", `Sent by ${r.org} using Veda Vidya.`].join("\n");
    const id = await sendEmail({ to: s.to_address, subject: `${r.test.title}: ${st.name}'s report card`, html, text, replyTo: staffReply,
      attachments: [{ filename: pdfName(r.test.title, st.roll ? `Roll_${st.roll}` : null, st.name), content: pdf }] });
    run("UPDATE report_sends SET status = 'sent', provider_id = ?, error = NULL, sent_at = CURRENT_TIMESTAMP WHERE id = ?", id, send_id);
  },
  onRetry: ({ send_id }, msg) => run("UPDATE report_sends SET error = ? WHERE id = ?", `Retrying: ${msg}`, send_id),
  onFail: ({ send_id }, msg) => run("UPDATE report_sends SET status = 'failed', error = ? WHERE id = ?", msg, send_id),
});

const testInOrg = (id: string, org: string) => one<{ id: string; title: string; results_published: number }>("SELECT id, title, results_published FROM tests WHERE id = ? AND org_id = ?", id, org);
const students = (testId: string) => all<{ attempt_id: string; name: string; roll_no: string | null; score: number | null; max_score: number | null; student_email: string | null;
  parent_email: string | null; phone: string | null; parent_phone: string | null; share_token: string | null }>(`
  SELECT a.id AS attempt_id, u.name, e.roll_no, a.score, a.max_score, u.email AS student_email, e.parent_email, u.phone, e.parent_phone,
    (SELECT token FROM share_tokens s WHERE s.attempt_id = a.id) AS share_token
  FROM attempts a JOIN users u ON u.id = a.student_id LEFT JOIN enrollments e ON e.student_id = u.id
  WHERE a.test_id = ? ORDER BY CAST(e.roll_no AS INTEGER), u.name`, testId);

/** Who can get a report, and the latest send to each of them. */
sendReportRoutes.get("/tests/:id/report-sends", staff, (req, res) => {
  const t = testInOrg(req.params.id, req.user!.org_id);
  if (!t) return res.status(404).json({ error: "Test not found" });
  const sends = all<any>(`SELECT id, attempt_id, channel, recipient, to_address, status, error, created_at, sent_at FROM report_sends WHERE test_id = ? ORDER BY created_at DESC, rowid DESC`, t.id);
  const list = students(t.id).map((s) => ({ ...s, sends: sends.filter((x) => x.attempt_id === s.attempt_id).slice(0, 5) }));
  res.json({
    configured: emailConfigured(), from: emailFrom(), published: Boolean(t.results_published), students: list,
    counts: { sent: sends.filter((x) => x.channel === "email" && x.status === "sent").length, queued: sends.filter((x) => x.status === "queued").length,
      failed: sends.filter((x) => x.status === "failed").length, whatsapp: sends.filter((x) => x.channel === "whatsapp").length },
  });
});

/** Email report cards. `to`: parent (default), student or both. Already-sent reports (last 24 hours) are skipped unless `resend`. */
sendReportRoutes.post("/tests/:id/send-reports", staff, sendLimit, async (req, res, next) => {
  try {
    const b = z.object({ attempt_ids: z.array(z.string().max(60)).max(2000).optional(), to: z.enum(["parent", "student", "both"]).default("parent"), resend: z.boolean().optional() }).parse(req.body ?? {});
    const org = req.user!.org_id;
    const t = testInOrg(req.params.id, org);
    if (!t) return res.status(404).json({ error: "Test not found" });
    if (!t.results_published) return res.status(400).json({ error: "Publish the results first. Reports are sent for published results only." });
    if (!emailConfigured()) return res.status(400).json({ error: "Email isn't set up yet. Ask the Veda Vidya team to turn it on, or use the WhatsApp links for now." });
    const today = one<{ n: number }>("SELECT count(*) n FROM report_sends WHERE org_id = ? AND channel = 'email' AND created_at >= datetime('now', '-1 day')", org)!.n;
    await withSubtopics(t.id);
    const skipped: { name: string; reason: string }[] = [];
    const toSend: { attempt_id: string; recipient: "parent" | "student"; to: string }[] = [];
    for (const s of students(t.id).filter((x) => !b.attempt_ids || b.attempt_ids.includes(x.attempt_id))) {
      if (s.score == null) { skipped.push({ name: s.name, reason: "not marked yet" }); continue; }
      const targets: ["parent" | "student", string | null][] = b.to === "both" ? [["parent", s.parent_email], ["student", s.student_email]] : [[b.to, b.to === "parent" ? s.parent_email : s.student_email]];
      for (const [who, addr] of targets) {
        if (!looksLikeEmail(addr)) { skipped.push({ name: s.name, reason: `no ${who} email` }); continue; }
        const recent = !b.resend && one("SELECT 1 FROM report_sends WHERE attempt_id = ? AND channel = 'email' AND lower(to_address) = lower(?) AND status IN ('queued','sent') AND created_at >= datetime('now', '-1 day')", s.attempt_id, addr.trim());
        if (recent) { skipped.push({ name: s.name, reason: `already sent to the ${who} today` }); continue; }
        toSend.push({ attempt_id: s.attempt_id, recipient: who, to: addr.trim() });
      }
    }
    if (today + toSend.length > DAILY_LIMIT) return res.status(429).json({ error: `That would pass today's limit of ${DAILY_LIMIT} emails for your institute. Try again tomorrow.` });
    for (const x of toSend) {
      const id = uid("snd");
      run("INSERT INTO report_sends (id, org_id, test_id, attempt_id, channel, recipient, to_address, created_by) VALUES (?,?,?,?, 'email', ?, ?, ?)", id, org, t.id, x.attempt_id, x.recipient, x.to, req.user!.id);
      enqueueJob("send_report", { send_id: id }, { orgId: org, dedupeKey: `send:${id}` });
    }
    res.json({ queued: toSend.length, skipped });
  } catch (e) { next(e); }
});

/** Logs a WhatsApp report link being opened by a teacher (the message itself is sent from their phone). */
sendReportRoutes.post("/tests/:id/report-sends/whatsapp", staff, (req, res) => {
  const b = z.object({ attempt_id: z.string().max(60), to: z.string().max(40).default(""), recipient: z.enum(["parent", "student"]).default("parent") }).parse(req.body);
  const t = testInOrg(req.params.id, req.user!.org_id);
  if (!t || !one("SELECT 1 FROM attempts WHERE id = ? AND test_id = ?", b.attempt_id, t.id)) return res.status(404).json({ error: "Not found" });
  run("INSERT INTO report_sends (id, org_id, test_id, attempt_id, channel, recipient, to_address, status, created_by, sent_at) VALUES (?,?,?,?, 'whatsapp', ?, ?, 'opened', ?, CURRENT_TIMESTAMP)",
    uid("snd"), req.user!.org_id, t.id, b.attempt_id, b.recipient, b.to || "-", req.user!.id);
  res.json({ ok: true });
});
