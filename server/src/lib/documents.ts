// A document is one uploaded item (a question paper, an answer key, a class's scanned sheets, or one
// student's sheet), made of one or more source files. Processing turns it into page images, stored with
// their page number and size, so answers can be marked and drawn on later. Processing runs as a job.
import fsp from "node:fs/promises";
import path from "node:path";
import { all, json, one, run, uid } from "../db.js";
import { storage, makeTemp, cleanTemp } from "./storage.js";
import { enqueueJob, registerJob } from "./jobs.js";
import { extractZip, FileProblem, normaliseImage, renderPdf, type RenderedPage } from "./files.js";
import { LIMITS, type UploadPurpose } from "./limits.js";
import { partPath, type UploadSession } from "../routes/uploads.js";

export interface DocSource { key: string; name: string; kind: "pdf" | "image" | "zip"; size: number }
export interface DocRow {
  id: string; org_id: string; purpose: UploadPurpose; title: string; sources: string; status: string; error: string | null; pages: number;
  test_id: string | null; attempt_id: string | null; paper_id: string | null; created_at: string;
}

/** Moves finished uploads into storage as a new document and queues its processing. */
export async function createDocument(opts: {
  orgId: string; userId: string; purpose: UploadPurpose; uploads: UploadSession[]; title?: string;
  testId?: string; attemptId?: string; paperId?: string; process?: boolean;
}) {
  const id = uid("doc");
  const sources: DocSource[] = [];
  for (const [i, u] of opts.uploads.entries()) {
    const ext = u.kind === "image" ? (path.extname(u.filename).toLowerCase() || ".jpg") : `.${u.kind}`;
    const key = `docs/${id}/src-${String(i + 1).padStart(2, "0")}${ext}`;
    await storage.put(key, partPath(u.id));
    run("UPDATE upload_sessions SET status = 'used', updated_at = CURRENT_TIMESTAMP WHERE id = ?", u.id);
    sources.push({ key, name: u.filename, kind: u.kind, size: u.size });
  }
  run(`INSERT INTO documents (id, org_id, purpose, title, sources, size, test_id, attempt_id, paper_id, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    id, opts.orgId, opts.purpose, (opts.title ?? sources.map((s) => s.name).join(", ")).slice(0, 200), JSON.stringify(sources),
    sources.reduce((t, s) => t + s.size, 0), opts.testId ?? null, opts.attemptId ?? null, opts.paperId ?? null, opts.userId);
  if (opts.process !== false) enqueueJob("process_document", { document_id: id }, { orgId: opts.orgId, dedupeKey: `doc:${id}` });
  return id;
}

export const getDocument = (id: string) => one<DocRow>("SELECT * FROM documents WHERE id = ?", id);
export const documentPages = (id: string) =>
  all<{ page_no: number; storage_key: string; width: number; height: number; source_name: string | null }>("SELECT page_no, storage_key, width, height, source_name FROM document_pages WHERE document_id = ? ORDER BY page_no", id);

/** Renders every source into page images (idempotent: a completed document is left as is). */
export async function processDocument(id: string) {
  const doc = getDocument(id);
  if (!doc) throw new FileProblem("This upload no longer exists.");
  if (doc.status === "completed") return documentPages(id);
  run("UPDATE documents SET status = 'processing', error = NULL WHERE id = ?", id);
  const lim = LIMITS[doc.purpose];
  const tmp = await makeTemp();
  try {
    const pages: (RenderedPage & { source: string })[] = [];
    const add = async (file: string, kind: "pdf" | "image", name: string) => {
      if (kind === "pdf") {
        const remaining = lim.maxPages - pages.length;
        if (remaining <= 0) throw new FileProblem(`This upload has more than ${lim.maxPages} pages, the limit for the ${lim.label}.`);
        const dir = await fsp.mkdtemp(path.join(tmp, "p"));
        const rendered = await renderPdf(file, name, dir, { edge: doc.purpose === "paper" || doc.purpose === "answer_key" ? 1600 : 2000 });
        if (rendered.length > remaining) throw new FileProblem(`This upload has more than ${lim.maxPages} pages, the limit for the ${lim.label}.`);
        pages.push(...rendered.map((r) => ({ ...r, source: name })));
      } else {
        if (pages.length >= lim.maxPages) throw new FileProblem(`This upload has more than ${lim.maxPages} pages, the limit for the ${lim.label}.`);
        const dest = path.join(tmp, `i${pages.length + 1}.jpg`);
        await fsp.copyFile(file, dest);
        pages.push({ file: dest, ...(await normaliseImage(dest, name)), source: name });
      }
    };
    for (const s of json<DocSource[]>(doc.sources, [])) {
      await storage.withLocalFile(s.key, async (local) => {
        if (s.kind === "zip") for (const e of await extractZip(local, s.name, await fsp.mkdtemp(path.join(tmp, "z")))) await add(e.file, e.kind, e.name);
        else await add(local, s.kind, s.name);
      });
    }
    if (!pages.length) throw new FileProblem("No pages were found in this upload.");
    // Store the pages, then record them (a retry after a crash simply overwrites the same keys).
    run("DELETE FROM document_pages WHERE document_id = ?", id);
    for (const [i, p] of pages.entries()) {
      const key = `docs/${id}/p-${String(i + 1).padStart(4, "0")}.jpg`;
      await storage.put(key, p.file);
      run("INSERT INTO document_pages (document_id, page_no, storage_key, width, height, source_name) VALUES (?,?,?,?,?,?)", id, i + 1, key, p.width, p.height, p.source);
    }
    run("UPDATE documents SET status = 'completed', pages = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?", pages.length, id);
    return documentPages(id);
  } finally { await cleanTemp(tmp); }
}

/** Deletes documents and every file they own. */
export async function deleteDocuments(ids: string[]) {
  for (const id of ids) {
    const d = getDocument(id);
    if (!d) continue;
    const keys = [...json<DocSource[]>(d.sources, []).map((s) => s.key), ...documentPages(id).map((p) => p.storage_key)].filter(Boolean);
    run("DELETE FROM documents WHERE id = ?", id);
    await storage.remove(keys);
  }
}

/** Files owned by documents tied to a test (for cleanup when the test goes). */
export const documentsOfTest = (testId: string) => all<{ id: string }>("SELECT id FROM documents WHERE test_id = ? OR attempt_id IN (SELECT id FROM attempts WHERE test_id = ?)", testId, testId).map((d) => d.id);

// What happens once a document's pages are ready, by purpose (registered by the routes that own them).
type ReadyHook = (doc: DocRow) => Promise<void> | void;
type FailHook = (doc: DocRow, message: string) => void;
const readyHooks = new Map<UploadPurpose, ReadyHook>();
const failHooks = new Map<UploadPurpose, FailHook>();
export function onDocumentReady(purpose: UploadPurpose, ready: ReadyHook, failed?: FailHook) {
  readyHooks.set(purpose, ready);
  if (failed) failHooks.set(purpose, failed);
}

registerJob<{ document_id: string }>("process_document", {
  concurrency: Number(process.env.RENDER_CONCURRENCY ?? 1), // rendering is CPU- and memory-heavy
  run: async ({ document_id }) => {
    const pages = await processDocument(document_id);
    const doc = getDocument(document_id)!;
    await readyHooks.get(doc.purpose)?.(doc);
    return { pages: pages.length };
  },
  onRetry: ({ document_id }, message) => run("UPDATE documents SET status = 'queued', error = ? WHERE id = ?", `Retrying: ${message}`, document_id),
  onFail: ({ document_id }, message) => {
    run("UPDATE documents SET status = 'failed', error = ? WHERE id = ?", message, document_id);
    const doc = getDocument(document_id);
    if (doc) failHooks.get(doc.purpose)?.(doc, message);
  },
});
