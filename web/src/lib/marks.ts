// Where to draw a teacher-style correction on each answer-sheet page: a tick or cross at the end of each
// answer, the marks circled in the right margin, and the total circled at the top of the first page.
// Shared by the on-screen marked sheet and the downloadable marked copy, so both look the same.
import type { Section, SheetEvaluation } from "./types";

export type MarkKind = "tick" | "half" | "cross";
export interface Mark { qid: string; kind: MarkKind; x: number; y: number }
export interface Circle { qid: string; text: string; x: number; y: number }
export interface Box { qid: string; top: number; bottom: number }
/** A short correction note (red margin text) and the bit of working it refers to (underlined). */
export interface Note { qid: string; text: string; x: number; y: number; w: number; h: number; kind: "tick" | "cross" | "partial" | "note" }
export interface PageMarks { marks: Mark[]; circles: Circle[]; boxes: Box[]; notes: Note[] }

const clamp = (v: unknown, lo: number, hi: number, dflt: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);
export const fmtMarks = (n: number) => (Math.round(n * 2) / 2).toString();

/** Marks per page (0-based page index). Questions without a location are left off the sheet.
 *  Like a teacher, a block of objective questions (MCQ / numerical) on a page gets one circled subtotal
 *  instead of a circle on every answer; written answers get their own circled marks in the margin. */
export function layoutMarks(ev: SheetEvaluation | null, pageCount: number, sections: Section[] = []): PageMarks[] {
  const objectiveSection = new Map<string, string>();
  sections.forEach((sec, i) => {
    if (sec.questions.length > 1 && sec.questions.every((q) => q.type === "mcq" || q.type === "numeric"))
      for (const q of sec.questions) objectiveSection.set(q.id, `s${i}`);
  });
  const groups = new Map<string, { page: number; ys: number[]; xs: number[]; total: number; first: string }>();
  const pages: PageMarks[] = Array.from({ length: pageCount }, () => ({ marks: [], circles: [], boxes: [], notes: [] }));
  for (const q of ev?.questions ?? []) {
    for (const a of q.attempted ? q.annotations ?? [] : []) {
      const pg = Math.round(a.page) - 1;
      if (pg < 0 || pg >= pageCount || !a.text?.trim() || a.mark === "tick") continue;
      pages[pg].notes.push({ qid: q.question_id, text: a.text.trim().slice(0, 60), kind: a.mark,
        x: clamp(a.bbox?.x, 0, 0.95, 0.1), y: clamp(a.bbox?.y, 0, 0.97, 0.5), w: clamp(a.bbox?.w, 0.02, 1, 0.3), h: clamp(a.bbox?.h, 0.005, 0.5, 0.03) });
    }
    const loc = q.location;
    const page = Math.round(loc?.page ?? 0) - 1;
    if (!loc || page < 0 || page >= pageCount || !q.attempted) continue;
    const kind: MarkKind = q.marks_awarded >= q.max_marks ? "tick" : q.marks_awarded <= 0 ? "cross" : "half";
    const y = clamp(loc.mark_y, 0.02, 0.98, clamp(loc.bottom, 0, 1, 0.5));
    pages[page].marks.push({ qid: q.question_id, kind, x: clamp(loc.mark_x, 0.04, 0.84, 0.8), y });
    const top = clamp(loc.top, 0, 1, y - 0.03), bottom = clamp(loc.bottom, top, 1, y + 0.02);
    pages[page].boxes.push({ qid: q.question_id, top, bottom });
    const grp = objectiveSection.get(q.question_id);
    if (grp) {
      const k = `${grp}:${page}`;
      const g = groups.get(k) ?? { page, ys: [], xs: [], total: 0, first: q.question_id };
      g.ys.push(y); g.xs.push(clamp(loc.mark_x, 0, 1, 0.5)); g.total += q.marks_awarded; groups.set(k, g);
    } else pages[page].circles.push({ qid: q.question_id, text: fmtMarks(q.marks_awarded), x: 0.92, y: (top + bottom) / 2 });
  }
  // Unattempted objective questions still count (as 0) toward the section, so nothing to add for them.
  for (const g of groups.values()) {
    const mid = (Math.min(...g.ys) + Math.max(...g.ys)) / 2;
    pages[g.page].circles.push({ qid: g.first, text: fmtMarks(g.total), x: Math.min(0.8, Math.max(...g.xs) + 0.12), y: mid });
  }
  // Keep circled marks from overlapping each other (and the total on the first page).
  pages.forEach((p, i) => {
    const margin = p.circles.filter((c) => c.x >= 0.9).sort((a, b) => a.y - b.y);
    let last = i === 0 ? 0.16 : -1;
    for (const c of margin) { c.y = Math.min(0.97, Math.max(c.y, last + 0.06)); last = c.y; }
  });
  return pages;
}

/** True when at least one answer has a position, i.e. the sheet was marked with positions. */
export const hasPositions = (ev: SheetEvaluation | null) => Boolean(ev?.questions.some((q) => (q.location?.page ?? 0) > 0));
