// PDF downloads: a student's report card, all students' report cards in one file, and the class report.
import { Router, type Response } from "express";
import { one } from "../db.js";
import { staff } from "../auth.js";
import { classReportPdf, loadTestReport, pdfName, studentReportPdf } from "../reports.js";

export const reportRoutes = Router();

export function sendPdf(res: Response, doc: PDFKit.PDFDocument, filename: string) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "private, no-store");
  doc.pipe(res);
  doc.end();
}

/** One student's report card. Staff of the institute any time; the student once results are published. */
reportRoutes.get("/attempts/:id/report.pdf", (req, res) => {
  const u = req.user!;
  const a = one<any>("SELECT a.id, a.student_id, a.test_id, t.org_id, t.results_published FROM attempts a JOIN tests t ON t.id = a.test_id WHERE a.id = ?", req.params.id);
  if (!a || a.org_id !== u.org_id) return res.status(404).json({ error: "Not found" });
  if (u.role === "student" && (a.student_id !== u.id || !a.results_published)) return res.status(403).json({ error: "Results not published yet" });
  const r = loadTestReport(a.test_id, u.org_id)!;
  const s = r.results.find((x) => x.attemptId === a.id);
  if (!s) return res.status(400).json({ error: "This answer sheet hasn't been marked yet" });
  sendPdf(res, studentReportPdf(r, [a.id]), pdfName(r.test.title, s.roll ? `Roll_${s.roll}` : null, s.name));
});

/** Every marked student's report card in one PDF (one student per section), for printing or sharing. */
reportRoutes.get("/tests/:id/reports.pdf", staff, (req, res) => {
  const r = loadTestReport(req.params.id, req.user!.org_id);
  if (!r) return res.status(404).json({ error: "Test not found" });
  if (!r.results.length) return res.status(400).json({ error: "No answer sheets have been marked yet" });
  sendPdf(res, studentReportPdf(r, r.results.map((s) => s.attemptId)), pdfName(r.test.title, "student_reports"));
});

/** The class report for teachers: weak topics, who needs help, question analysis, every student at a glance. */
reportRoutes.get("/tests/:id/class-report.pdf", staff, (req, res) => {
  const r = loadTestReport(req.params.id, req.user!.org_id);
  if (!r) return res.status(404).json({ error: "Test not found" });
  if (!r.results.length) return res.status(400).json({ error: "No answer sheets have been marked yet" });
  sendPdf(res, classReportPdf(r), pdfName(r.test.title, "class_report"));
});
