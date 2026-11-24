const TOKEN_KEY = "markwise_token";

export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
export const setToken = (t: string | null) => {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
};

export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
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
export const fileUrl = (path: string) => `/api${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(getToken() ?? "")}`;

export const pct = (score: number | null | undefined, max: number | null | undefined) =>
  score == null || !max ? null : Math.round((score / max) * 100);

export const fmtDate = (s?: string | null) =>
  s ? new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";
export const fmtDateTime = (s?: string | null) =>
  s ? new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z").toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";
