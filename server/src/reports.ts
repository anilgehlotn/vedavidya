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
  no: number; id: string; topic: string; text: string; type: string; max: number; got: number; attempted: boolean;
  mistake: string; mistake_note: string; feedback: string; transcription: string; confidence: string;
  steps: { step: string; max_marks: number; awarded: number; comment: string }[];
}
interface TopicScore { topic: string; got: number; max: number; pct: number }
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
  const topics = new Map<string, { got: number; max: number }>();
  const lost: Record<string, number> = {};
  const rows: QReview[] = questions.map((q, i) => {
    const e = byId.get(q.id) as (SheetEvaluation["questions"][number] & { mistake_type?: string; mistake_note?: string }) | undefined;
    const got = e?.marks_awarded ?? 0;
    const attempted = e?.attempted ?? false;
    const topic = (q.topic || "Other").trim() || "Other";
    const t = topics.get(topic) ?? { got: 0, max: 0 };
    t.got += Math.max(0, got); t.max += q.marks; topics.set(topic, t);
    const gap = Math.max(0, q.marks - Math.max(0, got));
    const mistake = gap <= 0 ? "none" : !attempted ? "not_attempted" : e?.mistake_type && e.mistake_type !== "none" && MISTAKES[e.mistake_type] ? e.mistake_type : "unclassified";
    if (gap > 0) lost[mistake] = (lost[mistake] ?? 0) + gap;
    return { no: i + 1, id: q.id, topic, text: q.text, type: q.type, max: q.marks, got, attempted, mistake, mistake_note: gap > 0 ? e?.mistake_note ?? "" : "",
      feedback: e?.feedback ?? "", transcription: e?.transcription ?? "", confidence: e?.confidence ?? "high", steps: e?.steps ?? [] };
  });
  const topicList = [...topics.entries()].map(([topic, t]) => ({ topic, got: round1(t.got), max: t.max, pct: pctOf(t.got, t.max) }));
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
function mistakeBars(doc: Doc, lost: Record<string, number>, unit: string) {
  const entries = Object.entries(lost).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (!total) { txt(doc, "No marks lost. Excellent work!", { color: C.green }); return; }
  for (const [k, v] of entries) {
    need(doc, 26);
    const m = MISTAKES[k] ?? MISTAKES.unclassified, y = doc.y, share = Math.round((v / total) * 100);
    txt(doc, m.label, { font: "B", size: 8.5, x: L, y, width: 150 });
    bar(doc, L + 150, y + 3, W - 260, share, m.color, 7);
    txt(doc, `${round1(v)} ${unit} · ${share}%`, { size: 8, color: C.ink2, x: L + W - 100, y, width: 100, align: "right" });
    doc.y = y + 18;
  }
  const top = MISTAKES[entries[0][0]];
  if (top?.tip) callout(doc, `Biggest fix: ${top.label.toLowerCase()}. ${top.tip}`, C.soft);
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

// ---------------------------------------------------------------- student report

function drawStudent(doc: Doc, r: TestReport, s: StudentResult) {
  banner(doc, r.org, "Student report card", r.test.title, metaLine(r));
  txt(doc, s.name, { font: "B", size: 18 });
  txt(doc, [s.roll ? `Roll no. ${s.roll}` : null, s.batch].filter(Boolean).join("  ·  "), { size: 9, color: C.ink2 });
  doc.y += 10;
  const vs = s.pct - r.classAvg;
  tiles(doc, [
    ["Score", `${s.score} / ${s.max}`],
    ["Percentage", `${s.pct}%`, statusOf(s.pct).label],
    ["Rank in class", `${s.rank} of ${r.results.length}`],
    ["Class average", `${r.classAvg}%`, vs === 0 ? "Same as class" : `You are ${Math.abs(vs)}% ${vs > 0 ? "above" : "below"}`],
  ]);

  // Topics
  heading(doc, "Topic-wise performance", `Strong: ${STRONG}% or more  ·  Needs practice: ${WEAK}–${STRONG - 1}%  ·  Weak: below ${WEAK}%`);
  const topics = [...s.topics].sort((a, b) => a.pct - b.pct);
  table(doc, [{ label: "Topic", width: 150 }, { label: "Marks", width: 60, align: "right" }, { label: "Your score", width: 130 }, { label: "Class", width: 55, align: "right" }, { label: "Status", width: W - 395 }],
    topics.map((t) => { const st = statusOf(t.pct); return [{ text: t.topic, font: "B" }, `${t.got} / ${t.max}`, { text: `${t.pct}%`, bar: { pct: t.pct, color: st.color } }, `${r.topicAvg.get(t.topic) ?? 0}%`, { text: st.label, pill: { color: st.color, bg: st.bg } }]; }));

  // Strong / weak summary
  const weak = topics.filter((t) => t.pct < WEAK).map((t) => `${t.topic} (${t.pct}%)`);
  const mid = topics.filter((t) => t.pct >= WEAK && t.pct < STRONG).map((t) => `${t.topic} (${t.pct}%)`);
  const strong = [...topics].reverse().filter((t) => t.pct >= STRONG).map((t) => `${t.topic} (${t.pct}%)`);
  const colW = (W - 10) / 2;
  const boxH = (items: string[]) => items.reduce((h, it) => h + hOf(doc, it, colW - 32, 8.5) + 2, 0);
  const left = [...weak, ...mid.map((m) => `${m} - practise more`), ...(s.ev.gaps ?? []).map((g) => clean(g, 120))].slice(0, 10);
  const right = [...strong, ...(s.ev.strengths ?? []).map((g) => clean(g, 120))].slice(0, 10);
  const h = Math.max(boxH(left.length ? left : ["-"]), boxH(right.length ? right : ["-"])) + 34;
  need(doc, h + 10);
  doc.y += 4;
  const y = doc.y;
  doc.roundedRect(L, y, colW, h, 8).fill(C.redSoft);
  doc.roundedRect(L + colW + 10, y, colW, h, 8).fill(C.greenSoft);
  txt(doc, "Needs work", { font: "B", size: 10, color: C.red, x: L + 12, y: y + 10, width: colW - 24 });
  txt(doc, "Good at", { font: "B", size: 10, color: C.green, x: L + colW + 22, y: y + 10, width: colW - 24 });
  doc.y = y + 28; bullets(doc, left.length ? left : ["Nothing major - keep it up!"], C.red, L + 12, colW - 20);
  doc.y = y + 28; bullets(doc, right.length ? right : ["Keep practising to build a strong topic."], C.green, L + colW + 22, colW - 20);
  doc.y = y + h + 4;

  heading(doc, "Where the marks were lost", "Every lost mark is tagged with the reason");
  mistakeBars(doc, s.lost, "marks");
  if (s.ev.overall_feedback) { heading(doc, "Overall feedback"); txt(doc, clean(s.ev.overall_feedback, 1500), { size: 9, color: C.ink2 }); }

  // Action plan
  heading(doc, "Your action plan");
  const plan: string[] = [];
  for (const t of topics.filter((t) => t.pct < STRONG).slice(0, 3))
    plan.push(`Revise ${t.topic}: you scored ${t.pct}% (class average ${r.topicAvg.get(t.topic) ?? 0}%). Re-read the chapter, then solve 5 questions on it.`);
  const topMistake = Object.entries(s.lost).sort((a, b) => b[1] - a[1])[0];
  if (topMistake && MISTAKES[topMistake[0]]?.tip) plan.push(`${MISTAKES[topMistake[0]].label}: ${MISTAKES[topMistake[0]].tip}`);
  plan.push("Open your Fix-it practice in the Veda Vidya app: questions made from your own mistakes, with instant answers.");
  bullets(doc, plan.map((p, i) => `${i + 1}.  ${p}`), C.coral, L, W, false);

  // Question by question
  doc.addPage();
  heading(doc, "Question-by-question review", `${s.questions.length} questions  ·  ${s.score} / ${s.max} marks`);
  for (const q of s.questions) drawQuestion(doc, q);
}

function drawQuestion(doc: Doc, q: QReview) {
  const full = q.got >= q.max, zero = q.got <= 0;
  const color = full ? C.green : zero ? C.red : C.amber, bg = full ? C.greenSoft : zero ? C.redSoft : C.amberSoft;
  const text = clean(q.text, 700);
  need(doc, 34 + Math.min(80, hOf(doc, text, W - 20, 8.5)));
  const y = doc.y + 4;
  doc.roundedRect(L, y, W, 22, 6).fill(C.soft);
  txt(doc, `Q${q.no}`, { font: "B", size: 10, x: L + 10, y: y + 6, width: 40 });
  let x = L + 44;
  x += pill(doc, x, y + 4.5, clean(q.topic, 40), C.ink2, "#fff") + 6;
  if (q.mistake !== "none" && MISTAKES[q.mistake]) x += pill(doc, x, y + 4.5, MISTAKES[q.mistake].label, MISTAKES[q.mistake].color, "#fff") + 6;
  if (q.confidence === "low") pill(doc, x, y + 4.5, "Handwriting unclear - checked", C.amber, C.amberSoft);
  doc.roundedRect(L + W - 70, y + 3, 62, 16, 8).fill(bg);
  txt(doc, `${round1(q.got)} / ${q.max}`, { font: "B", size: 9, color, x: L + W - 70, y: y + 6, width: 62, align: "center" });
  doc.y = y + 28;
  txt(doc, text, { size: 8.5, x: L + 10, width: W - 20 });
  const block = (label: string, body: string, c = C.ink2) => {
    if (!body) return;
    const h = hOf(doc, `${label} ${body}`, W - 20, 8.5);
    need(doc, Math.min(h, 60) + 6);
    doc.y += 3;
    doc.font("B").fontSize(8.5).fillColor(C.ink).text(`${label} `, L + 10, doc.y, { width: W - 20, continued: true, lineGap: 1.5 });
    doc.font("R").fillColor(c).text(body, { width: W - 20, lineGap: 1.5 });
  };
  block("Answer written:", q.attempted ? clean(q.transcription, 500) : "Not attempted");
  if (q.steps.length) {
    for (const st of q.steps) {
      const line = `${clean(st.step, 160)}${st.comment ? ` - ${clean(st.comment, 200)}` : ""}`;
      const h = hOf(doc, line, W - 90, 8);
      need(doc, h + 4);
      const y2 = doc.y + 2;
      txt(doc, `•  ${line}`, { size: 8, color: C.ink2, x: L + 16, y: y2, width: W - 90 });
      txt(doc, `${round1(st.awarded)}/${st.max_marks}`, { font: "B", size: 8, x: L + W - 60, y: y2, width: 50, align: "right", color: st.awarded >= st.max_marks ? C.green : st.awarded > 0 ? C.amber : C.red });
      doc.y = Math.max(doc.y, y2 + h);
    }
  }
  if (q.mistake_note) block("Mistake:", clean(q.mistake_note, 400), C.red);
  block("Feedback:", clean(q.feedback, 600));
  doc.y += 6;
}

export function studentReportPdf(r: TestReport, attemptIds: string[]): Doc {
  const list = r.results.filter((s) => attemptIds.includes(s.attemptId)).sort((a, b) => (Number(a.roll) || 1e9) - (Number(b.roll) || 1e9) || a.name.localeCompare(b.name));
  const doc = newDoc(list.length === 1 ? `${list[0].name} - ${r.test.title}` : `${r.test.title} - student reports`);
  list.forEach((s, i) => { if (i) doc.addPage(); drawStudent(doc, r, s); });
  footers(doc, `${r.org} · ${r.test.title} · Student report card · Marked with Veda Vidya`);
  return doc;
}

// ---------------------------------------------------------------- class report

export function classReportPdf(r: TestReport): Doc {
  const doc = newDoc(`${r.test.title} - class report`);
  banner(doc, r.org, "Class performance report", r.test.title, metaLine(r));
  const res = r.results, n = res.length;
  const pcts = res.map((s) => s.pct).sort((a, b) => a - b);
  const median = n ? (n % 2 ? pcts[(n - 1) / 2] : Math.round((pcts[n / 2 - 1] + pcts[n / 2]) / 2)) : 0;
  tiles(doc, [
    ["Students", String(n + r.unmarked.length), r.unmarked.length ? `${r.unmarked.length} not marked / absent` : "All marked"],
    ["Class average", `${r.classAvg}%`],
    ["Median", `${median}%`],
    ["Highest", n ? `${pcts[n - 1]}%` : "-"],
    ["Lowest", n ? `${pcts[0]}%` : "-"],
  ]);
  if (!n) { txt(doc, "No answer sheets have been marked for this test yet.", { color: C.muted }); footers(doc, `${r.org} · ${r.test.title} · Class report`); return doc; }

  // Distribution
  heading(doc, "How the class scored");
  const bands: [string, number, number, string][] = [["90–100%", 90, 101, C.green], ["75–89%", 75, 90, "#3aa66b"], ["50–74%", 50, 75, C.amber], ["33–49%", 33, 50, "#e08a2b"], ["Below 33%", -1, 33, C.red]];
  for (const [label, lo, hi, color] of bands) {
    const c = res.filter((s) => s.pct >= lo && s.pct < hi).length, y = doc.y;
    need(doc, 18);
    txt(doc, label, { font: "B", size: 8.5, x: L, y, width: 80 });
    bar(doc, L + 80, y + 3, W - 170, (c / n) * 100, color, 8);
    txt(doc, `${c} student${c === 1 ? "" : "s"}`, { size: 8.5, color: C.ink2, x: L + W - 80, y, width: 80, align: "right" });
    doc.y = y + 17;
  }

  // Topics
  const topics = [...r.topicAvg.keys()].map((topic) => {
    const scored = res.map((s) => ({ s, t: s.topics.find((x) => x.topic === topic) })).filter((x) => x.t);
    const weak = scored.filter((x) => x.t!.pct < WEAK).map((x) => x.s);
    return { topic, avg: r.topicAvg.get(topic) ?? 0, weak, share: scored.length ? Math.round((weak.length / scored.length) * 100) : 0, max: scored[0]?.t?.max ?? 0 };
  }).sort((a, b) => b.share - a.share || a.avg - b.avg);
  const action = (share: number) => share >= 80 ? { label: "Re-teach: almost everyone", color: "#fff", bg: C.red }
    : share >= 50 ? { label: "Re-teach to whole class", color: C.red, bg: C.redSoft }
    : share >= 25 ? { label: "Small-group revision", color: C.amber, bg: C.amberSoft } : { label: "On track", color: C.green, bg: C.greenSoft };
  heading(doc, "Topics to re-teach", `A student is weak in a topic when they score below ${WEAK}% on it. Sorted by how many students are weak.`);
  table(doc, [{ label: "Topic", width: 150 }, { label: "Marks", width: 45, align: "right" }, { label: "Class average", width: 120 }, { label: "Weak students", width: 85, align: "right" }, { label: "Action", width: W - 400 }],
    topics.map((t) => { const a = action(t.share); return [{ text: t.topic, font: "B" }, String(t.max), { text: `${t.avg}%`, bar: { pct: t.avg, color: statusOf(t.avg).color } }, `${t.weak.length} of ${n} (${t.share}%)`, { text: a.label, pill: { color: a.color, bg: a.bg } }]; }));
  const reteach = topics.filter((t) => t.share >= 50);
  callout(doc, reteach.length
    ? `Most of the class is weak in: ${reteach.map((t) => `${t.topic} (${t.share}% of students)`).join(", ")}. Re-teach ${reteach.length > 1 ? "these topics" : "this topic"} to the whole class before moving on.`
    : "No topic has a majority of weak students. Use small-group revision for the students listed below.", reteach.length ? C.redSoft : C.greenSoft);

  heading(doc, "Students to support, topic by topic", "Group these students for remedial classes or extra practice");
  for (const t of topics.filter((t) => t.weak.length)) {
    const names = t.weak.sort((a, b) => (Number(a.roll) || 1e9) - (Number(b.roll) || 1e9)).map((s) => `${s.roll ? `${s.roll}. ` : ""}${s.name} (${s.topics.find((x) => x.topic === t.topic)?.pct ?? 0}%)`).join(",  ");
    const body = `${t.topic}  -  ${t.weak.length} student${t.weak.length === 1 ? "" : "s"}`;
    need(doc, hOf(doc, names, W - 10, 8) + 22);
    txt(doc, body, { font: "B", size: 9 });
    txt(doc, names, { size: 8, color: C.ink2, x: L + 10, width: W - 10 });
    doc.y += 5;
  }

  // Questions
  heading(doc, "Question analysis", "Class average on each question and the most common reason marks were lost");
  const qrows = r.questions.map((q, i) => {
    const got = res.map((s) => s.questions[i]);
    const avg = Math.round((got.reduce((t, x) => t + Math.max(0, x.got), 0) / (n * q.marks || 1)) * 100);
    const attempted = Math.round((got.filter((x) => x.attempted).length / n) * 100);
    const counts: Record<string, number> = {};
    for (const x of got) if (x.mistake !== "none") counts[x.mistake] = (counts[x.mistake] ?? 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return [{ text: `Q${i + 1}`, font: "B" as const }, clean(q.topic || "Other", 40), String(q.marks), { text: `${avg}%`, bar: { pct: avg, color: statusOf(avg).color } }, `${attempted}%`,
      top ? `${MISTAKES[top[0]]?.label ?? "Other"} (${top[1]})` : "-"] as Cell[];
  });
  table(doc, [{ label: "Q", width: 32 }, { label: "Topic", width: 120 }, { label: "Marks", width: 40, align: "right" }, { label: "Class average", width: 120 }, { label: "Attempted", width: 58, align: "right" }, { label: "Most common mistake", width: W - 370 }], qrows);

  heading(doc, "Why the class lost marks");
  const lost: Record<string, number> = {};
  for (const s of res) for (const [k, v] of Object.entries(s.lost)) lost[k] = (lost[k] ?? 0) + v;
  mistakeBars(doc, lost, "marks");

  if (r.brief) {
    heading(doc, "Re-teach brief", "Written by AI from the class's actual answers");
    if (r.brief.summary) txt(doc, clean(r.brief.summary, 800), { size: 9, color: C.ink2 });
    for (const m of r.brief.misconceptions ?? []) {
      need(doc, 90);
      doc.y += 6;
      txt(doc, `${clean(m.title, 120)}  (${m.students_affected} students)`, { font: "B", size: 9.5 });
      bullets(doc, [`What students think: ${clean(m.explanation, 400)}`, `Example from the class: ${clean(m.example, 300)}`, `10-minute re-teach: ${clean(m.reteach_plan, 500)}`, `Check question: ${clean(m.check_question, 300)}`], C.coral);
    }
    if (r.brief.next_steps?.length) { doc.y += 4; txt(doc, "Next steps", { font: "B", size: 9.5 }); bullets(doc, r.brief.next_steps.map((x) => clean(x, 300)), C.coral); }
  }

  // Students
  need(doc, 160);
  heading(doc, "Every student at a glance", `Ranked by score. Weak: below ${WEAK}% on a topic. Strong: ${STRONG}% or more. Red names scored below 40% overall.`);
  table(doc, [{ label: "Rank", width: 34, align: "right" }, { label: "Roll", width: 34 }, { label: "Student", width: 105 }, { label: "Score", width: 52, align: "right" }, { label: "%", width: 36, align: "right" }, { label: "Weak in", width: (W - 261) * 0.58 }, { label: "Strong in", width: (W - 261) * 0.42 }],
    res.map((s) => [String(s.rank), s.roll ?? "-", { text: s.name, font: "B", color: s.pct < 40 ? C.red : C.ink }, `${s.score}/${s.max}`, { text: `${s.pct}%`, color: statusOf(s.pct).color, font: "B" },
      { text: s.topics.filter((t) => t.pct < WEAK).sort((a, b) => a.pct - b.pct).map((t) => t.topic).join(", ") || "-", color: C.red },
      { text: s.topics.filter((t) => t.pct >= STRONG).sort((a, b) => b.pct - a.pct).map((t) => t.topic).join(", ") || "-", color: C.green }]), { size: 8 });
  if (r.unmarked.length) {
    heading(doc, "Not marked", "Absent, or the answer sheet hasn't been uploaded / marked yet");
    txt(doc, r.unmarked.map((u) => `${u.roll ? `${u.roll}. ` : ""}${u.name}`).join(",  "), { size: 8.5, color: C.ink2 });
  }
  footers(doc, `${r.org} · ${r.test.title} · Class report · ${r.test.published ? "Results published" : "Results not yet published"}`);
  return doc;
}

export const pdfName = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join("_").replace(/[^\w-]+/g, "_").replace(/_+/g, "_").slice(0, 120) + ".pdf";
