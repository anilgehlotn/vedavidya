// Builds "the marked answer sheet" as a PDF in the browser: each page photo with the same red ticks,
// crosses, circled marks and circled total that the on-screen sheet shows.
import type { PageMarks } from "./marks";

const RED = { r: 0.878, g: 0.188, b: 0.165 };
const TICK = "M 0 11 L 8 20 L 26 0";
const CROSS = "M 0 0 L 18 18 M 18 0 L 0 18";

async function toJpegBytes(blob: Blob): Promise<{ bytes: Uint8Array; png: boolean }> {
  if (blob.type === "image/jpeg") return { bytes: new Uint8Array(await blob.arrayBuffer()), png: false };
  if (blob.type === "image/png") return { bytes: new Uint8Array(await blob.arrayBuffer()), png: true };
  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0);
  const out = await new Promise<Blob>((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error("Couldn't read a page"))), "image/jpeg", 0.9));
  return { bytes: new Uint8Array(await out.arrayBuffer()), png: false };
}

export interface MarkedSheet {
  /** One image Blob per page (null for pages that can't be drawn on, which are skipped). */
  pages: (Blob | null)[];
  layout: PageMarks[];
  total: { score: number; max: number };
  /** Small grey label at the top of each page, e.g. "Roll 7 · Aarav Mehta" (for a whole-class file). */
  label?: string;
}

/** The corrected answer sheets as one PDF: one student, or a whole class one after another. */
export async function markedCopyPdf(sheets: MarkedSheet[], title: string): Promise<Blob> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const red = rgb(RED.r, RED.g, RED.b);
  let pagesAdded = 0;
  for (const { pages, layout, total, label } of sheets) {
  let first = true;
  for (const [i, blob] of pages.entries()) {
    if (!blob) continue;
    const { bytes, png } = await toJpegBytes(blob);
    const img = png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const W = 595, H = (img.height / img.width) * W; // A4 width, keep the photo's shape
    const page = doc.addPage([W, H]);
    page.drawImage(img, { x: 0, y: 0, width: W, height: H });
    pagesAdded++;
    if (label) page.drawText(label, { x: 12, y: H - 14, size: 8, font, color: rgb(0.45, 0.45, 0.5) });
    const at = (fx: number, fy: number) => ({ x: fx * W, y: H - fy * H });
    const s = W / 600; // scale for marks
    for (const m of layout[i]?.marks ?? []) {
      const p = at(m.x, m.y);
      if (m.kind === "cross") page.drawSvgPath(CROSS, { x: p.x, y: p.y + 9 * s * 1.1, scale: s * 1.1, borderColor: red, borderWidth: 2.4 });
      else page.drawSvgPath(TICK, { x: p.x, y: p.y + 10 * s * (m.kind === "half" ? 0.8 : 1.1), scale: s * (m.kind === "half" ? 0.8 : 1.1), borderColor: red, borderWidth: 2.4 });
    }
    for (const n of layout[i]?.notes ?? []) {
      const a = at(n.x, n.y + n.h), size = 9.5 * s;
      page.drawLine({ start: a, end: { x: a.x + n.w * W, y: a.y }, thickness: 1.4, color: red, opacity: 0.8 });
      // Standard PDF fonts only have Latin letters: keep ASCII, swap the rest for close equivalents.
      const txt = n.text.replace(/\$/g, "").replace(/[−–—]/g, "-").replace(/[^\x20-\x7E]/g, "?");
      page.drawText(txt, { x: Math.min(a.x, W - font.widthOfTextAtSize(txt, size) - 6), y: a.y - size - 2, size, font, color: red });
    }
    for (const c of layout[i]?.circles ?? []) {
      const p = at(c.x, c.y), r = 15 * s, size = 13 * s;
      page.drawEllipse({ x: p.x, y: p.y, xScale: r, yScale: r * 0.92, borderColor: red, borderWidth: 1.8 });
      page.drawText(c.text, { x: p.x - font.widthOfTextAtSize(c.text, size) / 2, y: p.y - size * 0.35, size, font, color: red });
    }
    if (first) {
      const p = at(0.86, 0.075), r = 32 * s, size = 20 * s;
      const top = String(total.score), bottom = String(total.max);
      page.drawEllipse({ x: p.x, y: p.y, xScale: r, yScale: r * 0.92, borderColor: red, borderWidth: 2.2 });
      page.drawText(top, { x: p.x - font.widthOfTextAtSize(top, size) / 2, y: p.y + 3 * s, size, font, color: red });
      page.drawLine({ start: { x: p.x - r * 0.6, y: p.y }, end: { x: p.x + r * 0.6, y: p.y }, thickness: 1.6, color: red });
      page.drawText(bottom, { x: p.x - font.widthOfTextAtSize(bottom, size * 0.8) / 2, y: p.y - 17 * s, size: size * 0.8, font, color: red });
      first = false;
    }
  }
  }
  if (!pagesAdded) throw new Error("This answer sheet has no pages that can be marked (old PDF upload). Re-upload it as photos or PDF to get a marked copy.");
  const out = await doc.save();
  return new Blob([out as unknown as BlobPart], { type: "application/pdf" });
}
