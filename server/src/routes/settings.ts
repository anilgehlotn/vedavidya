// Settings → AI engine: each institute's admin saves its own Claude API key (stored encrypted, never returned).
import { Router } from "express";
import { z } from "zod";
import { one, run } from "../db.js";
import { adminOnly, staff } from "../auth.js";
import { encrypt, decrypt } from "../secrets.js";
import { verifyKey, forgetClients, MODEL } from "../ai/claude.js";
import { rateLimit } from "../ratelimit.js";

export const settingsRoutes = Router();

const status = (orgId: string) => {
  const o = one<{ is_demo: number; claude_key_enc: string | null; claude_key_hint: string | null }>("SELECT is_demo, claude_key_enc, claude_key_hint FROM orgs WHERE id = ?", orgId)!;
  return { demo: Boolean(o.is_demo), configured: Boolean(decrypt(o.claude_key_enc)), hint: o.claude_key_hint, model: MODEL };
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
