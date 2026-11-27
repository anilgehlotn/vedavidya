// Email through Resend (https://resend.com). The API key comes from RESEND_API_KEY; mail is sent from
// REPORTS_FROM (default "Veda Vidya <reports@vedavidya.co>"; the domain must be verified in Resend).
// RESEND_BASE_URL can point at a test server.
import { PermanentError } from "./jobs.js";

const KEY = () => process.env.RESEND_API_KEY ?? "";
export const emailFrom = () => process.env.REPORTS_FROM ?? "Veda Vidya <reports@vedavidya.co>";
export const emailConfigured = () => Boolean(KEY());
const BASE = () => (process.env.RESEND_BASE_URL ?? "https://api.resend.com").replace(/\/$/, "");

export interface Email { to: string; subject: string; html: string; text: string; replyTo?: string | null; attachments?: { filename: string; content: Buffer }[] }

/** Sends one email; returns Resend's id. Rejections that won't change on retry (bad address, bad key) are permanent. */
export async function sendEmail(m: Email): Promise<string> {
  if (!emailConfigured()) throw new PermanentError("Email isn't set up on this server (RESEND_API_KEY is missing).");
  let r: Response;
  try {
    r = await fetch(`${BASE()}/emails`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: emailFrom(), to: [m.to], subject: m.subject, html: m.html, text: m.text, ...(m.replyTo ? { reply_to: m.replyTo } : {}),
        attachments: (m.attachments ?? []).map((a) => ({ filename: a.filename, content: a.content.toString("base64") })),
      }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) { throw new Error(`The email service couldn't be reached (${(e as Error).message}).`); }
  const body = await r.json().catch(() => ({})) as { id?: string; message?: string; name?: string };
  if (r.ok && body.id) return body.id;
  const why = body.message ?? `HTTP ${r.status}`;
  if (r.status === 429 || r.status >= 500) throw new Error(`The email service is busy (${why}). Trying again.`);
  throw new PermanentError(r.status === 401 || r.status === 403 ? `The email service rejected the key or sender (${why}).` : `The email was rejected: ${why}`);
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const looksLikeEmail = (s: string | null | undefined): s is string => Boolean(s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim()));
