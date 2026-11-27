// Credits: each institute has a balance, made of two buckets:
//   free  - the monthly free credits (reset on the 1st of each month; leftovers expire)
//   paid  - credits granted by the platform owner (never expire)
// Every AI action that uses the platform's Claude key is charged when it is queued (free credits first) and
// refunded if it fails for good. Institutes using their own Claude key are never charged.
// The ledger is append-only: the balance is always the sum of its rows.
import { all, one, run } from "../db.js";
import { PermanentError } from "./jobs.js";

export type CreditAction = "paper_import" | "paper_generate" | "mark_sheet" | "practice_set" | "reteach_brief" | "question_assist" | "identify_pages";

/** Default prices in credits (the platform owner can change them). Roughly 1 credit ≈ ₹1 of AI cost. */
export const DEFAULT_PRICES: Record<CreditAction, number> = {
  paper_import: 15,   // reading a printed paper (+ answer key) with the strongest model
  paper_generate: 10, // writing a new paper
  mark_sheet: 1,      // marking one answer sheet (second check included); +1 for every 8 pages beyond the first 8
  practice_set: 1,    // one student's Fix-it practice + check-up
  reteach_brief: 3,   // the class re-teach brief
  question_assist: 1, // AI help on one question in the paper editor (refine / new solution / rewrite)
  identify_pages: 0.1, // finding the student on each page of a class scan (per page)
};
export const ACTION_LABEL: Record<CreditAction, string> = {
  paper_import: "Reading a question paper", paper_generate: "Generating a question paper", mark_sheet: "Marking an answer sheet",
  practice_set: "Fix-it practice for a student", reteach_brief: "Re-teach brief", question_assist: "AI help on a question", identify_pages: "Finding students on scanned pages",
};
export const DEFAULT_MONTHLY_FREE = 300;

/** Marking costs more when an institute picks stronger models (Settings → Marking quality): roughly what the AI costs us. */
export type Mode = "mixed" | "sonnet" | "opus";
export const DEFAULT_MODE_MULTIPLIERS: Record<Mode, number> = { mixed: 1, sonnet: 5, opus: 10 };

/** Thrown when an institute can't pay for an AI action. Shown to the user as is (HTTP 402). */
export class CreditError extends PermanentError { status = 402; }

