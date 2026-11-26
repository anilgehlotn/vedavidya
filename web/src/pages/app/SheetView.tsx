// The corrected answer sheet: the student's own pages with red ticks, crosses and circled marks drawn on,
// the total circled on the first page, and a side panel with feedback, the question and its solution.
// Used by teachers and students (after publishing) and on the parent's shared report link.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Question, Section, SheetEvaluation } from "../../lib/types";
import { fmtMarks, hasPositions, layoutMarks, type MarkKind } from "../../lib/marks";
import { Modal } from "../../components/ui";
import { MathText } from "../../components/MathText";
import { MISTAKES } from "./Insights";

const TYPE_LABEL: Record<string, string> = { mcq: "MCQ", numeric: "Numerical", short: "Short Answer", long: "Long Answer" };
const LETTERS = ["A", "B", "C", "D", "E", "F"];

export interface SheetViewProps {
  pages: number;
  pageTypes?: string[];
  /** URL for page n (0-based): a blob URL for logged-in users, a plain URL for the public report. */
  loadPage: (n: number) => Promise<string>;
  /** The page as a Blob, for the downloadable marked copy. */
  loadBlob: (n: number) => Promise<Blob>;
  ev: SheetEvaluation;
  questions: Question[];
  /** The paper's sections: a block of MCQs gets one circled subtotal, like a teacher's correction. */
  sections?: Section[];
  score: number;
  max: number;
  title: string;
  answersHidden?: boolean;
  /** Teacher view: shows second-check notes. */
  staff?: boolean;
}

function MarkSvg({ kind }: { kind: MarkKind }) {
  return kind === "cross"
    ? <svg viewBox="-2 -2 22 22"><path d="M0 0 L18 18 M18 0 L0 18" /></svg>
    : <svg viewBox="-2 -2 30 24"><path d="M0 11 L8 20 L26 0" /></svg>;
}

