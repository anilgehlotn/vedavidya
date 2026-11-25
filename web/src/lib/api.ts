/// <reference types="vite/client" />
import { demoApi } from "./demo";

const TOKEN_KEY = "vedavidya_token";

export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
export const setToken = (t: string | null) => {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
};

export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }

export const DEMO = Boolean(import.meta.env.VITE_DEMO);

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  if (DEMO) {
    const method = opts.method ?? (opts.body !== undefined || opts.form ? "POST" : "GET");
    return demoApi(path, method, opts.body, getToken(), (m, st) => { throw new ApiError(m, st); }) as Promise<T>;
  }
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body !== undefined || opts.form ? "POST" : "GET"),
    headers,
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && token) { setToken(null); if (!location.pathname.startsWith("/login")) location.href = "/login"; }
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

// Authenticated file URL (for <img src> and downloads).
/** Fetches a protected file with the login header (never a token in the URL) and returns a temporary blob: URL. */
export async function blobUrl(path: string): Promise<{ url: string; type: string }> {
  const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
  if (!res.ok) {
    const msg = await res.json().then((j) => j?.error as string | undefined).catch(() => undefined);
    throw new ApiError(msg ?? (res.status === 404 ? "File not found" : `Download failed (${res.status})`), res.status);
  }
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), type: blob.type };
}

export async function download(path: string, filename: string) {
  const { url } = await blobUrl(path);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Spreadsheet-safe CSV cell (cells starting with = + - @ would run as formulas). */
export const csvCell = (v: unknown) => { const t = String(v ?? ""); return `"${(/^[=+\-@\t\r]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`; };

export const pct = (score: number | null | undefined, max: number | null | undefined) =>
  score == null || !max ? null : Math.round((score / max) * 100);

export const fmtDate = (s?: string | null) =>
  s ? new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";
export const fmtDateTime = (s?: string | null) =>
  s ? new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z").toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";
