// Settings → AI engine: each institute's admin saves its own Claude API key (stored encrypted, never returned).
import { Router } from "express";
import { z } from "zod";
import { all, one, run } from "../db.js";
import { adminOnly, staff } from "../auth.js";
import { encrypt, decrypt } from "../secrets.js";
import { verifyKey, forgetClients, aiModeOf, AI_MODES, PRICES, PLATFORM_KEY, type AiMode } from "../ai/claude.js";
import { ACTION_LABEL, balance, history, prices } from "../lib/credits.js";
import { rateLimit } from "../ratelimit.js";

export const settingsRoutes = Router();

const status = (orgId: string) => {
  const o = one<{ is_demo: number; claude_key_enc: string | null; claude_key_hint: string | null }>("SELECT is_demo, claude_key_enc, claude_key_hint FROM orgs WHERE id = ?", orgId)!;
  const mode = aiModeOf(orgId);
  const own = Boolean(decrypt(o.claude_key_enc));
  // "configured" = AI works for this institute: with its own key, or with the platform key (paid with credits).
  return { demo: Boolean(o.is_demo), configured: own || Boolean(PLATFORM_KEY), own_key: own, platform_available: Boolean(PLATFORM_KEY), hint: o.claude_key_hint, mode, models: AI_MODES[mode] };
};

settingsRoutes.get("/settings/ai", staff, (req, res) => res.json(status(req.user!.org_id)));

const keyLimit = rateLimit("ai-key", 10, 10 * 60 * 1000, (r) => r.user?.org_id ?? r.ip ?? "?");

settingsRoutes.put("/settings/ai", adminOnly, keyLimit, async (req, res, next) => {
  try {
    const { key } = z.object({ key: z.string().trim().min(20).max(300) }).parse(req.body);
    if (status(req.user!.org_id).demo) return res.status(403).json({ error: "The public demo institute can't store an API key. Create your own institute first." });
    if (!/^sk-ant-[\w-]+$/.test(key)) return res.status(400).json({ error: "That doesn't look like a Claude API key. It should start with sk-ant-" });
    const check = await verifyKey(key);
    if (!check.ok) return res.status(400).json({ error: check.error });
    run("UPDATE orgs SET claude_key_enc = ?, claude_key_hint = ? WHERE id = ?", encrypt(key), `…${key.slice(-4)}`, req.user!.org_id);
    forgetClients();
    res.json({ ...status(req.user!.org_id), model_name: check.model });
  } catch (e) { next(e); }
});

settingsRoutes.post("/settings/ai/test", adminOnly, keyLimit, async (req, res, next) => {
  try {
    const o = one<{ claude_key_enc: string | null }>("SELECT claude_key_enc FROM orgs WHERE id = ?", req.user!.org_id)!;
    const key = decrypt(o.claude_key_enc);
    if (!key) return res.status(400).json({ error: "No API key saved yet" });
    const check = await verifyKey(key);
    if (!check.ok) return res.status(400).json({ error: check.error });
    res.json({ ok: true, model_name: check.model });
  } catch (e) { next(e); }
});

settingsRoutes.delete("/settings/ai", adminOnly, (req, res) => {
  run("UPDATE orgs SET claude_key_enc = NULL, claude_key_hint = NULL WHERE id = ?", req.user!.org_id);
  forgetClients();
  res.json(status(req.user!.org_id));
});

// Which models the institute uses: "mixed" (recommended), or one model for everything.
settingsRoutes.put("/settings/ai/mode", adminOnly, (req, res) => {
  const { mode } = z.object({ mode: z.enum(["mixed", "sonnet", "opus"]) }).parse(req.body);
  run("UPDATE orgs SET ai_mode = ? WHERE id = ?", mode satisfies AiMode, req.user!.org_id);
  res.json(status(req.user!.org_id));
});

const TASK_LABEL: Record<string, string> = { paper: "Reading / writing question papers", marking: "Marking answer sheets", recheck: "Second checks of doubtful answers",
  tagging: "Naming sub-topics", practice: "Fix-it practice", brief: "Re-teach briefs" };
const costOf = (model: string, r: { input: number; output: number; cache_read: number; cache_write: number }) => {
  const p = PRICES[model] ?? PRICES["claude-opus-5-5"]; // unknown model: estimate high rather than low
  return (r.input * p.in + r.output * p.out + r.cache_read * p.cacheRead + r.cache_write * p.cacheWrite) / 1e6;
};

/** This month's AI usage and estimated cost (USD), by job and model. The Anthropic Console has the exact bill. */
settingsRoutes.get("/settings/ai/usage", staff, (req, res) => {
  const month = typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : new Date().toISOString().slice(0, 7);
  const rows = all<{ task: string; model: string; calls: number; input: number; output: number; cache_read: number; cache_write: number }>(`
    SELECT task, model, count(*) calls, sum(input_tokens) input, sum(output_tokens) output, sum(cache_read_tokens) cache_read, sum(cache_write_tokens) cache_write
    FROM ai_usage WHERE org_id = ? AND substr(created_at, 1, 7) = ? GROUP BY task, model ORDER BY task, model`, req.user!.org_id, month);
  const items = rows.map((r) => ({ ...r, label: TASK_LABEL[r.task] ?? r.task, usd: Math.round(costOf(r.model, r) * 10000) / 10000 }));
  const total = items.reduce((t, i) => t + i.usd, 0);
  const sheets = items.filter((i) => i.task === "marking").reduce((t, i) => t + i.calls, 0);
  const sheetCost = items.filter((i) => i.task === "marking" || i.task === "recheck").reduce((t, i) => t + i.usd, 0);
  res.json({ month, items, total_usd: Math.round(total * 100) / 100, sheets_marked: sheets, usd_per_sheet: sheets ? Math.round((sheetCost / sheets) * 10000) / 10000 : null });
});

/** The institute's credit balance, prices and recent history. */
settingsRoutes.get("/credits", staff, (req, res) => {
  const org = req.user!.org_id;
  const before = Number(req.query.before) || undefined;
  res.json({ balance: balance(org), prices: prices(), labels: ACTION_LABEL, history: history(org, Math.min(200, Number(req.query.limit) || 50), before) });
});
