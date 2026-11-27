// Draws realistic-looking handwritten answer sheets for the demo institute: A4 ruled paper, a filled-in header,
// and each answer written in blue ink with the Kalam handwriting font (bundled, OFL). Returns the page images and
// where every answer sits, so the marked sheet can put ticks, circled marks and notes in the right places.
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const FONT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../assets/fonts/Kalam-Regular.ttf");
const W = 1240, H = 1754;            // A4 at 150 dpi
const RULE = 58, FIRST_RULE = 330;   // ruled lines
const MARGIN_X = 150, TEXT_X = 175, BOTTOM = H - 110;

export interface WrittenLine { text: string; note?: string; mark?: "cross" | "partial" | "note" }
export interface WrittenAnswer { qid: string; label: string; lines: WrittenLine[] }
export interface Placed {
  location: { page: number; top: number; bottom: number; mark_x: number; mark_y: number };
  annotations: { page: number; bbox: { x: number; y: number; w: number; h: number }; text: string; mark: "tick" | "cross" | "partial" | "note" }[];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
async function ink(text: string, size: number, color: string, tilt: number) {
  const img = await sharp({ text: { text: `<span foreground="${color}">${esc(text)}</span>`, font: `Kalam ${size}`, fontfile: FONT, rgba: true, dpi: 72 } }).png().toBuffer();
  const rotated = await sharp(img).rotate(tilt, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const m = await sharp(rotated).metadata();
  return { input: rotated, width: m.width ?? 0, height: m.height ?? 0 };
}

function paper(pageNo: number, pages: number) {
  const rules = Array.from({ length: Math.floor((BOTTOM - FIRST_RULE) / RULE) + 1 }, (_, i) => FIRST_RULE + i * RULE)
    .map((y) => `<line x1="60" y1="${y}" x2="${W - 60}" y2="${y}" stroke="#c9d6ee" stroke-width="2"/>`).join("");
  const header = pageNo === 0 ? `<rect x="60" y="70" width="${W - 120}" height="170" fill="none" stroke="#9aa7c4" stroke-width="2" rx="6"/>
    <line x1="60" y1="155" x2="${W - 60}" y2="155" stroke="#9aa7c4" stroke-width="1.5"/><line x1="760" y1="70" x2="760" y2="240" stroke="#9aa7c4" stroke-width="1.5"/>` : "";
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#fffdf6"/>
    ${rules}<line x1="${MARGIN_X - 12}" y1="40" x2="${MARGIN_X - 12}" y2="${H - 40}" stroke="#f2a7a0" stroke-width="2.5"/>${header}
    <text x="${W - 90}" y="${H - 50}" font-size="22" fill="#9aa7c4" text-anchor="end">${pageNo + 1} / ${pages}</text></svg>`);
}

/** Renders one student's sheet. `rand` gives the small wobbles (pass a seeded generator for repeatable images). */
export async function renderSheet(student: { name: string; roll: string }, header: { subject: string; test: string }, answers: WrittenAnswer[], rand: () => number) {
  type Item = { page: number; input: Buffer; top: number; left: number };
  const items: Item[] = [];
  const placed: Record<string, Placed> = {};
  const blue = () => (rand() < 0.5 ? "#1f2f86" : "#22358f");
  // Header (first page): labels in grey print, the student's details in their handwriting.
  const labels: [string, number, number][] = [["Name", 80, 82], ["Roll No.", 780, 82], ["Subject", 80, 167], ["Test", 780, 167]];
  for (const [l, x, y] of labels) items.push({ page: 0, ...(await ink(l, 22, "#7b86a3", 0)), top: y, left: x });
  const filled: [string, number, number][] = [[student.name, 90, 108], [student.roll, 790, 108], [header.subject, 90, 193], [header.test, 790, 193]];
  for (const [t, x, y] of filled) { const g = await ink(t, 34, blue(), (rand() - 0.5) * 1.2); items.push({ page: 0, input: g.input, top: y, left: x + Math.round(rand() * 12) }); }

  let page = 0, line = 0;
  const yOf = (n: number) => FIRST_RULE + n * RULE;
  for (const ans of answers) {
    if (!ans.lines.length) continue;
    // Keep a short answer together on one page.
    if (yOf(line + Math.min(ans.lines.length, 4)) > BOTTOM) { page++; line = 0; }
    const qLabel = await ink(ans.label, 36, blue(), (rand() - 0.5) * 1.5);
    const drawn: { page: number; top: number; base: number; endX: number; mid: number }[] = [];
    const annotations: Placed["annotations"] = [];
    for (const [i, ln] of ans.lines.entries()) {
      if (yOf(line + 1) > BOTTOM) { page++; line = 0; }
      const base = yOf(line + 1);
      if (i === 0) items.push({ page, input: qLabel.input, top: base - qLabel.height + 6, left: MARGIN_X - 4 });
      const g = await ink(ln.text, 34 + Math.round(rand() * 4), blue(), (rand() - 0.5) * 1.6);
      const left = TEXT_X + 70 + Math.round(rand() * 24) + (i ? 20 : 0);
      const y = base - g.height + 8;
      items.push({ page, input: g.input, top: y, left });
      drawn.push({ page, top: y, base: base + 6, endX: left + g.width, mid: base - g.height / 2 });
      if (ln.note) annotations.push({ page: page + 1, bbox: { x: left / W, y: y / H, w: Math.min(g.width, W - left - 60) / W, h: g.height / H }, text: ln.note, mark: ln.mark ?? "cross" });
      line++;
    }
    line++; // a blank line between answers
    // The tick goes after the last line, on the page where the answer ends (like a teacher marks it).
    const last = drawn[drawn.length - 1], onLast = drawn.filter((d) => d.page === last.page);
    placed[ans.qid] = {
      location: { page: last.page + 1, top: Math.max(0, Math.min(...onLast.map((d) => d.top)) - 10) / H, bottom: Math.min(H, Math.max(...onLast.map((d) => d.base))) / H,
        mark_x: Math.min(0.84, (last.endX + 40) / W), mark_y: last.mid / H },
      annotations,
    };
  }
  const pages = page + 1;
  const out: Buffer[] = [];
  for (let p = 0; p < pages; p++) {
    out.push(await sharp(paper(p, pages)).composite(items.filter((i) => i.page === p).map(({ input, top, left }) => ({ input, top: Math.max(0, Math.round(top)), left: Math.round(left) })))
      .jpeg({ quality: 82 }).toBuffer());
  }
  return { pages: out, placed };
}
