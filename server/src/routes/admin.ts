// Platform owner (super-admin) tools. Super-admins are listed in SUPER_ADMIN_EMAILS (comma-separated).
import { Router, type NextFunction, type Request, type Response } from "express";
import { all, one, run } from "../db.js";
import { z } from "zod";
import { balance, grant, platformMonthlyFree, prices, setPlatformSettings, DEFAULT_PRICES, DEFAULT_MODE_MULTIPLIERS, modeMultipliers, type CreditAction } from "../lib/credits.js";
import { PLATFORM_KEY } from "../ai/claude.js";
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

// ---- Credits across institutes ----
adminRoutes.get("/admin/orgs", superAdmin, (_req, res) => {
  const month = new Date().toISOString().slice(0, 7);
  res.json(all<any>(`SELECT o.id, o.name, o.city, o.created_at, o.is_demo, o.monthly_free_credits, (o.claude_key_enc IS NOT NULL) AS own_key,
      (SELECT count(*) FROM users u WHERE u.org_id = o.id AND u.role = 'student') AS students,
      (SELECT -coalesce(sum(amount), 0) FROM credit_ledger l WHERE l.org_id = o.id AND l.kind IN ('charge','refund') AND substr(l.created_at, 1, 7) = ?) AS used_this_month
    FROM orgs o ORDER BY o.created_at DESC`, month).map((o) => ({ ...o, own_key: Boolean(o.own_key), balance: o.is_demo ? null : balance(o.id) })));
});
adminRoutes.put("/admin/orgs/:id/quota", superAdmin, (req, res) => {
  const { monthly_free_credits } = z.object({ monthly_free_credits: z.number().min(0).max(1_000_000).nullable() }).parse(req.body);
  const r = run("UPDATE orgs SET monthly_free_credits = ? WHERE id = ?", monthly_free_credits, req.params.id);
  if (!r.changes) return res.status(404).json({ error: "Institute not found" });
  res.json({ ok: true, note: "Applies from next month's free credits." });
});
adminRoutes.post("/admin/orgs/:id/credits", superAdmin, (req, res) => {
  const b = z.object({ amount: z.number().min(-1_000_000).max(1_000_000).refine((n) => n !== 0, "Amount can't be 0"), note: z.string().trim().min(1).max(200) }).parse(req.body);
  if (!one("SELECT 1 FROM orgs WHERE id = ?", req.params.id)) return res.status(404).json({ error: "Institute not found" });
  grant(req.params.id, b.amount, b.note, req.user!.id);
  res.json(balance(req.params.id));
});
adminRoutes.get("/admin/settings", superAdmin, (_req, res) => res.json({ prices: prices(), default_prices: DEFAULT_PRICES, mode_multipliers: modeMultipliers(), default_mode_multipliers: DEFAULT_MODE_MULTIPLIERS, monthly_free: platformMonthlyFree(), platform_key: Boolean(PLATFORM_KEY) }));
adminRoutes.put("/admin/settings", superAdmin, (req, res) => {
  const price = z.number().min(0).max(1000);
  const b = z.object({
    prices: z.object(Object.fromEntries(Object.keys(DEFAULT_PRICES).map((k) => [k, price.optional()])) as Record<CreditAction, z.ZodOptional<typeof price>>).optional(),
    monthly_free: z.number().min(0).max(1_000_000).optional(),
    mode_multipliers: z.object({ mixed: z.number().min(0).max(100).optional(), sonnet: z.number().min(0).max(100).optional(), opus: z.number().min(0).max(100).optional() }).optional(),
  }).parse(req.body);
  setPlatformSettings(b as never);
  res.json({ prices: prices(), mode_multipliers: modeMultipliers(), monthly_free: platformMonthlyFree() });
});
/** Teacher corrections of AI marks (for improving the marking). Newest first. */
adminRoutes.get("/admin/corrections", superAdmin, (req, res) => {
  const limit = Math.min(1000, Number(req.query.limit) || 200);
  res.json(all("SELECT * FROM grade_corrections ORDER BY id DESC LIMIT ?", limit));
});
