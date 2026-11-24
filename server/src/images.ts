// Normalises uploaded answer-sheet pages so they are always accepted by the Claude API:
// images are auto-rotated and resized (Claude allows max 5 MB / 8000 px per image), PDFs are size-checked.
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

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
