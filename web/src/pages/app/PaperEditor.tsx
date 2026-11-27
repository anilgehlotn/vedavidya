// The paper workspace: summary, section switcher, question cards (maths typeset), the teacher's "checked" ticks,
// and a solution drawer where a teacher edits a solution/marking scheme or asks the AI to refine, regenerate or rewrite.
// AI changes come back as suggestions; nothing changes until the teacher chooses "Use this".
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import type { Paper, Question, Section } from "../../lib/types";
import { MathText } from "../../components/MathText";
import { ErrorBox, Modal, useFocusTrap } from "../../components/ui";
import { Icon } from "../../components/icons";
import { useRun, useToast } from "../../components/toast";
import { CreditLine } from "./Credits";

export type FullPaper = Paper & { marking_notes?: string | null; checked_questions?: string[] };
interface Suggestion { id: string; question_id: string; action: "refine" | "regenerate" | "rewrite"; instruction: string | null; status: "queued" | "ready" | "failed"; result: Question | null; error: string | null }

const TYPE_LABEL: Record<Question["type"], string> = { mcq: "MCQ", numeric: "Numerical", short: "Short answer", long: "Long answer" };
const DIFF_TONE: Record<string, string> = { easy: "green", medium: "amber", hard: "red" };
const letter = (i: number) => String.fromCharCode(65 + i);

