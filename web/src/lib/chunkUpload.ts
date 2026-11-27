// Resumable uploads: files go to the server in 5 MB pieces. Each piece is retried on failure
// (with backoff), an out-of-step piece resumes from what the server already has, and the
// upload can be cancelled at any time. Progress is reported in bytes.
import { api, ApiError, getToken } from "./api";
import { compressImage } from "./upload";

export type Purpose = "paper" | "answer_key" | "class_sheets" | "student_sheet";
export interface UploadLimits { limits: Record<Purpose, { maxBytes: number; maxPages: number; kinds: ("pdf" | "image" | "zip")[]; label: string }>; max_image_bytes: number; chunk_bytes: number }
export interface UploadedFile { id: string; kind: "pdf" | "image" | "zip"; pages: number | null; filename: string; size: number }

let limitsCache: Promise<UploadLimits> | null = null;
/** Upload limits from the server (the same numbers the server enforces). */
export const uploadLimits = () => (limitsCache ??= api<{ upload: UploadLimits }>("/config").then((c) => c.upload));

export const kindOf = (name: string) =>
  /\.pdf$/i.test(name) ? "pdf" : /\.(jpe?g|png|webp)$/i.test(name) ? "image" : /\.zip$/i.test(name) ? "zip" : null;
export const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(n >= 10 * 1048576 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Checks a file before uploading: type, size and (for PDFs) page count and readability. */
export async function checkFile(file: File, purpose: Purpose): Promise<{ ok: true; pages: number | null } | { ok: false; error: string }> {
  const { limits, max_image_bytes } = await uploadLimits();
  const lim = limits[purpose];
  const kind = kindOf(file.name);
  if (!kind || !lim.kinds.includes(kind))
    return { ok: false, error: `"${file.name}" isn't supported here. Upload ${lim.kinds.map((k) => (k === "image" ? "JPG/PNG/WEBP photos" : k.toUpperCase())).join(" or ")}.` };
  const max = kind === "image" ? Math.min(max_image_bytes, lim.maxBytes) : lim.maxBytes;
  if (file.size > max) return { ok: false, error: `"${file.name}" is ${fmtSize(file.size)}. The limit for the ${lim.label} is ${fmtSize(max)}.` };
  if (!file.size) return { ok: false, error: `"${file.name}" is empty.` };
  if (kind !== "pdf") return { ok: true, pages: kind === "image" ? 1 : null };
  // Count pages in the browser (the server checks again, including passwords and damage).
  try {
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    if (String.fromCharCode(...head) !== "%PDF-") return { ok: false, error: `"${file.name}" is not a real PDF file.` };
    if (file.size > 120 * 1048576) return { ok: true, pages: null }; // too big to read in the browser; the server counts
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true, updateMetadata: false });
    const pages = doc.getPageCount();
    if (pages > lim.maxPages) return { ok: false, error: `"${file.name}" has ${pages} pages. The limit for the ${lim.label} is ${lim.maxPages} pages.` };
    return { ok: true, pages };
  } catch {
    return { ok: true, pages: null }; // unusual PDFs: let the server decide
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function putChunk(url: string, body: Blob, signal: AbortSignal, onBytes: (n: number) => void): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    x.setRequestHeader("Authorization", `Bearer ${getToken() ?? ""}`);
    x.setRequestHeader("Content-Type", "application/octet-stream");
    x.upload.onprogress = (e) => onBytes(e.loaded);
    x.onload = () => { let data: any = null; try { data = JSON.parse(x.responseText); } catch { /* not json */ } resolve({ status: x.status, data }); };
    x.onerror = () => reject(new Error("network"));
    x.ontimeout = () => reject(new Error("network"));
    x.timeout = 120_000;
    const abort = () => { x.abort(); reject(new DOMException("Cancelled", "AbortError")); };
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    x.send(body);
  });
}

/**
 * Uploads one file. Photos are shrunk first. `resumeId` continues an earlier upload of the same file.
 * Throws ApiError with a readable message; an AbortError when cancelled.
 */
export async function uploadFile(original: File, purpose: Purpose, opts: { signal: AbortSignal; onProgress: (sent: number, total: number) => void; onSession?: (id: string) => void; resumeId?: string }): Promise<UploadedFile> {
  const file = kindOf(original.name) === "image" ? await compressImage(original) : original;
  let id = opts.resumeId;
  let received = 0;
  let chunk = 5 * 1048576;
  if (id) {
    const s = await api<{ received: number; size: number; status: string }>(`/uploads/${id}`).catch(() => null);
    if (s && s.status === "uploading" && s.size === file.size) received = s.received; else id = undefined;
  }
  if (!id) {
    const s = await api<{ id: string; chunk_bytes: number }>("/uploads", { body: { filename: original.name.replace(/\.(png|webp|jpe?g)$/i, (m) => (file !== original ? ".jpg" : m)), size: file.size, purpose } });
    id = s.id; chunk = s.chunk_bytes;
  }
  opts.onSession?.(id);
  const cancel = () => { void api(`/uploads/${id}`, { method: "DELETE" }).catch(() => {}); };
  opts.signal.addEventListener("abort", cancel, { once: true });
  try {
    let failures = 0;
    while (received < file.size) {
      if (opts.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      const piece = file.slice(received, Math.min(file.size, received + chunk));
      let r: { status: number; data: any };
      try {
        r = await putChunk(`/api/uploads/${id}?offset=${received}`, piece, opts.signal, (n) => opts.onProgress(received + n, file.size));
      } catch (e) {
        if ((e as Error).name === "AbortError") throw e;
        r = { status: 0, data: null }; // network trouble: retry below
      }
      if (r.status === 200) { received = r.data.received; failures = 0; opts.onProgress(received, file.size); continue; }
      if (r.status === 409 && typeof r.data?.received === "number") { received = r.data.received; continue; } // resume where the server is
      if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) throw new ApiError(r.data?.error ?? `Upload failed (${r.status})`, r.status);
      if (++failures > 5) throw new ApiError("The connection keeps dropping. Check your internet and click Retry: the upload continues where it stopped.", r.status || 0);
      await sleep(Math.min(15000, 1000 * 2 ** failures));
    }
    const done = await api<UploadedFile>(`/uploads/${id}/complete`, { body: {} });
    return done;
  } finally {
    opts.signal.removeEventListener("abort", cancel);
  }
}
