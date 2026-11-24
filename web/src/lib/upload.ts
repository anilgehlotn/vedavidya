// Shrinks phone photos in the browser before upload (keeps them sharp enough to read handwriting),
// then uploads in small batches so a whole class can be sent reliably on a normal connection.
import { api } from "./api";

const MAX_EDGE = 2000;

export async function compressImage(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 600 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.(png|webp|jpe?g)$/i, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file; // the server resizes anyway
  }
}

export const isAllowedFile = (f: File) => /\.(jpe?g|png|webp|pdf)$/i.test(f.name);

export interface BulkResult { students: number; pages: number; unmatched: string[]; ambiguous: string[]; busy: string[]; warnings: string[] }

const rollKey = (name: string) => name.match(/^\D{0,8}?(\d+)/)?.[1] ?? name;

/** Uploads files for a whole test, keeping every student's pages in the same request. */
export async function bulkUpload(testId: string, files: File[], batchId: string | null, onProgress: (done: number, total: number, stage: string) => void): Promise<BulkResult> {
  const total = files.length;
  const prepared: File[] = [];
  for (const [i, f] of files.entries()) {
    onProgress(i, total, "Preparing photos");
    prepared.push(await compressImage(f));
  }
  // Group by roll number so one student's pages are never split across requests.
  const groups = new Map<string, File[]>();
  for (const f of prepared) groups.set(String(Number(rollKey(f.name)) || rollKey(f.name)), [...(groups.get(String(Number(rollKey(f.name)) || rollKey(f.name))) ?? []), f]);
  const chunks: File[][] = [];
  let cur: File[] = [], bytes = 0;
  for (const g of groups.values()) {
    const size = g.reduce((t, f) => t + f.size, 0);
    if (cur.length && (cur.length + g.length > 40 || bytes + size > 40 * 1024 * 1024)) { chunks.push(cur); cur = []; bytes = 0; }
    cur.push(...g); bytes += size;
  }
  if (cur.length) chunks.push(cur);

  const result: BulkResult = { students: 0, pages: 0, unmatched: [], ambiguous: [], busy: [], warnings: [] };
  let sent = 0;
  for (const chunk of chunks) {
    onProgress(sent, total, "Uploading");
    const form = new FormData();
    chunk.forEach((f) => form.append("files", f, f.name));
    const r = await api<BulkResult>(`/tests/${testId}/bulk-files${batchId ? `?batch_id=${encodeURIComponent(batchId)}` : ""}`, { form });
    result.students += r.students; result.pages += r.pages;
    result.unmatched.push(...r.unmatched); result.ambiguous.push(...(r.ambiguous ?? [])); result.busy.push(...r.busy); result.warnings.push(...r.warnings);
    sent += chunk.length;
  }
  onProgress(total, total, "Done");
  return result;
}
