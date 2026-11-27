// Checks uploaded files and turns them into page images.
// PDFs: page count, password protection and damage are checked with poppler's pdfinfo; pages are rendered
// with pdftoppm. Images: auto-rotated, resized to ≤ 2000 px JPEG. ZIPs: only PDFs and images inside are used,
// with limits on entry count and unpacked size, and entry names are never used as paths (zip-slip safe).
import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import sharp, { type Metadata, type OutputInfo } from "sharp";
import yauzl from "yauzl";
import { PermanentError } from "./jobs.js";
import { kindOf, MAX_IMAGE_BYTES, ZIP_MAX_ENTRIES, ZIP_MAX_UNPACKED } from "./limits.js";

sharp.cache(false);
sharp.concurrency(1);

/** A problem with the file itself, shown to the user as is. Never retried. */
export class FileProblem extends PermanentError {}

const exec = (cmd: string, args: string[], timeout: number) =>
  new Promise<{ stdout: string; stderr: string; code: number }>((resolve) =>
    execFile(cmd, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ stdout: String(stdout), stderr: String(stderr), code: err ? ((err as { code?: number }).code ?? 1) : 0 })));

/** Reads the first bytes to confirm the real file type (not just the name). */
export async function sniff(p: string): Promise<"pdf" | "zip" | "image" | null> {
  const fh = await fsp.open(p, "r");
  try {
    const b = Buffer.alloc(12);
    await fh.read(b, 0, 12, 0);
    if (b.subarray(0, 5).toString() === "%PDF-") return "pdf";
    if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return "zip";
    if ((b[0] === 0xff && b[1] === 0xd8) || b.subarray(1, 4).toString() === "PNG" || (b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP")) return "image";
    return null;
  } finally { await fh.close(); }
}

/** Page count of a PDF. Throws FileProblem for password-protected or damaged files. */
export async function pdfPages(p: string, name: string): Promise<number> {
  const r = await exec("pdfinfo", [p], 60_000);
  const out = r.stdout + r.stderr;
  if (/Incorrect password|password/i.test(out) && !/^Pages:/m.test(r.stdout))
    throw new FileProblem(`"${name}" is password-protected. Remove the password (open it and save/print it as a new PDF), then upload again.`);
  const m = r.stdout.match(/^Pages:\s+(\d+)/m);
  if (!m || Number(m[1]) < 1) throw new FileProblem(`"${name}" looks damaged and can't be opened. Re-scan or re-save it as PDF, then upload again.`);
  return Number(m[1]);
}

export interface RenderedPage { file: string; width: number; height: number }

/** Renders PDF pages to JPEGs (longest side `edge` px) in outDir, in page order. */
export async function renderPdf(p: string, name: string, outDir: string, opts: { edge?: number; firstPage?: number; lastPage?: number } = {}): Promise<RenderedPage[]> {
  const total = await pdfPages(p, name);
  const first = opts.firstPage ?? 1, last = Math.min(total, opts.lastPage ?? total);
  const prefix = path.join(outDir, `r${Date.now().toString(36)}`);
  // Generous time: about 3 s per page, at least a minute.
  const r = await exec("pdftoppm", ["-jpeg", "-jpegopt", "quality=85", "-r", "150", "-scale-to", String(opts.edge ?? 2000),
    "-f", String(first), "-l", String(last), p, prefix], Math.max(60_000, (last - first + 1) * 3000));
  const files = (await fsp.readdir(outDir)).filter((f) => f.startsWith(path.basename(prefix)) && f.endsWith(".jpg"))
    .sort((a, b) => Number(a.match(/-(\d+)\.jpg$/)?.[1] ?? 0) - Number(b.match(/-(\d+)\.jpg$/)?.[1] ?? 0));
  if (r.code !== 0 && files.length < last - first + 1)
    throw new FileProblem(`"${name}" could not be turned into page images (${(r.stderr.split("\n")[0] || "unknown error").slice(0, 160)}). Re-save it as PDF and upload again.`);
  const out: RenderedPage[] = [];
  for (const f of files) out.push({ file: path.join(outDir, f), ...(await normaliseImage(path.join(outDir, f), `${name} page ${out.length + 1}`)) });
  return out;
}

/** Rotates, resizes (≤ 2000 px) and re-encodes an image as JPEG under 4.5 MB, in place. Returns its size. */
export async function normaliseImage(p: string, name: string, edge = 2000): Promise<{ width: number; height: number }> {
  const stat = await fsp.stat(p);
  if (stat.size > MAX_IMAGE_BYTES) throw new FileProblem(`"${name}" is larger than ${MAX_IMAGE_BYTES / 1048576} MB.`);
  let meta: Metadata;
  try { meta = await sharp(p, { limitInputPixels: 80_000_000 }).metadata(); }
  catch { throw new FileProblem(`"${name}" could not be read as an image. Use JPG, PNG or WEBP.`); }
  if (meta.format === "jpeg" && (meta.orientation ?? 1) === 1 && Math.max(meta.width ?? 9e9, meta.height ?? 9e9) <= edge && stat.size <= 4.5 * 1048576)
    return { width: meta.width!, height: meta.height! };
  let quality = 85, e = edge, buf: Buffer, info: OutputInfo;
  try {
    do {
      ({ data: buf, info } = await sharp(p, { failOn: "none", limitInputPixels: 80_000_000 }).rotate().resize({ width: e, height: e, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" }).jpeg({ quality, mozjpeg: true }).toBuffer({ resolveWithObject: true }));
      quality -= 10; e -= 200;
    } while (buf.length > 4.5 * 1048576 && quality > 40);
  } catch { throw new FileProblem(`"${name}" could not be read as an image. Use JPG, PNG or WEBP.`); }
  await fsp.writeFile(p, buf);
  return { width: info.width, height: info.height };
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Extracts the PDFs and images from a ZIP into outDir (safe names), in natural name order. */
export async function extractZip(p: string, name: string, outDir: string): Promise<{ file: string; name: string; kind: "pdf" | "image" }[]> {
  const zip = await new Promise<yauzl.ZipFile>((ok, bad) => yauzl.open(p, { lazyEntries: true, autoClose: true }, (err, z) => (err || !z ? bad(new FileProblem(`"${name}" is not a valid ZIP file.`)) : ok(z))));
  const found: { file: string; name: string; kind: "pdf" | "image" }[] = [];
  let entries = 0, unpacked = 0;
  await new Promise<void>((ok, bad) => {
    const fail = (e: Error) => { zip.close(); bad(e); };
    zip.on("error", () => fail(new FileProblem(`"${name}" is damaged and can't be unpacked.`)));
    zip.on("end", () => ok());
    zip.on("entry", (entry: yauzl.Entry) => {
      const base = entry.fileName.split("/").pop() ?? "";
      const kind = kindOf(base);
      if (/\/$/.test(entry.fileName) || entry.fileName.startsWith("__MACOSX/") || base.startsWith(".") || !kind || kind === "zip") return zip.readEntry();
      if (++entries > ZIP_MAX_ENTRIES) return fail(new FileProblem(`"${name}" has more than ${ZIP_MAX_ENTRIES} files. Split it into smaller ZIPs.`));
      if ((entry.generalPurposeBitFlag & 0x1) !== 0) return fail(new FileProblem(`"${name}" is password-protected. Upload a ZIP without a password.`));
      unpacked += entry.uncompressedSize;
      if (unpacked > ZIP_MAX_UNPACKED) return fail(new FileProblem(`"${name}" unpacks to more than ${ZIP_MAX_UNPACKED / 1048576} MB. Split it into smaller ZIPs.`));
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) return fail(new FileProblem(`"${name}" is damaged and can't be unpacked.`));
        const file = path.join(outDir, `z${String(found.length + 1).padStart(4, "0")}${kind === "pdf" ? ".pdf" : path.extname(base).toLowerCase()}`);
        let written = 0;
        stream.on("data", (c: Buffer) => { written += c.length; if (written > entry.uncompressedSize + 1024) stream.destroy(new Error("size")); });
        stream.pipe(fs.createWriteStream(file)).on("finish", () => { found.push({ file, name: base, kind: kind as "pdf" | "image" }); zip.readEntry(); }).on("error", () => fail(new FileProblem(`"${name}" is damaged and can't be unpacked.`)));
        stream.on("error", () => fail(new FileProblem(`"${name}" is damaged and can't be unpacked.`)));
      });
    });
    zip.readEntry();
  });
  if (!found.length) throw new FileProblem(`"${name}" has no PDFs or images (JPG, PNG, WEBP) inside.`);
  return found.sort((a, b) => collator.compare(a.name, b.name));
}