export function PaperWorkspace({ p, onChanged }: { p: FullPaper; onChanged: () => void }) {
  const [checked, setChecked] = useState<Set<string>>(new Set(p.checked_questions ?? []));
  useEffect(() => setChecked(new Set(p.checked_questions ?? [])), [p.checked_questions]);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<{ qid: string; tab: "solution" | "criteria" | "ai" } | null>(null);
  const [current, setCurrent] = useState(0);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [sugs, setSugs] = useState<Suggestion[]>([]);
  const run = useRun();
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);

  const loadSugs = () => api<Suggestion[]>(`/papers/${p.id}/suggestions`).then(setSugs).catch(() => {});
  useEffect(() => { void loadSugs(); }, [p.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const working = sugs.some((s) => s.status === "queued");
  useEffect(() => {
    if (!working) return;
    const t = setInterval(loadSugs, 2500);
    return () => clearInterval(t);
  }, [working]); // eslint-disable-line react-hooks/exhaustive-deps

  // Highlight the section on screen in the switcher.
  useEffect(() => {
    const els = sectionRefs.current.filter(Boolean) as HTMLElement[];
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis) setCurrent(Number((vis.target as HTMLElement).dataset.idx));
    }, { rootMargin: "-90px 0px -60% 0px" });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [p.sections.length]);

  const all = p.sections.flatMap((s) => s.questions);
  const numbers = useMemo(() => { const m = new Map<string, number>(); all.forEach((q, i) => m.set(q.id, i + 1)); return m; }, [all]);
  const mix = all.reduce((m, q) => ({ ...m, [q.difficulty]: (m[q.difficulty] ?? 0) + 1 }), {} as Record<string, number>);
  const doneCount = all.filter((q) => checked.has(q.id)).length;
  const toggleCheck = async (q: Question) => {
    const on = !checked.has(q.id);
    setChecked((c) => { const n = new Set(c); if (on) n.add(q.id); else n.delete(q.id); return n; });
    const r = await run(() => api<{ checked_questions: string[] }>(`/papers/${p.id}/checked`, { method: "PUT", body: { question_id: q.id, checked: on } }));
    if (r) setChecked(new Set(r.checked_questions)); else setChecked(new Set(p.checked_questions ?? []));
  };
  const jump = (i: number) => {
    setCollapsed((c) => { const n = new Set(c); n.delete(i); return n; });
    setTimeout(() => sectionRefs.current[i]?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  };
  const openQ = open ? all.find((q) => q.id === open.qid) : null;

  return (
    <div className="paper-ws">
      <div className="ws-summary card">
        <div><span className="small muted">Marks</span><b>{p.total_marks}</b></div>
        <div><span className="small muted">Questions</span><b>{all.length}</b></div>
        <div><span className="small muted">Sections</span><b>{p.sections.length}</b></div>
        <div><span className="small muted">Duration</span><b>{p.duration_min} min</b></div>
        <div><span className="small muted">Difficulty</span>
          <span className="row" style={{ gap: 4, marginTop: 4 }}>{(["easy", "medium", "hard"] as const).map((d) => mix[d] ? <span key={d} className={`badge ${DIFF_TONE[d]}`}>{mix[d]} {d}</span> : null)}</span></div>
        <div className="ws-progress"><span className="small muted">Checked by you</span><b>{doneCount}/{all.length}</b>
          <div className="bar" aria-hidden><i style={{ width: `${all.length ? (doneCount / all.length) * 100 : 0}%` }} /></div></div>
      </div>
      <div className="ws-rules">
        <Icon name="info" size={16} />
        <span className="grow small">{p.marking_notes ? <><b>Your marking rules:</b> <span className="muted">{p.marking_notes.split("\n").join(" · ")}</span></> : <span className="muted">No marking rules of your own. The AI marks by each question's marking scheme.</span>}</span>
        <button className="btn-link small" onClick={() => setRulesOpen(true)}>{p.marking_notes ? "Edit rules" : "Add rules"}</button>
      </div>

      {p.sections.length > 1 && (
        <nav className="ws-switcher" aria-label="Sections">
          {p.sections.map((s, i) => {
            const done = s.questions.filter((q) => checked.has(q.id)).length;
            return (
              <button key={i} type="button" className={current === i ? "on" : ""} aria-current={current === i ? "true" : undefined} onClick={() => jump(i)}>
                {s.name}<span className={`sw-count ${done === s.questions.length && done > 0 ? "full" : ""}`}>{done}/{s.questions.length}</span>
              </button>
            );
          })}
        </nav>
      )}

      {p.instructions && <div className="card card-pad" style={{ marginBottom: 16 }}><b>Instructions</b><div className="muted" style={{ marginTop: 4 }}><MathText text={p.instructions} /></div></div>}
      {!all.length && <div className="card card-pad muted">This paper has no questions yet. Use "Edit paper" to add sections and questions.</div>}

      {p.sections.map((s, i) => {
        const shut = collapsed.has(i);
        const marks = s.questions.reduce((t, q) => t + q.marks, 0);
        const done = s.questions.filter((q) => checked.has(q.id)).length;
        return (
          <section key={i} className="ws-section" ref={(el) => { sectionRefs.current[i] = el; }} data-idx={i} aria-label={s.name}>
            <button type="button" className="ws-section-head" aria-expanded={!shut} onClick={() => setCollapsed((c) => { const n = new Set(c); if (n.has(i)) n.delete(i); else n.add(i); return n; })}>
              <span className={`chev ${shut ? "" : "down"}`}><Icon name="chevron" size={16} /></span>
              <span className="grow"><b>{s.name}</b><span className="small muted"> · {s.questions.length} question{s.questions.length === 1 ? "" : "s"} · {marks} marks</span></span>
              <span className="small muted">{done}/{s.questions.length} checked</span>
            </button>
            {!shut && s.instructions && <p className="small muted" style={{ margin: "0 0 10px 30px" }}>{s.instructions}</p>}
            {!shut && s.questions.map((q) => (
              <QuestionCard key={q.id} q={q} n={numbers.get(q.id)!} checked={checked.has(q.id)} sug={sugs.find((x) => x.question_id === q.id)}
                onCheck={() => toggleCheck(q)} onOpen={(tab) => setOpen({ qid: q.id, tab })} />
            ))}
          </section>
        );
      })}

      {open && openQ && (
        <SolutionDrawer paperId={p.id} q={openQ} n={numbers.get(openQ.id)!} tab={open.tab} setTab={(tab) => setOpen({ ...open, tab })}
          sug={sugs.find((x) => x.question_id === openQ.id)} onClose={() => setOpen(null)}
          onChanged={() => { onChanged(); void loadSugs(); }} />
      )}
      {rulesOpen && <RulesModal p={p} onClose={() => setRulesOpen(false)} onSaved={onChanged} />}
    </div>
  );
}

function QuestionCard({ q, n, checked, sug, onCheck, onOpen }: { q: Question; n: number; checked: boolean; sug?: Suggestion; onCheck: () => void; onOpen: (tab: "solution" | "criteria" | "ai") => void }) {
  return (
    <article className={`q-card ws-q ${checked ? "is-checked" : ""}`} aria-label={`Question ${n}`}>
      <div className="q-meta">
        <b className="qn">Q{n}</b>
        <span className="badge">{TYPE_LABEL[q.type]}</span>
        <span className={`badge ${DIFF_TONE[q.difficulty]}`}>{q.difficulty}</span>
        <span className="badge violet">{q.marks} mark{q.marks === 1 ? "" : "s"}{q.negative_marks ? ` · −${q.negative_marks}` : ""}</span>
        {q.topic && <span className="tag">{q.topic}{q.subtopic ? ` › ${q.subtopic}` : ""}</span>}
        {sug?.status === "queued" && <span className="badge amber"><span className="dot pulse" /> AI is working</span>}
        {sug?.status === "ready" && <button type="button" className="badge blue badge-btn" onClick={() => onOpen("ai")}>✦ Suggestion ready</button>}
        {sug?.status === "failed" && <button type="button" className="badge red badge-btn" onClick={() => onOpen("ai")}>AI help failed</button>}
      </div>
      <div className="q-text"><MathText text={q.text} /></div>
      {q.type === "mcq" && <div className="opts">{q.options.map((o, i) => <div key={i} className={`opt ${i === q.correct_option ? "correct" : ""}`}><b>{letter(i)}.</b><MathText text={o} className="inline" />{i === q.correct_option && <span className="sr-only"> (correct)</span>}</div>)}</div>}
      {q.type === "numeric" && <p className="small" style={{ marginTop: 10 }}><b>Answer:</b> {q.numeric_answer ?? <span style={{ color: "var(--red)" }}>missing</span>}</p>}
      <div className="q-toolbar no-print">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpen("solution")}><Icon name="paper" size={15} /> Solution</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpen("criteria")}><Icon name="tests" size={15} /> Marking criteria{q.rubric.length ? ` (${q.rubric.length})` : ""}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpen("ai")}>✦ AI assist</button>
        <button type="button" className={`btn btn-sm check-btn ${checked ? "on" : ""}`} aria-pressed={checked} onClick={onCheck}>
          <Icon name="check" size={15} /> {checked ? "Checked" : "Mark as checked"}</button>
      </div>
    </article>
  );
}

