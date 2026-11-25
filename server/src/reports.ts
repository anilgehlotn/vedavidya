// PDF reports: a detailed report card for each student and a class report for teachers.
// Both are built from the marked answer sheets (per-question marks, topics, mistake types and feedback).
import PDFDocument from "pdfkit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { all, json, one } from "./db.js";
import type { Question, Section, SheetEvaluation, ReteachBrief } from "./ai/schemas.js";

const FONTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fonts");
const C = { ink: "#17171c", ink2: "#55555f", muted: "#8b8b96", line: "#e4e4ea", soft: "#f4f4f7", coral: "#ff6a4c", coralDark: "#e4522f", coralSoft: "#ffece6",
  green: "#12804e", greenSoft: "#e3f5ea", amber: "#a66500", amberSoft: "#fff3d1", red: "#e0452b", redSoft: "#fdebe6", blue: "#1f6fd1", violet: "#7b61ff" };

export const MISTAKES: Record<string, { label: string; color: string; tip: string }> = {
  concept: { label: "Concept not clear", color: C.red, tip: "Re-learn the idea, then try 3 fresh questions on it." },
  careless: { label: "Careless slip", color: C.amber, tip: "Slow down and re-check signs, units and arithmetic before moving on." },
  incomplete: { label: "Incomplete steps", color: C.violet, tip: "Write every step. Most marks are given for the working, not just the answer." },
  presentation: { label: "Presentation", color: C.blue, tip: "Show the formula, label diagrams and end with a clear final statement." },
  not_attempted: { label: "Not attempted", color: C.muted, tip: "Plan your time: attempt every question, even partly, to pick up step marks." },
  unclassified: { label: "Other", color: "#b9b9c2", tip: "" },
};
/** A topic below this percentage counts as weak; at or above STRONG as strong. */
export const WEAK = 50, STRONG = 75;

// ---------------------------------------------------------------- data

