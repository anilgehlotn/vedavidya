// Resumable uploads: the browser sends a file in 5 MB pieces, so big scans survive slow or flaky
// connections (each piece can be retried, and an interrupted upload resumes from the last piece received).
//   POST   /uploads              {filename, size, purpose}  → {id, chunk_bytes, received}
//   PUT    /uploads/:id?offset=N  raw bytes                 → {received}   (409 + received if out of step)
//   GET    /uploads/:id                                      → {received, size, status}
//   POST   /uploads/:id/complete                             → {id, kind, pages}  (file checked here)
//   DELETE /uploads/:id                                      → cancels and deletes the partial file
import express, { Router } from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { wrap } from "../lib/http.js";
import { DATA_DIR, one, run, uid } from "../db.js";
import { staff } from "../auth.js";
import { CHUNK_BYTES, kindOf, LIMITS, MAX_IMAGE_BYTES, type UploadPurpose } from "../lib/limits.js";
import { FileProblem, normaliseImage, pdfPages, sniff } from "../lib/files.js";
import { rateLimit } from "../ratelimit.js";

export const uploadRoutes = Router();
export const PART_DIR = path.join(DATA_DIR, "tmp", "uploads");
fs.mkdirSync(PART_DIR, { recursive: true });
export const partPath = (id: string) => path.join(PART_DIR, `${id}.part`);

const mb = (n: number) => `${Math.round(n / 1048576)} MB`;
const startLimit = rateLimit("upload-start", 2000, 60 * 60 * 1000, (r) => r.user?.org_id ?? r.ip ?? "?");

export interface UploadSession { id: string; org_id: string; user_id: string; purpose: UploadPurpose; filename: string; kind: "pdf" | "image" | "zip"; size: number; received: number; pages: number | null; status: string }
const mine = (id: string, user: { id: string; org_id: string }) =>
  one<UploadSession>("SELECT * FROM upload_sessions WHERE id = ? AND org_id = ? AND user_id = ?", id, user.org_id, user.id);

uploadRoutes.post("/uploads", staff, startLimit, (req, res) => {
  const b = z.object({ filename: z.string().trim().min(1).max(200), size: z.number().int().min(1), purpose: z.enum(["paper", "answer_key", "class_sheets", "student_sheet"]) }).parse(req.body);
  const lim = LIMITS[b.purpose];
  const kind = kindOf(b.filename);
  if (!kind || !lim.kinds.includes(kind))
    return res.status(400).json({ error: `"${b.filename}" isn't a supported file. For the ${lim.label}, upload ${lim.kinds.map((k) => (k === "image" ? "JPG/PNG/WEBP photos" : k.toUpperCase())).join(" or ")}.` });
  const max = kind === "image" ? Math.min(MAX_IMAGE_BYTES, lim.maxBytes) : lim.maxBytes;
  if (b.size > max) return res.status(400).json({ error: `"${b.filename}" is ${mb(b.size)}. The limit for the ${lim.label} is ${mb(max)}.` });
  const id = uid("upl");
  fs.writeFileSync(partPath(id), Buffer.alloc(0));
  run("INSERT INTO upload_sessions (id, org_id, user_id, purpose, filename, kind, size) VALUES (?,?,?,?,?,?,?)", id, req.user!.org_id, req.user!.id, b.purpose, b.filename, kind, b.size);
  res.json({ id, chunk_bytes: CHUNK_BYTES, received: 0 });
});

uploadRoutes.get("/uploads/:id", staff, (req, res) => {
  const s = mine(req.params.id, req.user!);
  if (!s) return res.status(404).json({ error: "Upload not found" });
  res.json({ id: s.id, received: s.received, size: s.size, status: s.status, pages: s.pages });
});

uploadRoutes.put("/uploads/:id", staff, express.raw({ type: () => true, limit: CHUNK_BYTES + 64 * 1024 }), wrap(async (req, res) => {
  const s = mine(req.params.id, req.user!);
  if (!s || s.status !== "uploading") return res.status(404).json({ error: "Upload not found or already finished" });
  const offset = Number(req.query.offset);
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  // Out of step (e.g. a piece was retried after it had already arrived): tell the browser where to continue.
  if (offset !== s.received) return res.status(409).json({ error: "Upload is out of step", received: s.received });
  if (!body.length) return res.status(400).json({ error: "Empty piece" });
  if (s.received + body.length > s.size) return res.status(400).json({ error: "The file is bigger than announced. Start the upload again." });
  await fsp.appendFile(partPath(s.id), body);
  const received = s.received + body.length;
  run("UPDATE upload_sessions SET received = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", received, s.id);
  res.json({ received });
}));