const useWide = () => {
  const q = "(min-width: 1000px)";
  const [wide, setWide] = useState(() => typeof matchMedia !== "undefined" && matchMedia(q).matches);
  useEffect(() => { const m = matchMedia(q); const f = () => setWide(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  return wide;
};

type EvQ = SheetEvaluation["questions"][number];
const tone = (q?: EvQ) => (!q || !q.attempted ? "skip" : q.marks_awarded >= q.max_marks ? "full" : q.marks_awarded <= 0 ? "zero" : "part");

export function SheetView(p: SheetViewProps) {
  const layout = useMemo(() => layoutMarks(p.ev, p.pages, p.sections), [p.ev, p.pages, p.sections]);
  const positioned = hasPositions(p.ev);
  const order = p.questions.map((q) => q.id);
  const evById = useMemo(() => new Map(p.ev.questions.map((q) => [q.question_id, q])), [p.ev]);
  const [sel, setSel] = useState<string>(order[0] ?? "");
  const [smart, setSmart] = useState(true);
  const [modal, setModal] = useState(false);
  const [urls, setUrls] = useState<(string | null)[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const wide = useWide();

  useEffect(() => {
    let alive = true;
    const made: string[] = [];
    Promise.all(Array.from({ length: p.pages }, (_, i) => p.loadPage(i).then((u) => { if (u.startsWith("blob:")) made.push(u); return u; }).catch(() => null)))
      .then((u) => alive && setUrls(u));
    return () => { alive = false; made.forEach((u) => URL.revokeObjectURL(u)); };
  }, [p.pages]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (qid: string, scroll: boolean) => {
    setSel(qid);
    if (!wide) setModal(true);
    const loc = evById.get(qid)?.location;
    const el = loc && loc.page > 0 ? pageRefs.current[loc.page - 1] : null;
    if (scroll && el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY + (loc!.top || 0) * el.offsetHeight - 120, behavior: "smooth" });
  };

  const downloadCopy = async () => {
    setBusy(true); setErr(null);
    try {
      const { markedCopyPdf } = await import("../../lib/markedCopy");
      const blobs = await Promise.all(Array.from({ length: p.pages }, (_, i) => (p.pageTypes?.[i] === "pdf" ? Promise.resolve(null) : p.loadBlob(i).catch(() => null))));
      const pdf = await markedCopyPdf([{ pages: blobs, layout, total: { score: p.score, max: p.max } }], p.title);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(pdf); a.download = `${p.title.replace(/\W+/g, "_")}_marked.pdf`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const panel = <QuestionPanel {...p} qid={sel} index={order.indexOf(sel)} evById={evById} />;

  return (
    <div className="sheet-shell">
      <div className="sheet-bar no-print">
        <div className="q-chips">
          {order.map((id, i) => <button key={id} type="button" className={`q-chip ${tone(evById.get(id))} ${sel === id ? "on" : ""}`} onClick={() => pick(id, true)}>Q{i + 1}</button>)}
        </div>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={downloadCopy}>{busy ? "Preparing…" : "⤓ Marked copy (PDF)"}</button>
      </div>
      {err && <div className="error-box" style={{ margin: "0 16px 12px" }}>{err}</div>}
      {!positioned && p.staff && <div className="small muted" style={{ padding: "0 16px 12px" }}>Ticks and marks appear on sheets marked after this update. Re-mark this sheet to add them.</div>}
      <div className="sheet-view">
        <div className={`sheet-pages ${smart ? "" : "plain"}`}>
          {Array.from({ length: p.pages }, (_, i) => {
            const url = urls[i];
            const isPdf = p.pageTypes?.[i] === "pdf";
            return (
              <div key={i} className="sheet-page" ref={(el) => { pageRefs.current[i] = el; }}>
                {url === undefined ? <div className="sheet-loading"><span className="spinner" /></div>
                  : !url ? <div className="sheet-loading small muted">Page {i + 1} unavailable</div>
                  : isPdf ? <iframe src={url} title={`Page ${i + 1}`} style={{ width: "100%", height: "80vh", border: 0 }} />
                  : <img src={url} alt={`Answer sheet page ${i + 1}`} />}
                {!isPdf && url && <>
                  {layout[i].boxes.filter((b) => b.qid === sel).map((b) => <div key={b.qid} className="mk-box" style={{ top: `${b.top * 100}%`, height: `${Math.max(2, (b.bottom - b.top) * 100)}%` }} />)}
                  {layout[i].marks.map((m) => <span key={`m${m.qid}`} className={`mk mk-${m.kind}`} style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}><MarkSvg kind={m.kind} /></span>)}
                  {layout[i].circles.map((c) => (
                    <span key={`c${c.qid}`} className="mk-wrap" style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}>
                      <button type="button" className={`mk-circle ${sel === c.qid ? "on" : ""}`} onClick={() => pick(c.qid, false)} aria-label={`Question ${order.indexOf(c.qid) + 1}: ${c.text} marks`}>{c.text}</button>
                      <button type="button" className="mk-ai" onClick={() => pick(c.qid, false)} aria-label="Show feedback">✦</button>
                    </span>
                  ))}
                  {i === 0 && <span className="mk-total" style={{ left: "86%", top: "7.5%" }}><b>{fmtMarks(p.score)}</b><i /><b>{fmtMarks(p.max)}</b></span>}
                </>}
              </div>
            );
          })}
        </div>
        {wide ? <aside className="sheet-panel">{panel}</aside> : modal && <Modal title={`Question ${order.indexOf(sel) + 1}`} onClose={() => setModal(false)} wide>{panel}</Modal>}
      </div>
      <label className="smart-toggle no-print">
        <span>Smart Report</span>
        <input type="checkbox" checked={smart} onChange={(e) => setSmart(e.target.checked)} />
        <i aria-hidden />
      </label>
    </div>
  );
}

function QuestionPanel(p: SheetViewProps & { qid: string; index: number; evById: Map<string, EvQ> }) {
  const [tab, setTab] = useState<"feedback" | "question" | "solution">("feedback");
  const q = p.questions.find((x) => x.id === p.qid);
  const e = p.evById.get(p.qid);
  if (!q) return null;
  const pct = e && q.marks ? Math.round((Math.max(0, e.marks_awarded) / q.marks) * 100) : 0;
  const t = tone(e);
  return (
    <div className="panel-inner">
      <div className="panel-title">Question {p.index + 1}</div>
      <div className="panel-tabs">
        {(["feedback", "question", "solution"] as const).map((k) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{k[0].toUpperCase() + k.slice(1)}</button>)}
      </div>
      {tab === "feedback" && (
        <div className="stack" style={{ gap: 14 }}>
          <div className="fb-head">
            <span className={`fb-icon ${t}`}>✎</span>
            <div>
              <b className={`fb-score ${t}`}>{e ? fmtMarks(e.marks_awarded) : 0}/{q.marks} Marks</b>
              <div className="small" style={{ fontWeight: 600 }}>{e?.attempted === false ? "Not attempted" : `${pct}% Score`}</div>
              <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
                <span className="tag">{TYPE_LABEL[q.type] ?? q.type}</span>
                <span className="tag" style={{ textTransform: "capitalize" }}>{q.difficulty}</span>
                {(q.subtopic || q.topic) && <span className="tag muted-tag">{q.subtopic || q.topic}</span>}
              </div>
            </div>
          </div>
          {p.staff && e?.needs_review && <div className="small" style={{ padding: "8px 12px", borderRadius: 10, background: "var(--amber-soft)", color: "var(--amber)" }}>⚠ {e.check_note || "Please check this answer."}</div>}
          {p.staff && e?.second_check === "changed" && <div className="small muted">A second AI check changed this from {e.first_marks} to {fmtMarks(e.marks_awarded)}.</div>}
          {e && e.steps.length > 0 && (
            <div className="panel-card">
              <b>Evaluation Breakdown</b>
              {e.steps.map((st, i) => {
                const k = st.awarded >= st.max_marks ? "full" : st.awarded > 0 ? "part" : "zero";
                return (
                  <div key={i} className={`step-card ${k}`}>
                    <div className="row between" style={{ alignItems: "flex-start", gap: 10 }}><b className="small"><span className={`dot ${k}`} /> {st.step}</b><b>{fmtMarks(st.awarded)}/{fmtMarks(st.max_marks)}</b></div>
                    {st.comment && <MathText text={st.comment} className="small step-comment" />}
                  </div>
                );
              })}
            </div>
          )}
          {e && e.steps.length === 0 && e.feedback && <div className="panel-card"><b>Evaluation</b><MathText text={e.feedback} className="small" /></div>}
          {e?.mistake_type && e.mistake_type !== "none" && e.marks_awarded < e.max_marks && MISTAKES[e.mistake_type] && (
            <div className="small"><b style={{ color: MISTAKES[e.mistake_type].color }}>{MISTAKES[e.mistake_type].label}</b>{e.mistake_note ? <>: <MathText text={e.mistake_note} className="inline" /></> : null}</div>
          )}
          {e?.feedback && e.steps.length > 0 && <div className="panel-card"><b>Feedback</b><MathText text={e.feedback} className="small" /></div>}
          {(p.ev.overall_feedback || p.ev.strengths.length > 0 || p.ev.gaps.length > 0) && (
            <div className="panel-card">
              <b>Overall Feedback</b>
              <MathText text={p.ev.overall_feedback} className="small" />
              {(p.ev.strengths.length > 0 || p.ev.gaps.length > 0) && (
                <div className="row wrap" style={{ gap: 6 }}>
                  {p.ev.strengths.map((s) => <span key={s} className="badge green">✓ {s}</span>)}
                  {p.ev.gaps.map((g) => <span key={g} className="badge red">Revise: {g}</span>)}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {tab === "question" && (
        <div className="stack" style={{ gap: 10 }}>
          <MathText text={q.text} />
          {q.options.length > 0 && q.options.map((o, i) => {
            const correct = q.correct_option === i;
            return <div key={i} className={`opt-row ${correct ? "ok" : ""}`}><b>({LETTERS[i]})</b> <span className="grow"><MathText text={o} className="inline" /></span>{correct && <span>✓</span>}</div>;
          })}
          {e?.transcription && <div className="solution"><span className="small muted">Student wrote:</span><div className="hand" style={{ fontSize: 19, color: "#263066", whiteSpace: "pre-wrap" }}>{e.transcription}</div></div>}
        </div>
      )}
      {tab === "solution" && (
        p.answersHidden || !q.solution ? <p className="small muted">{p.answersHidden ? "The solution will be shared once every batch has finished this test." : "No solution added for this question."}</p> : (
          <div className="stack" style={{ gap: 10 }}>
            {q.type === "numeric" && q.numeric_answer != null && <div><b>Answer:</b> {q.numeric_answer}</div>}
            {q.type === "mcq" && q.correct_option != null && <div><b>Correct option:</b> ({LETTERS[q.correct_option]}) <MathText text={q.options[q.correct_option]} className="inline" /></div>}
            <MathText text={q.solution} />
            {q.rubric.length > 0 && <div className="panel-card"><b className="small">Marking scheme</b>{q.rubric.map((r, i) => <div key={i} className="row between small" style={{ gap: 10 }}><MathText text={r.step} className="inline" /><b>{r.marks}</b></div>)}</div>}
          </div>
        )
      )}
    </div>
  );
}