function SolutionDrawer({ paperId, q, n, tab, setTab, sug, onClose, onChanged }: {
  paperId: string; q: Question; n: number; tab: "solution" | "criteria" | "ai"; setTab: (t: "solution" | "criteria" | "ai") => void;
  sug?: Suggestion; onClose: () => void; onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Question>(q);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState("");
  const toast = useToast();
  const run = useRun();
  const panel = useRef<HTMLElement>(null);
  useFocusTrap(panel);
  useEffect(() => { setDraft(q); setEditing(false); setErr(null); }, [q.id, q.solution, q.rubric, q.text]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const rubricSum = draft.rubric.reduce((t, r) => t + (Number(r.marks) || 0), 0);
  const save = async () => {
    setBusy(true); setErr(null);
    try { await api(`/papers/${paperId}/questions/${q.id}`, { method: "PUT", body: draft }); toast.success(`Q${n} saved.`); setEditing(false); onChanged(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const assist = async (action: "refine" | "regenerate" | "rewrite", instruction?: string) => {
    const r = await run(() => api(`/papers/${paperId}/questions/${q.id}/assist`, { body: { action, instruction } }),
      action === "rewrite" ? "The AI is writing a new version of this question." : "The AI is working on the solution.");
    if (r) { setAsk(""); setTab("ai"); onChanged(); }
  };
  const decide = async (verb: "apply" | "discard") => {
    if (!sug) return;
    if (await run(() => api(`/papers/${paperId}/suggestions/${sug.id}/${verb}`, { body: {} }), verb === "apply" ? `Q${n} updated with the suggestion.` : "Suggestion discarded.")) onChanged();
  };

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} aria-hidden />
      <aside ref={panel} tabIndex={-1} className="drawer" role="dialog" aria-modal="true" aria-label={`Question ${n}: solution and marking`}>
        <header className="drawer-head">
          <div className="grow" style={{ minWidth: 0 }}><span className="small muted">Question {n} · {q.marks} marks</span><div className="drawer-q"><MathText text={q.text} /></div></div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </header>
        <div className="tabs" role="tablist" style={{ margin: "0 20px" }}>
          <button role="tab" aria-selected={tab === "solution"} className={tab === "solution" ? "on" : ""} onClick={() => setTab("solution")}>Solution</button>
          <button role="tab" aria-selected={tab === "criteria"} className={tab === "criteria" ? "on" : ""} onClick={() => setTab("criteria")}>Marking criteria</button>
          <button role="tab" aria-selected={tab === "ai"} className={tab === "ai" ? "on" : ""} onClick={() => setTab("ai")}>✦ AI assist{sug?.status === "ready" ? " •" : ""}</button>
        </div>
        <div className="drawer-body">
          {tab === "solution" && (editing ? (
            <div className="stack">
              {q.type === "numeric" && <label className="field"><span>Correct answer</span><input className="input" type="number" step="any" value={draft.numeric_answer ?? ""} onChange={(e) => setDraft({ ...draft, numeric_answer: e.target.value === "" ? null : Number(e.target.value) })} /></label>}
              {q.type === "mcq" && <label className="field"><span>Correct option</span><select className="input" value={draft.correct_option ?? 0} onChange={(e) => setDraft({ ...draft, correct_option: Number(e.target.value) })}>{q.options.map((o, i) => <option key={i} value={i}>{letter(i)}. {o.slice(0, 60)}</option>)}</select></label>}
              <label className="field"><span>Worked solution (maths between $…$)</span><textarea className="input" rows={10} value={draft.solution} onChange={(e) => setDraft({ ...draft, solution: e.target.value })} /></label>
              <div className="small muted">Preview</div><div className="preview-box"><MathText text={draft.solution} /></div>
            </div>
          ) : (
            <div className="stack">
              {q.type === "mcq" && q.correct_option != null && <p><b>Answer:</b> {letter(q.correct_option)}. <MathText text={q.options[q.correct_option]} className="inline" /></p>}
              {q.type === "numeric" && <p><b>Answer:</b> {q.numeric_answer ?? "—"}</p>}
              {q.solution ? <MathText text={q.solution} /> : <p className="muted">No solution yet. Write one, or ask the AI to regenerate it.</p>}
            </div>
          ))}
          {tab === "criteria" && (editing ? (
            <div className="stack" style={{ gap: 8 }}>
              <span className="small">Step marks must add up to <b>{q.marks}</b> (now <b style={{ color: Math.abs(rubricSum - q.marks) > 0.01 ? "var(--red)" : "var(--green)" }}>{rubricSum}</b>).</span>
              {draft.rubric.map((r, i) => (
                <div key={i} className="row">
                  <input className="input" value={r.step} aria-label={`Step ${i + 1}`} onChange={(e) => setDraft({ ...draft, rubric: draft.rubric.map((x, j) => (j === i ? { ...x, step: e.target.value } : x)) })} />
                  <input className="input" style={{ width: 80 }} type="number" step={0.5} min={0} aria-label={`Marks for step ${i + 1}`} value={r.marks} onChange={(e) => setDraft({ ...draft, rubric: draft.rubric.map((x, j) => (j === i ? { ...x, marks: Number(e.target.value) } : x)) })} />
                  <button type="button" className="icon-btn" aria-label={`Remove step ${i + 1}`} onClick={() => setDraft({ ...draft, rubric: draft.rubric.filter((_, j) => j !== i) })}><Icon name="trash" size={15} /></button>
                </div>
              ))}
              <button type="button" className="btn-link small" style={{ alignSelf: "flex-start" }} onClick={() => setDraft({ ...draft, rubric: [...draft.rubric, { step: "", marks: 1 }] })}>+ Add step</button>
            </div>
          ) : q.rubric.length ? (
            <ol className="criteria">{q.rubric.map((r, i) => <li key={i}><span className="grow"><MathText text={r.step} className="inline" /></span><b>{r.marks}</b></li>)}</ol>
          ) : <p className="muted">{q.type === "mcq" || q.type === "numeric" ? "Objective question: full marks for the correct answer." : "No marking steps yet."}</p>)}
          {tab === "ai" && <AiPanel q={q} sug={sug} onAsk={assist} onDecide={decide} ask={ask} setAsk={setAsk} />}
          <ErrorBox error={err} />
        </div>
        {tab !== "ai" && (
          <footer className="drawer-foot">
            {editing ? <>
              <button className="btn btn-ghost" onClick={() => { setEditing(false); setDraft(q); setErr(null); }}>Cancel</button>
              <button className="btn btn-primary" disabled={busy || (tab === "criteria" && draft.rubric.length > 0 && Math.abs(rubricSum - q.marks) > 0.01)} onClick={save}>{busy ? "Saving…" : "Save"}</button>
            </> : <>
              <button className="btn btn-ghost" onClick={() => setEditing(true)}>✎ Edit</button>
              <button className="btn btn-ghost" onClick={() => setTab("ai")}>✦ Refine</button>
              <button className="btn btn-ghost" disabled={sug?.status === "queued"} onClick={() => assist("regenerate")}>↻ Regenerate</button>
            </>}
          </footer>
        )}
      </aside>
    </>
  );
}

function AiPanel({ q, sug, onAsk, onDecide, ask, setAsk }: { q: Question; sug?: Suggestion; onAsk: (a: "refine" | "regenerate" | "rewrite", i?: string) => void; onDecide: (v: "apply" | "discard") => void; ask: string; setAsk: (s: string) => void }) {
  if (sug?.status === "queued") return (
    <div className="state"><span className="spinner" style={{ width: 24, height: 24, color: "var(--accent)" }} /><b>The AI is working…</b><p>{sug.action === "rewrite" ? "Writing a new version of the question." : "Working on the solution and marking."} This usually takes under a minute; you can keep working.</p></div>
  );
  if (sug?.status === "failed") return (
    <div className="stack"><div className="error-box">{sug.error ?? "The AI couldn't finish."} Your credits were refunded.</div><button className="btn btn-ghost" onClick={() => onDecide("discard")}>OK</button></div>
  );
  if (sug?.status === "ready" && sug.result) {
    const r = sug.result;
    return (
      <div className="stack">
        <div className="small muted">{sug.action === "rewrite" ? "New version of the question" : sug.action === "refine" ? `Refined: "${sug.instruction}"` : "New solution"}. Nothing changes until you choose "Use this".</div>
        {sug.action === "rewrite" && <div className="sug-box"><b className="small">Question</b><MathText text={r.text} />
          {q.type === "mcq" && <ol type="A" className="small" style={{ margin: "6px 0 0", paddingLeft: 20 }}>{r.options.map((o, i) => <li key={i} style={{ fontWeight: i === r.correct_option ? 700 : 400 }}><MathText text={o} className="inline" />{i === r.correct_option ? " ✓" : ""}</li>)}</ol>}
          {q.type === "numeric" && <p className="small"><b>Answer:</b> {r.numeric_answer}</p>}</div>}
        <div className="sug-box"><b className="small">Solution</b><MathText text={r.solution} /></div>
        {r.rubric.length > 0 && <div className="sug-box"><b className="small">Marking criteria</b><ol className="criteria">{r.rubric.map((s, i) => <li key={i}><span className="grow"><MathText text={s.step} className="inline" /></span><b>{s.marks}</b></li>)}</ol></div>}
        <div className="row"><button className="btn btn-primary" onClick={() => onDecide("apply")}>Use this</button><button className="btn btn-ghost" onClick={() => onDecide("discard")}>Discard</button></div>
      </div>
    );
  }
  return (
    <div className="stack">
      <form className="stack" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (ask.trim()) onAsk("refine", ask.trim()); }}>
        <label className="field"><span>Refine the solution and marking</span>
          <textarea className="input" rows={3} maxLength={1000} value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="e.g. Show the unit conversion step and give it 1 mark" /></label>
        <div className="row wrap" style={{ gap: 6 }}>{["Make the solution simpler for students", "Add a step for units", "Split the marks into more steps"].map((t) => <button key={t} type="button" className="chip-btn" onClick={() => setAsk(t)}>{t}</button>)}</div>
        <button className="btn btn-primary" disabled={!ask.trim()} style={{ alignSelf: "flex-start" }}>✦ Refine</button>
      </form>
      <div className="ai-alt">
        <div><b className="small">Regenerate</b><p className="small muted" style={{ margin: 0 }}>A fresh worked solution and marking scheme.</p></div>
        <button className="btn btn-ghost btn-sm" onClick={() => onAsk("regenerate")}>↻ Regenerate</button>
      </div>
      <div className="ai-alt">
        <div><b className="small">Rewrite the question</b><p className="small muted" style={{ margin: 0 }}>Same concept, type and marks; new wording or numbers. Uses the box above as a hint if filled.</p></div>
        <button className="btn btn-ghost btn-sm" onClick={() => onAsk("rewrite", ask.trim() || undefined)}>✎ Rewrite</button>
      </div>
      <CreditLine action="question_assist" />
    </div>
  );
}

function RulesModal({ p, onClose, onSaved }: { p: FullPaper; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState(p.marking_notes ?? "");
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const save = async () => {
    setErr(null);
    try {
      await api(`/papers/${p.id}`, { method: "PUT", body: { title: p.title, subject: p.subject ?? undefined, board: p.board ?? undefined, class_level: p.class_level ?? undefined, language: p.language,
        duration_min: p.duration_min, instructions: p.instructions ?? undefined, sections: p.sections as Section[], marking_notes: text.trim() || null } });
      toast.success(text.trim() ? "Marking rules saved. They apply to sheets marked from now on." : "Marking rules removed.");
      onSaved(); onClose();
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Modal title="Your marking rules" onClose={onClose}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>The AI follows these when marking every sheet of this paper (and when writing new marking schemes). Sheets already marked keep their marks.</p>
        <textarea className="input" rows={6} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder={"e.g. Units are required for full marks.\nAccept any correct method."} aria-label="Marking rules" />
        <ErrorBox error={err} />
        <button className="btn btn-primary" onClick={save}>Save rules</button>
      </div>
    </Modal>
  );
}
