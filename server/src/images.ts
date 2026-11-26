// Normalises uploaded answer-sheet pages so they are always accepted by the Claude API:
// images are auto-rotated and resized (Claude allows max 5 MB / 8000 px per image), PDFs are size-checked.
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";

// Keep memory low on small servers: no cache, one image at a time.
sharp.cache(false);
sharp.concurrency(1);

export const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024;

export class UploadError extends Error {}

/** Returns the stored file name (images become .jpg). Throws UploadError for unreadable files. */
export async function normalisePage(dir: string, filename: string, originalName: string): Promise<string> {
  const full = path.join(dir, filename);
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".pdf") {
    const head = Buffer.alloc(5);
    const fd = fs.openSync(full, "r"); fs.readSync(fd, head, 0, 5, 0); fs.closeSync(fd);
    if (head.toString() !== "%PDF-") { fs.rmSync(full, { force: true }); throw new UploadError(`${originalName} is not a valid PDF`); }
    if (fs.statSync(full).size > MAX_PDF_BYTES) { fs.rmSync(full, { force: true }); throw new UploadError(`${originalName} is larger than 20 MB. Split it or upload photos instead.`); }
    return filename;
  }
  const out = filename.replace(/\.[^.]+$/, "") + ".v.jpg";
  try {
    // Photos the browser already shrank (JPEG, upright, ≤ 2000 px, under the size limit) are kept as they are:
    // only the image header is read, which saves a lot of CPU when a whole class is uploaded.
    const meta = await sharp(full, { limitInputPixels: 80_000_000 }).metadata();
    if (meta.format === "jpeg" && (meta.orientation ?? 1) === 1 && Math.max(meta.width ?? 9e9, meta.height ?? 9e9) <= 2000
        && fs.statSync(full).size <= MAX_IMAGE_BYTES) {
      fs.renameSync(full, path.join(dir, out));
      return out;
    }
    let quality = 85, edge = 2000, buf: Buffer;
    do {
      buf = await sharp(full, { failOn: "none", limitInputPixels: 80_000_000 }).rotate().resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" }).jpeg({ quality, mozjpeg: true }).toBuffer();
      quality -= 10; edge -= 200;
    } while (buf.length > MAX_IMAGE_BYTES && quality > 40);
    fs.writeFileSync(path.join(dir, out), buf);
  } catch {
    fs.rmSync(full, { force: true });
    throw new UploadError(`${originalName} could not be read as an image. Use JPG, PNG or WEBP.`);
  }
  fs.rmSync(full, { force: true });
  return out;
}

export function removeFiles(dir: string, names: string[]) {
  for (const n of names) if (/^[\w.-]+$/.test(n)) fs.rmSync(path.join(dir, n), { force: true });
}

// Answer sheets uploaded as PDF are turned into one JPEG per page, so every page can be shown with the
// teacher's ticks and marks drawn on it. Needs poppler's pdftoppm (installed in the Docker image);
// without it, PDFs are kept as they are.
const HAS_PDFTOPPM = (() => { try { execFileSync("pdftoppm", ["-v"], { stdio: "ignore" }); return true; } catch { return false; } })();
const MAX_SHEET_PAGES = 30;

/** Like normalisePage, but a PDF answer sheet becomes several page images. Returns the stored file names in page order. */
export async function normaliseSheet(dir: string, filename: string, originalName: string): Promise<string[]> {
  const checked = await normalisePage(dir, filename, originalName);
  if (!checked.toLowerCase().endsWith(".pdf") || !HAS_PDFTOPPM) return [checked];
  const full = path.join(dir, checked);
  const prefix = checked.replace(/\.pdf$/i, "") + ".p";
  try {
    await new Promise<void>((ok, bad) => execFile("pdftoppm", ["-jpeg", "-jpegopt", "quality=85", "-r", "150", "-scale-to", "2000", "-l", String(MAX_SHEET_PAGES), full, path.join(dir, prefix)],
      { timeout: 90_000 }, (err) => (err ? bad(err) : ok())));
  } catch {
    for (const f of fs.readdirSync(dir).filter((f) => f.startsWith(prefix))) fs.rmSync(path.join(dir, f), { force: true });
    return [checked]; // couldn't render it; keep the PDF (Claude can still read it)
  }
  const pages = fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".jpg"))
    .sort((a, b) => Number(a.match(/-(\d+)\.jpg$/)?.[1] ?? 0) - Number(b.match(/-(\d+)\.jpg$/)?.[1] ?? 0));
  if (!pages.length) return [checked];
  const out: string[] = [];
  for (const pg of pages) out.push(await normalisePage(dir, pg, `${originalName} page ${out.length + 1}`));
  fs.rmSync(full, { force: true });
  return out;
}