const setting = (key: string) => one<{ value: string }>("SELECT value FROM platform_settings WHERE key = ?", key)?.value;
export function prices(): Record<CreditAction, number> {
  try { return { ...DEFAULT_PRICES, ...JSON.parse(setting("prices") ?? "{}") }; } catch { return { ...DEFAULT_PRICES }; }
}
export function modeMultipliers(): Record<Mode, number> {
  try { return { ...DEFAULT_MODE_MULTIPLIERS, ...JSON.parse(setting("mode_multipliers") ?? "{}") }; } catch { return { ...DEFAULT_MODE_MULTIPLIERS }; }
}
const modeOf = (orgId: string): Mode => {
  const m = one<{ ai_mode: string | null }>("SELECT ai_mode FROM orgs WHERE id = ?", orgId)?.ai_mode;
  return m === "sonnet" || m === "opus" ? m : "mixed";
};
export const platformMonthlyFree = () => Number(setting("monthly_free") ?? DEFAULT_MONTHLY_FREE);
export function setPlatformSettings(p: { prices?: Partial<Record<CreditAction, number>>; monthly_free?: number; mode_multipliers?: Partial<Record<Mode, number>> }) {
  if (p.mode_multipliers) run("INSERT INTO platform_settings (key, value) VALUES ('mode_multipliers', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify({ ...modeMultipliers(), ...p.mode_multipliers }));
  if (p.prices) run("INSERT INTO platform_settings (key, value) VALUES ('prices', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify({ ...prices(), ...p.prices }));
  if (p.monthly_free != null) run("INSERT INTO platform_settings (key, value) VALUES ('monthly_free', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", String(p.monthly_free));
}
export const orgMonthlyFree = (orgId: string) => {
  const v = one<{ monthly_free_credits: number | null }>("SELECT monthly_free_credits FROM orgs WHERE id = ?", orgId)?.monthly_free_credits;
  return v ?? platformMonthlyFree();
};

/**
 * Price of an action for an institute. Marking costs more for very long sheets (+1 per 8 pages over 8)
 * and is multiplied by the institute's marking-quality mode (Mixed ×1, Sonnet ×5, Opus ×10 by default).
 */
export function priceOf(orgId: string, action: CreditAction, units = 1, pages = 0) {
  const base = prices()[action];
  if (action !== "mark_sheet") return round(Math.max(0, base * units));
  const extra = pages > 8 ? Math.ceil((pages - 8) / 8) : 0;
  return round(Math.max(0, (base + extra) * modeMultipliers()[modeOf(orgId)] * units));
}
/** What each action costs this institute right now (marking: per sheet of up to 8 pages). */
export const orgPrices = (orgId: string) =>
  Object.fromEntries((Object.keys(DEFAULT_PRICES) as CreditAction[]).map((a) => [a, priceOf(orgId, a)])) as Record<CreditAction, number>;

const thisMonth = () => new Date().toISOString().slice(0, 7);
const round = (n: number) => Math.round(n * 100) / 100;

/** Gives this month's free credits (once), expiring last month's leftovers. Safe to call often. */
export function ensureMonthly(orgId: string) {
  const month = thisMonth();
  if (one("SELECT 1 FROM credit_ledger WHERE org_id = ? AND kind = 'monthly_free' AND month = ?", orgId, month)) return;
  const leftover = bucketBalance(orgId, "free");
  try {
    if (leftover > 0) run("INSERT INTO credit_ledger (org_id, kind, bucket, amount, month, note) VALUES (?, 'expire', 'free', ?, ?, 'Unused free credits from last month')", orgId, -leftover, month);
    run("INSERT INTO credit_ledger (org_id, kind, bucket, amount, month, note) VALUES (?, 'monthly_free', 'free', ?, ?, 'Free credits for the month')", orgId, orgMonthlyFree(orgId), month);
  } catch (e) {
    if (!/UNIQUE/.test(String(e))) throw e; // another request granted it at the same moment
  }
}

const bucketBalance = (orgId: string, bucket: "free" | "paid") =>
  round(one<{ s: number | null }>("SELECT sum(amount) s FROM credit_ledger WHERE org_id = ? AND bucket = ?", orgId, bucket)?.s ?? 0);

export interface Balance { free: number; paid: number; total: number; monthly_free: number; resets_on: string; own_key: boolean }
export function balance(orgId: string): Balance {
  ensureMonthly(orgId);
  const free = Math.max(0, bucketBalance(orgId, "free")), paid = bucketBalance(orgId, "paid");
  const next = new Date(); next.setUTCMonth(next.getUTCMonth() + 1, 1);
  return { free, paid, total: round(free + paid), monthly_free: orgMonthlyFree(orgId), resets_on: next.toISOString().slice(0, 10), own_key: usesOwnKey(orgId) };
}

/** Institutes with their own Claude key pay Anthropic directly and are never charged credits. */
export const usesOwnKey = (orgId: string) => Boolean(one<{ k: string | null }>("SELECT claude_key_enc k FROM orgs WHERE id = ?", orgId)?.k);

/**
 * Charges an action. Returns the charge reference (for a refund if it fails), or null when nothing was charged
 * (own key, or a price of 0). Throws CreditError when the balance is too low; nothing is charged then.
 */
export function charge(orgId: string, action: CreditAction, ref: string, opts: { units?: number; pages?: number; amount?: number; userId?: string; note?: string } = {}): string | null {
  if (usesOwnKey(orgId)) return null;
  const amount = round(opts.amount ?? priceOf(orgId, action, opts.units ?? 1, opts.pages ?? 0));
  if (amount <= 0) return null;
  const b = balance(orgId);
  if (b.total < amount) throw new CreditError(notEnough(amount, b));
  const fromFree = Math.min(b.free, amount), fromPaid = round(amount - fromFree);
  const note = opts.note ?? ACTION_LABEL[action];
  if (fromFree > 0) run("INSERT INTO credit_ledger (org_id, kind, bucket, amount, action, ref, note, created_by) VALUES (?, 'charge', 'free', ?, ?, ?, ?, ?)", orgId, -fromFree, action, ref, note, opts.userId ?? null);
  if (fromPaid > 0) run("INSERT INTO credit_ledger (org_id, kind, bucket, amount, action, ref, note, created_by) VALUES (?, 'charge', 'paid', ?, ?, ?, ?, ?)", orgId, -fromPaid, action, ref, note, opts.userId ?? null);
  return ref;
}

/** Checks (without charging) that the institute can pay `amount`; throws CreditError if not. */
export function requireCredits(orgId: string, amount: number) {
  if (usesOwnKey(orgId) || amount <= 0) return;
  const b = balance(orgId);
  if (b.total < amount) throw new CreditError(notEnough(amount, b));
}

const notEnough = (amount: number, b: Balance) =>
  `Not enough credits: this needs ${amount} credit${amount === 1 ? "" : "s"} and your institute has ${b.total}. ` +
  `Free credits (${b.monthly_free}) are added again on ${new Date(b.resets_on + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "long" })}; ` +
  `ask the Veda Vidya team to add more, or add your own Claude key in Settings.`;

/** Refunds every charge made under `ref` (once), back into the buckets it came from. */
export function refund(orgId: string | null | undefined, ref: string | null | undefined, note = "Refund: the action failed") {
  if (!orgId || !ref) return;
  if (one("SELECT 1 FROM credit_ledger WHERE org_id = ? AND ref = ? AND kind = 'refund'", orgId, ref)) return;
  for (const c of all<{ bucket: string; amount: number; action: string }>("SELECT bucket, amount, action FROM credit_ledger WHERE org_id = ? AND ref = ? AND kind = 'charge'", orgId, ref))
    run("INSERT INTO credit_ledger (org_id, kind, bucket, amount, action, ref, note) VALUES (?, 'refund', ?, ?, ?, ?, ?)", orgId, c.bucket, -c.amount, c.action, ref, note);
}

/** Platform owner: add (or with a negative amount, remove) granted credits. */
export function grant(orgId: string, amount: number, note: string, byUserId: string) {
  if (amount >= 0) return void run("INSERT INTO credit_ledger (org_id, kind, bucket, amount, note, created_by) VALUES (?, 'grant', 'paid', ?, ?, ?)", orgId, round(amount), note, byUserId);
  // Removing credits takes from this month's free credits first, like normal use.
  const b = balance(orgId);
  const take = round(-amount), fromFree = Math.min(b.free, take), fromPaid = round(take - fromFree);
  if (fromFree > 0) run("INSERT INTO credit_ledger (org_id, kind, bucket, amount, note, created_by) VALUES (?, 'adjust', 'free', ?, ?, ?)", orgId, -fromFree, note, byUserId);
  if (fromPaid > 0) run("INSERT INTO credit_ledger (org_id, kind, bucket, amount, note, created_by) VALUES (?, 'adjust', 'paid', ?, ?, ?)", orgId, -fromPaid, note, byUserId);
}

export const history = (orgId: string, limit = 50, before?: number) =>
  all<{ id: number; kind: string; bucket: string; amount: number; action: string | null; note: string | null; created_at: string }>(
    `SELECT id, kind, bucket, amount, action, note, created_at FROM credit_ledger WHERE org_id = ? ${before ? "AND id < ?" : ""} ORDER BY id DESC LIMIT ?`,
    ...(before ? [orgId, before, limit] : [orgId, limit]));