uploadRoutes.post("/uploads/:id/complete", staff, wrap(async (req, res) => {
  const s = mine(req.params.id, req.user!);
  if (!s) return res.status(404).json({ error: "Upload not found" });
  if (s.status === "complete") return res.json({ id: s.id, kind: s.kind, pages: s.pages, filename: s.filename, size: s.size });
  if (s.status !== "uploading") return res.status(400).json({ error: "This upload was cancelled or failed. Upload the file again." });
  if (s.received !== s.size) return res.status(400).json({ error: `Only ${s.received} of ${s.size} bytes arrived. Continue the upload.`, received: s.received });
  const file = partPath(s.id);
  const fail = async (status: number, message: string) => {
    run("UPDATE upload_sessions SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", message, s.id);
    await fsp.rm(file, { force: true });
    return res.status(status).json({ error: message });
  };
  try {
    // Second check on the server: the real file type, then pages / password / damage for PDFs.
    const real = await sniff(file);
    if (real !== s.kind) return fail(400, s.kind === "image"
      ? `"${s.filename}" is not a real photo. Upload JPG, PNG or WEBP images.`
      : `"${s.filename}" is not really a ${s.kind.toUpperCase()} file (its contents don't match its name).`);
    const lim = LIMITS[s.purpose];
    let pages: number | null = null;
    if (s.kind === "pdf") {
      pages = await pdfPages(file, s.filename);
      if (pages > lim.maxPages) return fail(400, `"${s.filename}" has ${pages} pages. The limit for the ${lim.label} is ${lim.maxPages} pages.`);
    } else if (s.kind === "image") {
      const tmp = `${file}.chk.jpg`;
      await fsp.copyFile(file, tmp);
      try { await normaliseImage(tmp, s.filename); pages = 1; } finally { await fsp.rm(tmp, { force: true }); }
    }
    run("UPDATE upload_sessions SET status = 'complete', pages = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", pages, s.id);
    res.json({ id: s.id, kind: s.kind, pages, filename: s.filename, size: s.size });
  } catch (e) {
    if (e instanceof FileProblem) return fail(400, e.message);
    throw e;
  }
}));

uploadRoutes.delete("/uploads/:id", staff, wrap(async (req, res) => {
  const s = mine(req.params.id, req.user!);
  if (!s) return res.status(404).json({ error: "Upload not found" });
  if (s.status === "uploading" || s.status === "complete") {
    run("UPDATE upload_sessions SET status = 'aborted', updated_at = CURRENT_TIMESTAMP WHERE id = ?", s.id);
    await fsp.rm(partPath(s.id), { force: true });
  }
  res.json({ ok: true });
}));

/** Completed uploads owned by this user, ready to be turned into a document (in the given order). */
export function takeUploads(ids: string[], user: { id: string; org_id: string }, purpose: UploadPurpose | UploadPurpose[]) {
  const allowed = Array.isArray(purpose) ? purpose : [purpose];
  return ids.map((id) => {
    const s = mine(id, user);
    if (!s || s.status !== "complete") throw new FileProblem("An uploaded file is missing or not finished. Upload it again.");
    if (!allowed.includes(s.purpose)) throw new FileProblem(`"${s.filename}" was uploaded for a different purpose. Upload it again here.`);
    return s;
  });
}

/** Stale uploads (abandoned for a day) are deleted. */
export function cleanStaleUploads() {
  const stale = one<{ n: number }>("SELECT count(*) n FROM upload_sessions WHERE status IN ('uploading','complete','failed','aborted') AND updated_at < datetime('now', '-1 day')")!.n;
  if (!stale) return;
  for (const f of fs.readdirSync(PART_DIR)) {
    const id = f.replace(/\.part.*$/, "");
    const s = one<{ status: string; updated_at: string }>("SELECT status, updated_at FROM upload_sessions WHERE id = ?", id);
    if (!s || (s.status !== "used" && Date.parse(s.updated_at.replace(" ", "T") + "Z") < Date.now() - 86400_000)) fs.rmSync(path.join(PART_DIR, f), { force: true });
  }
  run("DELETE FROM upload_sessions WHERE updated_at < datetime('now', '-7 days')");
}