interface QReview {
  no: number; id: string; topic: string; chapter: string; sub: string; text: string; type: string; max: number; got: number; attempted: boolean;
  mistake: string; mistake_note: string; feedback: string; transcription: string; confidence: string;
  steps: { step: string; max_marks: number; awarded: number; comment: string }[];
}
/** Score on one exact sub-topic (or on the chapter, when a question has no sub-topic). `topic` is the unique key. */
interface TopicScore { topic: string; chapter: string; sub: string; got: number; max: number; pct: number }
/** "Sub-topic (Chapter)", or just the chapter. */
export const topicLabel = (t: { chapter: string; sub: string }) => (t.sub ? `${t.sub} (${t.chapter})` : t.chapter);
export interface StudentResult {
  attemptId: string; studentId: string; name: string; roll: string | null; batch: string | null;
  score: number; max: number; pct: number; rank: number; questions: QReview[]; topics: TopicScore[];
  lost: Record<string, number>; ev: SheetEvaluation; reviewed: boolean;
}
export interface TestReport {
  org: string; test: { id: string; title: string; subject: string | null; date: string | null; mode: string; batches: string; published: boolean };
  questions: Question[]; results: StudentResult[]; unmarked: { name: string; roll: string | null; batch: string | null; status: string }[];
  classAvg: number; topicAvg: Map<string, number>; brief: ReteachBrief | null; totalMarks: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const pctOf = (got: number, max: number) => (max > 0 ? Math.round((Math.max(0, got) / max) * 100) : 0);

function analyse(ev: SheetEvaluation, questions: Question[]) {
  const byId = new Map(ev.questions.map((q) => [q.question_id, q]));
  const topics = new Map<string, { got: number; max: number; chapter: string; sub: string }>();
  const lost: Record<string, number> = {};
  const rows: QReview[] = questions.map((q, i) => {
    const e = byId.get(q.id) as (SheetEvaluation["questions"][number] & { mistake_type?: string; mistake_note?: string }) | undefined;
    const got = e?.marks_awarded ?? 0;
    const attempted = e?.attempted ?? false;
    const chapter = (q.topic || "Other").trim() || "Other";
    const sub = String((q as { subtopic?: string }).subtopic ?? "").trim();
    const topic = sub ? `${chapter} › ${sub}` : chapter;
    const t = topics.get(topic) ?? { got: 0, max: 0, chapter, sub };
    t.got += Math.max(0, got); t.max += q.marks; topics.set(topic, t);
    const gap = Math.max(0, q.marks - Math.max(0, got));
    const mistake = gap <= 0 ? "none" : !attempted ? "not_attempted" : e?.mistake_type && e.mistake_type !== "none" && MISTAKES[e.mistake_type] ? e.mistake_type : "unclassified";
    if (gap > 0) lost[mistake] = (lost[mistake] ?? 0) + gap;
    return { no: i + 1, id: q.id, topic, chapter, sub, text: q.text, type: q.type, max: q.marks, got, attempted, mistake, mistake_note: gap > 0 ? e?.mistake_note ?? "" : "",
      feedback: e?.feedback ?? "", transcription: e?.transcription ?? "", confidence: e?.confidence ?? "high", steps: e?.steps ?? [] };
  });
  const topicList = [...topics.entries()].map(([topic, t]) => ({ topic, chapter: t.chapter, sub: t.sub, got: round1(t.got), max: t.max, pct: pctOf(t.got, t.max) }));
  return { rows, topics: topicList, lost };
}

/** Everything both reports need for one test. Returns null if the test isn't in this institute. */
export function loadTestReport(testId: string, orgId: string): TestReport | null {
  const t = one<any>(`SELECT t.*, o.name AS org_name, p.sections, p.total_marks,
      (SELECT group_concat(b.name, ', ') FROM test_batches tb JOIN batches b ON b.id = tb.batch_id WHERE tb.test_id = t.id) AS batch_names
    FROM tests t JOIN orgs o ON o.id = t.org_id LEFT JOIN question_papers p ON p.id = t.paper_id WHERE t.id = ? AND t.org_id = ?`, testId, orgId);
  if (!t) return null;
  const questions = json<Section[]>(t.sections, []).flatMap((s) => s.questions);
  const rows = all<any>(`SELECT a.id, a.status, a.score, a.max_score, a.evaluation, a.reviewed, u.id AS student_id, u.name,
      (SELECT e.roll_no FROM enrollments e JOIN test_batches tb ON tb.batch_id = e.batch_id AND tb.test_id = a.test_id WHERE e.student_id = a.student_id LIMIT 1) AS roll_no,
      (SELECT b.name FROM enrollments e JOIN test_batches tb ON tb.batch_id = e.batch_id AND tb.test_id = a.test_id JOIN batches b ON b.id = e.batch_id WHERE e.student_id = a.student_id LIMIT 1) AS batch
    FROM attempts a JOIN users u ON u.id = a.student_id WHERE a.test_id = ?`, testId);
  const results: StudentResult[] = [];
  const unmarked: TestReport["unmarked"] = [];
  for (const r of rows) {
    const ev = json<SheetEvaluation | null>(r.evaluation, null);
    if (r.score == null || !ev || !questions.length) { unmarked.push({ name: r.name, roll: r.roll_no, batch: r.batch, status: r.status }); continue; }
    const a = analyse(ev, questions);
    results.push({ attemptId: r.id, studentId: r.student_id, name: r.name, roll: r.roll_no, batch: r.batch, score: round1(r.score), max: r.max_score || t.total_marks,
      pct: pctOf(r.score, r.max_score || t.total_marks), rank: 0, questions: a.rows, topics: a.topics, lost: a.lost, ev, reviewed: Boolean(r.reviewed) });
  }
  results.sort((x, y) => y.score - x.score || String(x.name).localeCompare(y.name));
  results.forEach((r, i) => { r.rank = i > 0 && results[i - 1].score === r.score ? results[i - 1].rank : i + 1; });
  const topicAvg = new Map<string, number>();
  for (const topic of new Set(results.flatMap((r) => r.topics.map((x) => x.topic)))) {
    const ps = results.map((r) => r.topics.find((x) => x.topic === topic)?.pct).filter((x): x is number => x != null);
    topicAvg.set(topic, ps.length ? Math.round(ps.reduce((s, x) => s + x, 0) / ps.length) : 0);
  }
  const byRoll = (x: { roll: string | null; name: string }, y: { roll: string | null; name: string }) => (Number(x.roll) || 1e9) - (Number(y.roll) || 1e9) || x.name.localeCompare(y.name);
  unmarked.sort(byRoll);
  return {
    org: t.org_name, totalMarks: t.total_marks ?? 0,
    test: { id: t.id, title: t.title, subject: t.subject || null, date: t.scheduled_at || t.created_at, mode: t.mode, batches: t.batch_names ?? "", published: Boolean(t.results_published) },
    questions, results, unmarked, brief: json<ReteachBrief | null>(t.brief, null),
    classAvg: results.length ? Math.round(results.reduce((s, r) => s + r.pct, 0) / results.length) : 0, topicAvg,
  };
}

// ---------------------------------------------------------------- drawing helpers

type Doc = PDFKit.PDFDocument;
const L = 42, W = 595.28 - 84, BOTTOM = 841.89 - 56;
const clean = (s: unknown, max = 2000) => {
  const t = String(s ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\s+\n/g, "\n").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
};
const fmtDate = (s: string | null) => {
  if (!s) return "";
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z");
  return isNaN(+d) ? "" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
};
const statusOf = (p: number) => (p >= STRONG ? { label: "Strong", color: C.green, bg: C.greenSoft } : p >= WEAK ? { label: "Needs practice", color: C.amber, bg: C.amberSoft } : { label: "Weak", color: C.red, bg: C.redSoft });

function newDoc(title: string): Doc {
  const doc = new PDFDocument({ size: "A4", margins: { top: 48, bottom: 56, left: L, right: L }, bufferPages: true, info: { Title: title, Author: "Veda Vidya" } });
  doc.registerFont("R", path.join(FONTS, "DejaVuSans.ttf"));
  doc.registerFont("B", path.join(FONTS, "DejaVuSans-Bold.ttf"));
  doc.font("R").fontSize(9.5).fillColor(C.ink);
  return doc;
}
/** Starts a new page if fewer than h points are left. */
const need = (doc: Doc, h: number) => { if (doc.y + h > BOTTOM) doc.addPage(); };
const txt = (doc: Doc, s: string, o: { font?: "R" | "B"; size?: number; color?: string; x?: number; y?: number; width?: number; align?: "left" | "right" | "center"; lineGap?: number } = {}) => {
  doc.font(o.font ?? "R").fontSize(o.size ?? 9.5).fillColor(o.color ?? C.ink);
  doc.text(s, o.x ?? L, o.y ?? doc.y, { width: o.width ?? W, align: o.align, lineGap: o.lineGap ?? 1.5 });
};
const hOf = (doc: Doc, s: string, width: number, size = 9.5, font: "R" | "B" = "R") => { doc.font(font).fontSize(size); return doc.heightOfString(s || " ", { width, lineGap: 1.5 }); };

function heading(doc: Doc, title: string, sub?: string) {
  need(doc, 70);
  doc.moveDown(0.9);
  const y = doc.y;
  doc.rect(L, y + 2, 3.5, 13).fill(C.coral);
  txt(doc, title, { font: "B", size: 13, x: L + 11, y });
  if (sub) txt(doc, sub, { size: 8.5, color: C.muted, x: L + 11 });
  doc.y += 6;
}
function bar(doc: Doc, x: number, y: number, w: number, pct: number, color: string, h = 6) {
  doc.roundedRect(x, y, w, h, h / 2).fill(C.soft);
  if (pct > 0) doc.roundedRect(x, y, Math.max(h, (w * Math.min(100, pct)) / 100), h, h / 2).fill(color);
}
function pill(doc: Doc, x: number, y: number, label: string, color: string, bg: string) {
  doc.font("B").fontSize(7.5);
  const w = doc.widthOfString(label) + 12;
  doc.roundedRect(x, y, w, 13, 6.5).fill(bg);
  doc.fillColor(color).text(label, x + 6, y + 2.6, { lineBreak: false });
  return w;
}
function banner(doc: Doc, org: string, kind: string, title: string, meta: string) {
  doc.rect(0, 0, doc.page.width, 92).fill(C.coral);
  txt(doc, org || "Veda Vidya", { font: "B", size: 15, color: "#fff", x: L, y: 24, width: W * 0.6 });
  txt(doc, kind.toUpperCase(), { font: "B", size: 8.5, color: "#fff", x: L, y: 28, align: "right" });
  txt(doc, clean(title, 140), { font: "B", size: 11, color: "#fff", x: L, y: 50, width: W });
  txt(doc, meta, { size: 8.5, color: "#ffe3dc", x: L, y: 67, width: W });
  doc.y = 112;
}
function tiles(doc: Doc, items: [string, string, string?][]) {
  need(doc, 62);
  const gap = 8, w = (W - gap * (items.length - 1)) / items.length, y = doc.y;
  items.forEach(([label, value, sub], i) => {
    const x = L + i * (w + gap);
    doc.roundedRect(x, y, w, 54, 8).fill(C.soft);
    txt(doc, label, { size: 7.5, color: C.muted, x: x + 10, y: y + 8, width: w - 20 });
    txt(doc, value, { font: "B", size: 16, x: x + 10, y: y + 20, width: w - 20 });
    if (sub) txt(doc, sub, { size: 7, color: C.ink2, x: x + 10, y: y + 40, width: w - 20 });
  });
  doc.y = y + 64;
}
interface Col { label: string; width: number; align?: "left" | "right" | "center" }
type Cell = string | { text: string; color?: string; font?: "R" | "B"; bar?: { pct: number; color: string }; pill?: { color: string; bg: string } };
function table(doc: Doc, cols: Col[], rows: Cell[][], opts: { zebra?: boolean; size?: number } = {}) {
  const size = opts.size ?? 8.5, pad = 5;
  const head = () => {
    need(doc, 40);
    const y = doc.y;
    doc.rect(L, y, W, 18).fill(C.ink);
    let x = L;
    for (const c of cols) { txt(doc, c.label, { font: "B", size: 7.5, color: "#fff", x: x + pad, y: y + 5, width: c.width - pad * 2, align: c.align }); x += c.width; }
    doc.y = y + 18;
  };
  head();
  rows.forEach((row, ri) => {
    const cell = (c: Cell) => (typeof c === "string" ? { text: c } : c);
    const h = Math.max(18, ...row.map((c, i) => (cell(c).bar || cell(c).pill ? 18 : hOf(doc, cell(c).text, cols[i].width - pad * 2, size, cell(c).font ?? "R") + 9)));
    if (doc.y + h > BOTTOM) { doc.addPage(); head(); }
    const y = doc.y;
    if (opts.zebra !== false && ri % 2 === 1) doc.rect(L, y, W, h).fill("#fafafc");
    let x = L;
    row.forEach((c0, i) => {
      const c = cell(c0), cw = cols[i].width;
      if (c.bar) { bar(doc, x + pad, y + h / 2 - 3, cw - pad * 2 - 28, c.bar.pct, c.bar.color); txt(doc, c.text, { size: 7.5, x: x + cw - pad - 26, y: y + h / 2 - 4.5, width: 26, align: "right", color: C.ink2 }); }
      else if (c.pill) pill(doc, x + pad, y + h / 2 - 6.5, c.text, c.pill.color, c.pill.bg);
      else txt(doc, c.text, { size, x: x + pad, y: y + 4.5, width: cw - pad * 2, align: cols[i].align, color: c.color, font: c.font });
      x += cw;
    });
    doc.moveTo(L, y + h).lineTo(L + W, y + h).lineWidth(0.5).strokeColor(C.line).stroke();
    doc.y = y + h;
  });
  doc.y += 6;
}
function callout(doc: Doc, s: string, bg: string, color = C.ink) {
  const h = hOf(doc, s, W - 20, 8.5) + 14;
  need(doc, h + 6);
  const y = doc.y + 2;
  doc.roundedRect(L, y, W, h, 6).fill(bg);
  txt(doc, s, { size: 8.5, x: L + 10, y: y + 7, width: W - 20, color });
  doc.y = y + h + 6;
}
function bullets(doc: Doc, items: string[], color = C.ink, x = L, width = W, dot = true) {
  for (const it of items) {
    const h = hOf(doc, it, width - 12, 8.5);
    need(doc, h + 3);
    const y = doc.y;
    if (dot) doc.circle(x + 3, y + 5, 1.6).fill(color);
    txt(doc, it, { size: 8.5, x: dot ? x + 11 : x, y, width: width - 12 });
    doc.y = Math.max(doc.y, y + h) + 2;
  }
}
function footers(doc: Doc, left: string) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.moveTo(L, 841.89 - 38).lineTo(L + W, 841.89 - 38).lineWidth(0.5).strokeColor(C.line).stroke();
    txt(doc, clean(left, 110), { size: 7, color: C.muted, x: L, y: 841.89 - 31, width: W - 80 });
    txt(doc, `Page ${i + 1} of ${range.count}`, { size: 7, color: C.muted, x: L, y: 841.89 - 31, align: "right" });
    doc.page.margins.bottom = bottom;
  }
}
const metaLine = (r: TestReport) => [r.test.subject, r.test.batches, fmtDate(r.test.date), `${r.totalMarks} marks`].filter(Boolean).join("  ·  ");

