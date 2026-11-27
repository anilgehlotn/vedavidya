// Platform owner (super-admin) tools. Super-admins are listed in SUPER_ADMIN_EMAILS (comma-separated).
import { Router, type NextFunction, type Request, type Response } from "express";
import { one } from "../db.js";
import { listBackups, runBackup } from "../lib/backup.js";
import { jobCounts } from "../lib/jobs.js";

export const adminRoutes = Router();
const SUPER = new Set((process.env.SUPER_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));

export const isSuperAdmin = (userId: string) => {
  const email = one<{ email: string | null }>("SELECT email FROM users WHERE id = ?", userId)?.email;
  return Boolean(email && SUPER.has(email.toLowerCase()));
};
export function superAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || !isSuperAdmin(req.user.id)) return res.status(403).json({ error: "Only the platform owner can do this" });
  next();
}

adminRoutes.get("/admin/backups", superAdmin, (_req, res) => res.json({ backups: listBackups() }));
adminRoutes.post("/admin/backup", superAdmin, async (_req, res, next) => {
  try { res.json(await runBackup("manual")); } catch (e) { next(e); }
});
adminRoutes.get("/admin/jobs", superAdmin, (_req, res) => res.json({ jobs: jobCounts() }));
