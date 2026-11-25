// Splits a whole class's scanned answer sheets into one set of pages per student, in the teacher's browser.
// Works with one big PDF from the scanner, several PDFs, phone photos, or a mix: every page is put in order,
// then the first k pages go to the first student present, the next k to the next one, and so on.
import { api } from "./api";
import { compressImage, isAllowedFile } from "./upload";

type PdfLib = typeof import("pdf-lib");
let lib: Promise<PdfLib> | null = null;
const pdfLib = () => (lib ??= import("pdf-lib"));

export type PageRef = { kind: "image"; file: File; label: string } | { kind: "pdf"; file: File; index: number; label: string };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Orders the files by name (scanner and phone names follow capture order) and lists every page. */
export async function listPages(files: File[]): Promise<{ pages: PageRef[]; problems: string[] }> {
  const pages: PageRef[] = [];
  const problems: string[] = [];
  const sorted = files.filter(isAllowedFile).sort((a, b) => collator.compare(a.name, b.name));
  for (const file of sorted) {
    if (/\.pdf$/i.test(file.name)) {
      try {
        const { PDFDocument } = await pdfLib();
        const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true, updateMetadata: false });
        const n = doc.getPageCount();
        for (let i = 0; i < n; i++) pages.push({ kind: "pdf", file, index: i, label: `${file.name} p.${i + 1}` });
      } catch { problems.push(`${file.name} couldn't be opened. Is it a normal PDF?`); }
    } else pages.push({ kind: "image", file, label: file.name });
  }
  return { pages, problems };
}

/** Pages per student that divide the pages evenly, nearest to the expected count first. */
export function suggestPerStudent(pageCount: number, students: number) {
  if (!students || !pageCount) return 1;
  return pageCount % students === 0 ? pageCount / students : Math.max(1, Math.round(pageCount / students));
}

async function toJpeg(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const c = document.createElement("canvas");
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  return new Promise<Blob>((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error("Couldn't read a photo"))), "image/jpeg", 0.85));
}

/** Builds the files for one student: plain photos stay photos; anything with PDF pages becomes one PDF. */
export async function filesFor(pages: PageRef[], name: string): Promise<File[]> {
  if (pages.every((p) => p.kind === "image")) return Promise.all(pages.map((p) => compressImage(p.file)));
  const { PDFDocument } = await pdfLib();
  const out = await PDFDocument.create();
  const sources = new Map<File, Promise<import("pdf-lib").PDFDocument>>();
  for (const p of pages) {
    if (p.kind === "pdf") {
      if (!sources.has(p.file)) sources.set(p.file, p.file.arrayBuffer().then((b) => PDFDocument.load(b, { ignoreEncryption: true, updateMetadata: false })));
      const [page] = await out.copyPages(await sources.get(p.file)!, [p.index]);
      out.addPage(page);
    } else {
      const small = await compressImage(p.file);
      const bytes = new Uint8Array(await (/png$/i.test(small.type) ? small : /jpe?g$/i.test(small.type) ? small : await toJpeg(small)).arrayBuffer());
      const img = /png$/i.test(small.type) ? await out.embedPng(bytes) : await out.embedJpg(bytes);
      const page = out.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    }
  }
  const bytes = await out.save();
  return [new File([bytes as unknown as BlobPart], `${name}.pdf`, { type: "application/pdf" })];
}

export interface SplitJob { attemptId: string; label: string; pages: PageRef[] }
export interface SplitResult { done: string[]; failed: { label: string; error: string }[] }

/** Uploads every student's pages, a few at a time, replacing anything uploaded before. */
export async function uploadSplit(jobs: SplitJob[], onProgress: (done: number, total: number) => void, parallel = 3): Promise<SplitResult> {
  const result: SplitResult = { done: [], failed: [] };
  let next = 0, finished = 0;
  onProgress(0, jobs.length);
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      try {
        const files = await filesFor(job.pages, job.label.replace(/[^\w-]+/g, "_"));
        const form = new FormData();
        files.forEach((f) => form.append("files", f, f.name));
        await api(`/attempts/${job.attemptId}/files?replace=1`, { form });
        result.done.push(job.label);
      } catch (e) {
        result.failed.push({ label: job.label, error: (e as Error).message });
      }
      onProgress(++finished, jobs.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, jobs.length) }, worker));
  return result;
}