// ---------------------------------------------------------------- student report (simple)

/** Short list of topics with a percentage, e.g. "Trigonometry 56%". */
const topicLine = (ts: TopicScore[]) => ts.map((t) => `${t.sub || t.chapter} (${t.pct}%)`).join(",  ");
const mainReasons = (lost: Record<string, number>) => {
  const total = Object.values(lost).reduce((a, b) => a + b, 0);
  return Object.entries(lost).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, v]) => `${(MISTAKES[k] ?? MISTAKES.unclassified).label} (${Math.round((v / total) * 100)}%)`);
};

function drawStudent(doc: Doc, r: TestReport, s: StudentResult) {
  banner(doc, r.org, "Student report", r.test.title, metaLine(r));
  txt(doc, s.name, { font: "B", size: 17 });
  txt(doc, [s.roll ? `Roll no. ${s.roll}` : null, s.batch].filter(Boolean).join("  ·  "), { size: 9, color: C.ink2 });
  doc.y += 8;
  tiles(doc, [["Score", `${s.score} / ${s.max}`], ["Percentage", `${s.pct}%`], ["Class average", `${r.classAvg}%`], ["Rank", `${s.rank} of ${r.results.length}`]]);

  // 1. Topics
  const sorted = [...s.topics].sort((a, b) => a.pct - b.pct);
  const focus = sorted.filter((t) => t.pct < STRONG);
  const strong = [...sorted].reverse().filter((t) => t.pct >= STRONG);
  heading(doc, "Topics to focus on", `Exact sub-topics where you scored below ${STRONG}%. Weakest first.`);
  if (focus.length) {
    table(doc, [{ label: "Chapter", width: 110 }, { label: "Exact sub-topic", width: 165 }, { label: "Marks", width: 50, align: "right" }, { label: "Your score", width: 130 }, { label: "Class", width: W - 455, align: "right" }],
      focus.map((t) => [{ text: t.chapter, color: C.ink2 }, { text: t.sub || "-", font: "B", color: t.pct < WEAK ? C.red : C.ink }, `${t.got} / ${t.max}`, { text: `${t.pct}%`, bar: { pct: t.pct, color: statusOf(t.pct).color } }, `${r.topicAvg.get(t.topic) ?? 0}%`]));
  } else txt(doc, "No weak topics in this test. Well done!", { color: C.green });
  if (strong.length) { doc.y += 2; txt(doc, `Good at:  ${topicLine(strong)}`, { size: 9, color: C.green }); }
  const reasons = mainReasons(s.lost);
  if (reasons.length) { doc.y += 4; txt(doc, `Main reasons marks were lost:  ${reasons.join(",  ")}`, { size: 9, color: C.ink2 }); }

  // 2. What went wrong, topic by topic
  heading(doc, "What went wrong", "Each question where marks were lost, grouped by sub-topic");
  const lostQs = s.questions.filter((q) => q.got < q.max);
  if (!lostQs.length) txt(doc, "Full marks on every question.", { color: C.green });
  for (const t of focus.concat(strong)) {
    const qs = lostQs.filter((q) => q.topic === t.topic);
    if (!qs.length) continue;
    need(doc, 60);
    doc.y += 4;
    txt(doc, `${t.sub ? `${t.chapter}  ›  ${t.sub}` : t.chapter}  ·  ${t.pct}%`, { font: "B", size: 10, color: t.pct < WEAK ? C.red : t.pct < STRONG ? C.amber : C.ink });
    doc.y += 2;
    for (const q of qs) {
      const why = q.mistake !== "none" ? (MISTAKES[q.mistake] ?? MISTAKES.unclassified).label : "";
      const detail = [clean(q.mistake_note, 300), clean(q.feedback, 400)].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(" ");
      const line = `Q${q.no}  (${round1(Math.max(0, q.got))}/${q.max})  ${why ? `${why}: ` : ""}${detail || (q.attempted ? "Lost step marks." : "Not attempted.")}`;
      bullets(doc, [line], t.pct < WEAK ? C.red : C.amber, L + 8, W - 8);
    }
  }

  // 3. Next steps
  heading(doc, "What to do next");
  const plan: string[] = focus.slice(0, 3).map((t) => t.sub ? `Revise "${t.sub}" (chapter ${t.chapter}): re-read that part of the chapter and solve 5 questions on it.` : `Revise ${t.chapter}: re-read the chapter and solve 5 questions on it.`);
  const top = Object.entries(s.lost).sort((a, b) => b[1] - a[1])[0];
  if (top && MISTAKES[top[0]]?.tip) plan.push(MISTAKES[top[0]].tip);
  if (s.ev.overall_feedback) plan.push(`Teacher's note: ${clean(s.ev.overall_feedback, 400)}`);
  plan.push("Do your Fix-it practice in the Veda Vidya app - it is made from your own mistakes.");
  bullets(doc, plan.map((p, i) => `${i + 1}.  ${p}`), C.coral, L, W, false);
}

export function studentReportPdf(r: TestReport, attemptIds: string[]): Doc {
  const list = r.results.filter((s) => attemptIds.includes(s.attemptId)).sort((a, b) => (Number(a.roll) || 1e9) - (Number(b.roll) || 1e9) || a.name.localeCompare(b.name));
  const doc = newDoc(list.length === 1 ? `${list[0].name} - ${r.test.title}` : `${r.test.title} - student reports`);
  list.forEach((s, i) => { if (i) doc.addPage(); drawStudent(doc, r, s); });
  footers(doc, `${r.org} · ${r.test.title} · Student report · Marked with Veda Vidya`);
  return doc;
}

// ---------------------------------------------------------------- class report (simple)

export function classReportPdf(r: TestReport): Doc {
  const doc = newDoc(`${r.test.title} - class report`);
  banner(doc, r.org, "Class report", r.test.title, metaLine(r));
  const res = r.results, n = res.length;
  const pcts = res.map((s) => s.pct).sort((a, b) => a - b);
  tiles(doc, [
    ["Class average", `${r.classAvg}%`],
    ["Highest", n ? `${pcts[n - 1]}%` : "-"],
    ["Lowest", n ? `${pcts[0]}%` : "-"],
    ["Students marked", `${n} of ${n + r.unmarked.length}`],
  ]);
  if (!n) { txt(doc, "No answer sheets have been marked for this test yet.", { color: C.muted }); footers(doc, `${r.org} · ${r.test.title} · Class report`); return doc; }

  // Topics
  const topics = [...r.topicAvg.keys()].map((topic) => {
    const scored = res.map((s) => ({ s, t: s.topics.find((x) => x.topic === topic) })).filter((x) => x.t);
    const weak = scored.filter((x) => x.t!.pct < WEAK).map((x) => x.s);
    const { chapter, sub } = scored[0]?.t ?? { chapter: topic, sub: "" };
    return { topic, chapter, sub, label: topicLabel({ chapter, sub }), avg: r.topicAvg.get(topic) ?? 0, weak, share: scored.length ? Math.round((weak.length / scored.length) * 100) : 0 };
  }).sort((a, b) => b.share - a.share || a.avg - b.avg);
  const action = (share: number) => share >= 50 ? { label: "Re-teach class", color: C.red, bg: C.redSoft }
    : share >= 25 ? { label: "Small group", color: C.amber, bg: C.amberSoft } : { label: "Fine", color: C.green, bg: C.greenSoft };
  heading(doc, "Sub-topics the class is weak in", `A student is weak in a sub-topic below ${WEAK}%. Weakest first - re-teach these exact sub-topics.`);
  table(doc, [{ label: "Chapter", width: 100 }, { label: "Exact sub-topic", width: 150 }, { label: "Class average", width: 105 }, { label: "Weak", width: 58, align: "right" }, { label: "What to do", width: W - 413 }],
    topics.map((t) => { const a = action(t.share); return [{ text: t.chapter, color: C.ink2 }, { text: t.sub || "-", font: "B" }, { text: `${t.avg}%`, bar: { pct: t.avg, color: statusOf(t.avg).color } }, `${t.weak.length} of ${n}`, { text: a.label, pill: { color: a.color, bg: a.bg } }]; }));
  const most = topics.filter((t) => t.share >= 50);
  callout(doc, most.length
    ? `Most of the class is weak in: ${most.map((t) => `${t.label} - ${t.share}% of students`).join("; ")}. Re-teach ${most.length > 1 ? "these sub-topics" : "this sub-topic"} before moving on.`
    : `No sub-topic is weak for most of the class. ${topics[0]?.weak.length ? `${topics[0].label} needs the most attention (${topics[0].weak.length} students).` : "The class is on track."}`,
    most.length ? C.redSoft : C.greenSoft);
  const reasons = (() => { const lost: Record<string, number> = {}; for (const s of res) for (const [k, v] of Object.entries(s.lost)) lost[k] = (lost[k] ?? 0) + v; return mainReasons(lost); })();
  if (reasons.length) txt(doc, `Main reasons the class lost marks:  ${reasons.join(",  ")}`, { size: 9, color: C.ink2 });

  heading(doc, "Who needs help in each sub-topic");
  for (const t of topics.filter((t) => t.weak.length)) {
    const names = t.weak.sort((a, b) => (Number(a.roll) || 1e9) - (Number(b.roll) || 1e9)).map((s) => `${s.roll ? `${s.roll}. ` : ""}${s.name}`).join(",  ");
    need(doc, hOf(doc, names, W - 10, 8.5) + 20);
    txt(doc, `${t.label}  -  ${t.weak.length} student${t.weak.length === 1 ? "" : "s"}`, { font: "B", size: 9 });
    txt(doc, names, { size: 8.5, color: C.ink2, x: L + 10, width: W - 10 });
    doc.y += 4;
  }

  // Students
  need(doc, 120);
  heading(doc, "Each student's focus sub-topics", `Sub-topics below ${STRONG}% for each student, weakest first. Names in red scored below 40% overall.`);
  const byRoll = [...res].sort((a, b) => (Number(a.roll) || 1e9) - (Number(b.roll) || 1e9) || a.name.localeCompare(b.name));
  table(doc, [{ label: "Roll", width: 36 }, { label: "Student", width: 120 }, { label: "Score", width: 55, align: "right" }, { label: "%", width: 38, align: "right" }, { label: "Focus on", width: W - 249 }],
    byRoll.map((s) => [s.roll ?? "-", { text: s.name, font: "B", color: s.pct < 40 ? C.red : C.ink }, `${s.score}/${s.max}`, { text: `${s.pct}%`, font: "B", color: statusOf(s.pct).color },
      s.topics.filter((t) => t.pct < STRONG).sort((a, b) => a.pct - b.pct).map((t) => `${t.sub || t.chapter} (${t.pct}%)`).join(", ") || "-"]), { size: 8 });
  if (r.unmarked.length) { doc.y += 2; txt(doc, `Not marked / absent: ${r.unmarked.map((u) => `${u.roll ? `${u.roll}. ` : ""}${u.name}`).join(", ")}`, { size: 8.5, color: C.muted }); }
  footers(doc, `${r.org} · ${r.test.title} · Class report`);
  return doc;
}

export const pdfName = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join("_").replace(/[^\w-]+/g, "_").replace(/_+/g, "_").slice(0, 120) + ".pdf";
