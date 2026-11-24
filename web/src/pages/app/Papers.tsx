import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, fmtDate } from "../../lib/api";
import type { Paper, Question, Section } from "../../lib/types";
import { Empty, ErrorBox, Loading, PageTitle, useApi } from "../../components/ui";

const STATUS: Record<Paper["status"], [string, string]> = { generating: ["Generating", "amber"], draft: ["Draft", ""], approved: ["Approved", "green"], failed: ["Failed", "red"] };
const TYPE_LABEL: Record<Question["type"], string> = { mcq: "MCQ", numeric: "Numerical", short: "Short answer", long: "Long answer" };

export function PaperList() {
  const papers = useApi<Paper[]>("/papers");
  const nav = useNavigate();
  useEffect(() => {
    if (!papers.data?.some((p) => p.status === "generating")) return;
    const t = setInterval(() => papers.reload(true), 3000);
    return () => clearInterval(t);
  }, [papers.data]);
  return (
    <>
      <PageTitle title="Question papers" sub="Generate with AI, or write your own">
        <button className="btn btn-ghost" onClick={async () => {
          const r = await api<{ id: string }>("/papers", { body: { title: "Untitled paper", duration_min: 60, sections: [{ name: "Section A", instructions: "", questions: [] }] } });
          nav(`/app/papers/${r.id}?edit=1`);
        }}>Blank paper</button>
        <Link to="/app/papers/new" className="btn btn-primary">✦ Generate with AI</Link>
      </PageTitle>
      <div className="card">
        {papers.loading ? <Loading /> : papers.data?.length ? (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Paper</th><th>Board / Class</th><th>Marks</th><th>Created</th><th>Status</th></tr></thead>
            <tbody>{papers.data.map((p) => (
              <tr key={p.id} className="click" onClick={() => nav(`/app/papers/${p.id}`)}>
                <td><b>{p.title}</b><div className="small muted">{p.subject} · {p.language}</div></td>
                <td className="small">{[p.board, p.class_level].filter(Boolean).join(" · ") || "—"}</td>
                <td>{p.total_marks} <span className="muted small">/ {p.duration_min} min</span></td>
                <td className="small">{fmtDate(p.created_at)}</td>
                <td><span className={`badge ${STATUS[p.status][1]}`}>{p.status === "generating" && <span className="dot pulse" />}{STATUS[p.status][0]}</span></td>
              </tr>))}
            </tbody>
          </table></div>
        ) : <Empty title="No papers yet"><Link to="/app/papers/new" className="btn-link">Generate your first paper</Link></Empty>}
      </div>
    </>
  );
}

interface SectionSpec { name: string; type: Question["type"]; count: number; marks_each: number; negative_marks: number }
const PRESETS: Record<string, { board: string; sections: SectionSpec[]; duration: number }> = {
  "CBSE board pattern": { board: "CBSE", duration: 180, sections: [
    { name: "Section A - MCQs", type: "mcq", count: 10, marks_each: 1, negative_marks: 0 },
    { name: "Section B - Short answer", type: "short", count: 5, marks_each: 3, negative_marks: 0 },
    { name: "Section C - Long answer", type: "long", count: 3, marks_each: 5, negative_marks: 0 }] },
  "JEE Main mock": { board: "JEE Main", duration: 60, sections: [
    { name: "Section A - Single correct", type: "mcq", count: 10, marks_each: 4, negative_marks: 1 },
    { name: "Section B - Numerical", type: "numeric", count: 5, marks_each: 4, negative_marks: 0 }] },
  "Quick class quiz": { board: "CBSE", duration: 20, sections: [{ name: "Quiz", type: "mcq", count: 10, marks_each: 1, negative_marks: 0 }] },
  "Subjective unit test": { board: "ICSE", duration: 60, sections: [
    { name: "Section A - Short answer", type: "short", count: 5, marks_each: 2, negative_marks: 0 },
    { name: "Section B - Long answer", type: "long", count: 4, marks_each: 5, negative_marks: 0 }] },
};

export function PaperGenerate() {
  const nav = useNavigate();
  const ai = useApi<{ configured: boolean; demo: boolean }>("/settings/ai");
  const [f, setF] = useState({ subject: "Physics", board: "CBSE", class_level: "Class 10", topics: "", language: "English", difficulty: "mixed", duration_min: 180, notes: "" });
  const [sections, setSections] = useState<SectionSpec[]>(PRESETS["CBSE board pattern"].sections);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: k === "duration_min" ? Number(e.target.value) : e.target.value });
  const total = sections.reduce((t, s) => t + s.count * s.marks_each, 0);
  const upd = (i: number, patch: Partial<SectionSpec>) => setSections(sections.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { const r = await api<{ id: string }>("/papers/generate", { body: { ...f, sections } }); nav(`/app/papers/${r.id}`); }
    catch (err) { setError((err as Error).message); setBusy(false); }
  };

  return (
    <>
      <PageTitle title="Generate a question paper" sub="Describe the paper; AI writes original questions, answer keys, solutions and marking rubrics." />
      {ai.data && !ai.data.configured && (
        <div className="error-box" style={{ marginBottom: 16 }}>{ai.data.demo ? "AI is switched off in the public demo institute." : <>AI isn't set up yet. An admin can add the Claude API key in <Link to="/app/settings">Settings</Link>.</>}</div>
      )}
      <form className="grid" style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", gap: 16, alignItems: "start" }} onSubmit={submit}>
        <div className="card card-pad stack">
          <div className="row wrap small"><span className="muted">Presets:</span>{Object.keys(PRESETS).map((k) => (
            <button type="button" key={k} className="btn btn-ghost btn-sm" onClick={() => { setSections(PRESETS[k].sections); setF({ ...f, board: PRESETS[k].board, duration_min: PRESETS[k].duration }); }}>{k}</button>))}
          </div>
          <div className="grid g3">
            <label className="field"><span>Subject</span><input className="input" required value={f.subject} onChange={set("subject")} /></label>
            <label className="field"><span>Board / exam</span><input className="input" required value={f.board} onChange={set("board")} list="boards" /></label>
            <label className="field"><span>Class / level</span><input className="input" required value={f.class_level} onChange={set("class_level")} /></label>
          </div>
          <datalist id="boards">{["CBSE", "ICSE", "State Board", "JEE Main", "JEE Advanced", "NEET", "UPSC Prelims", "CA Foundation", "CUET"].map((b) => <option key={b} value={b} />)}</datalist>
          <label className="field"><span>Chapters / topics to cover</span><textarea className="input" required rows={3} value={f.topics} onChange={set("topics")} placeholder="e.g. Electricity, Magnetic effects of current, Light - reflection and refraction" /></label>
          <div className="grid g3">
            <label className="field"><span>Language</span><select className="input" value={f.language} onChange={set("language")}>{["English", "Hindi", "Sanskrit", "Bilingual (English + Hindi)", "Marathi", "Gujarati", "Tamil", "Telugu", "Bengali", "Kannada"].map((l) => <option key={l}>{l}</option>)}</select></label>
            <label className="field"><span>Difficulty</span><select className="input" value={f.difficulty} onChange={set("difficulty")}><option value="mixed">Mixed</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label>
            <label className="field"><span>Duration (min)</span><input className="input" type="number" min={5} max={360} value={f.duration_min} onChange={set("duration_min")} /></label>
          </div>
          <label className="field"><span>Anything else? (optional)</span><input className="input" value={f.notes} onChange={set("notes")} placeholder="e.g. include 2 diagram-based questions, avoid repeating last week's numericals" /></label>
        </div>
        <div className="card card-pad stack">
          <div className="row between"><b>Sections</b><span className="badge violet">{total} marks</span></div>
          {sections.map((s, i) => (
            <div key={i} className="q-card stack" style={{ gap: 8, padding: 12 }}>
              <div className="row"><input className="input" value={s.name} onChange={(e) => upd(i, { name: e.target.value })} />
                <button type="button" className="btn-link" style={{ color: "var(--red)" }} onClick={() => setSections(sections.filter((_, j) => j !== i))} disabled={sections.length === 1}>✕</button></div>
              <div className="grid g4" style={{ gap: 8 }}>
                <label className="field"><span>Type</span><select className="input" value={s.type} onChange={(e) => upd(i, { type: e.target.value as Question["type"] })}>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label className="field"><span>Count</span><input className="input" type="number" min={1} max={60} value={s.count} onChange={(e) => upd(i, { count: Number(e.target.value) })} /></label>
                <label className="field"><span>Marks</span><input className="input" type="number" min={0.5} step={0.5} value={s.marks_each} onChange={(e) => upd(i, { marks_each: Number(e.target.value) })} /></label>
                <label className="field"><span>−ve</span><input className="input" type="number" min={0} step={0.25} value={s.negative_marks} onChange={(e) => upd(i, { negative_marks: Number(e.target.value) })} /></label>
              </div>
            </div>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSections([...sections, { name: `Section ${String.fromCharCode(65 + sections.length)}`, type: "short", count: 3, marks_each: 2, negative_marks: 0 }])}>+ Add section</button>
          <ErrorBox error={error} />
          <button className="btn btn-primary" disabled={busy}>{busy ? <><span className="spinner" /> Starting…</> : "✦ Generate paper"}</button>
          <p className="small muted">Usually ready in 1–3 minutes. You can edit every question afterwards.</p>
        </div>
      </form>
    </>
  );
}

const blankQuestion = (n: number): Question => ({
  id: `q${n}`, type: "short", text: "", options: [], correct_option: null, numeric_answer: null, marks: 2, negative_marks: 0,
  difficulty: "medium", topic: "", solution: "", rubric: [{ step: "Correct answer with working", marks: 2 }],
});

function QuestionView({ q, n }: { q: Question; n: number }) {
  return (
    <div className="q-card">
      <div className="q-meta">
        <b style={{ marginRight: 4 }}>Q{n}.</b><span className="badge">{TYPE_LABEL[q.type]}</span><span className="badge">{q.topic}</span>
        <span className={`badge ${q.difficulty === "hard" ? "red" : q.difficulty === "easy" ? "green" : "amber"}`}>{q.difficulty}</span>
        <span className="badge violet">{q.marks} marks{q.negative_marks ? ` · −${q.negative_marks}` : ""}</span>
      </div>
      <div className="q-text">{q.text}</div>
      {q.type === "mcq" && <div className="opts">{q.options.map((o, i) => <div key={i} className={`opt ${i === q.correct_option ? "correct" : ""}`}><b>{String.fromCharCode(65 + i)}.</b>{o}</div>)}</div>}
      <details className="solution no-print">
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Answer, solution & marking scheme</summary>
        {q.type === "numeric" && <p style={{ marginTop: 8 }}><b>Answer:</b> {q.numeric_answer}</p>}
        <p style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{q.solution}</p>
        {q.rubric.length > 0 && <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>{q.rubric.map((r, i) => <li key={i}>{r.step} - <b>{r.marks}</b></li>)}</ul>}
      </details>
    </div>
  );
}

function QuestionEditor({ q, onChange, onRemove }: { q: Question; onChange: (q: Question) => void; onRemove: () => void }) {
  const set = (patch: Partial<Question>) => onChange({ ...q, ...patch });
  return (
    <div className="q-card stack" style={{ gap: 10 }}>
      <div className="row wrap">
        <b>{q.id}</b>
        <select className="input" style={{ width: 150 }} value={q.type} onChange={(e) => {
          const type = e.target.value as Question["type"];
          set({ type, options: type === "mcq" ? (q.options.length ? q.options : ["", "", "", ""]) : [], correct_option: type === "mcq" ? q.correct_option ?? 0 : null });
        }}>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input className="input" style={{ width: 170 }} placeholder="Topic" value={q.topic} onChange={(e) => set({ topic: e.target.value })} />
        <select className="input" style={{ width: 110 }} value={q.difficulty} onChange={(e) => set({ difficulty: e.target.value as Question["difficulty"] })}><option>easy</option><option>medium</option><option>hard</option></select>
        <label className="row small">Marks <input className="input" style={{ width: 70 }} type="number" step={0.5} value={q.marks} onChange={(e) => set({ marks: Number(e.target.value) })} /></label>
        <label className="row small">−ve <input className="input" style={{ width: 70 }} type="number" step={0.25} value={q.negative_marks} onChange={(e) => set({ negative_marks: Number(e.target.value) })} /></label>
        <button type="button" className="btn btn-danger btn-sm" style={{ marginLeft: "auto" }} onClick={onRemove}>Remove</button>
      </div>
      <textarea className="input" rows={3} placeholder="Question text" value={q.text} onChange={(e) => set({ text: e.target.value })} />
      {q.type === "mcq" && (
        <div className="opts">{q.options.map((o, i) => (
          <label key={i} className="row"><input type="radio" checked={q.correct_option === i} onChange={() => set({ correct_option: i })} title="Correct option" />
            <input className="input" value={o} placeholder={`Option ${String.fromCharCode(65 + i)}`} onChange={(e) => set({ options: q.options.map((x, j) => (j === i ? e.target.value : x)) })} /></label>))}
        </div>
      )}
      {q.type === "numeric" && <label className="field"><span>Correct numerical answer</span><input className="input" type="number" step="any" value={q.numeric_answer ?? ""} onChange={(e) => set({ numeric_answer: e.target.value === "" ? null : Number(e.target.value) })} /></label>}
      <textarea className="input" rows={2} placeholder="Model solution" value={q.solution} onChange={(e) => set({ solution: e.target.value })} />
      {(q.type === "short" || q.type === "long") && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="small" style={{ fontWeight: 600 }}>Marking rubric (step marks should add up to {q.marks})</span>
          {q.rubric.map((r, i) => (
            <div key={i} className="row">
              <input className="input" value={r.step} onChange={(e) => set({ rubric: q.rubric.map((x, j) => (j === i ? { ...x, step: e.target.value } : x)) })} />
              <input className="input" style={{ width: 80 }} type="number" step={0.5} value={r.marks} onChange={(e) => set({ rubric: q.rubric.map((x, j) => (j === i ? { ...x, marks: Number(e.target.value) } : x)) })} />
              <button type="button" className="btn-link" style={{ color: "var(--red)" }} onClick={() => set({ rubric: q.rubric.filter((_, j) => j !== i) })}>✕</button>
            </div>))}
          <button type="button" className="btn-link small" style={{ alignSelf: "flex-start" }} onClick={() => set({ rubric: [...q.rubric, { step: "", marks: 1 }] })}>+ Add step</button>
        </div>
      )}
    </div>
  );
}

export function PaperDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const paper = useApi<Paper>(`/papers/${id}`);
  const [edit, setEdit] = useState(new URLSearchParams(location.search).has("edit"));
  const [draft, setDraft] = useState<Paper | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (paper.data?.status !== "generating") return;
    const t = setInterval(() => paper.reload(true), 3000);
    return () => clearInterval(t);
  }, [paper.data?.status]);
  useEffect(() => { if (edit && paper.data) setDraft(structuredClone(paper.data)); }, [edit, paper.data?.id]);

  if (paper.loading) return <Loading />;
  if (!paper.data) return <ErrorBox error={paper.error} />;
  const p = paper.data;

  if (p.status === "generating") return (
    <div className="card" style={{ maxWidth: 560, margin: "60px auto", padding: 40, textAlign: "center" }}>
      <div className="spinner" style={{ width: 32, height: 32, color: "var(--accent)" }} />
      <h2 style={{ marginTop: 18 }}>Writing your paper…</h2>
      <p className="muted" style={{ marginTop: 8 }}>Questions, answer keys, solutions and marking rubrics are being written. This page updates automatically.</p>
    </div>
  );

  const save = async () => {
    if (!draft) return;
    setSaving(true); setError(null);
    try {
      await api(`/papers/${p.id}`, { method: "PUT", body: { title: draft.title, subject: draft.subject ?? undefined, board: draft.board ?? undefined, class_level: draft.class_level ?? undefined, language: draft.language, duration_min: draft.duration_min, instructions: draft.instructions ?? undefined, sections: draft.sections } });
      setEdit(false); paper.reload();
    } catch (err) { setError((err as Error).message); }
    finally { setSaving(false); }
  };

  if (edit && draft) {
    const nextId = () => `q${Math.max(0, ...draft.sections.flatMap((s) => s.questions).map((q) => Number(q.id.replace(/\D/g, "")) || 0)) + 1}`;
    const setSection = (i: number, s: Section) => setDraft({ ...draft, sections: draft.sections.map((x, j) => (j === i ? s : x)) });
    return (
      <>
        <PageTitle title="Edit paper" sub={`${draft.sections.reduce((t, s) => t + s.questions.reduce((a, q) => a + q.marks, 0), 0)} marks`}>
          <button className="btn btn-ghost" onClick={() => setEdit(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save paper"}</button>
        </PageTitle>
        <ErrorBox error={error} />
        <div className="card card-pad stack" style={{ marginBottom: 16 }}>
          <div className="grid g3">
            <label className="field"><span>Title</span><input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
            <label className="field"><span>Subject</span><input className="input" value={draft.subject ?? ""} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></label>
            <label className="field"><span>Duration (min)</span><input className="input" type="number" value={draft.duration_min} onChange={(e) => setDraft({ ...draft, duration_min: Number(e.target.value) })} /></label>
          </div>
          <label className="field"><span>Instructions</span><textarea className="input" rows={2} value={draft.instructions ?? ""} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} /></label>
        </div>
        {draft.sections.map((s, i) => (
          <div key={i} className="card card-pad stack" style={{ marginBottom: 16 }}>
            <div className="row"><input className="input" style={{ fontWeight: 700 }} value={s.name} onChange={(e) => setSection(i, { ...s, name: e.target.value })} />
              <button className="btn btn-danger btn-sm" onClick={() => setDraft({ ...draft, sections: draft.sections.filter((_, j) => j !== i) })}>Delete section</button></div>
            <input className="input" placeholder="Section instructions" value={s.instructions} onChange={(e) => setSection(i, { ...s, instructions: e.target.value })} />
            {s.questions.map((q, qi) => (
              <QuestionEditor key={q.id} q={q} onChange={(nq) => setSection(i, { ...s, questions: s.questions.map((x, j) => (j === qi ? nq : x)) })}
                onRemove={() => setSection(i, { ...s, questions: s.questions.filter((_, j) => j !== qi) })} />
            ))}
            <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setSection(i, { ...s, questions: [...s.questions, { ...blankQuestion(0), id: nextId() }] })}>+ Add question</button>
          </div>
        ))}
        <button className="btn btn-ghost" onClick={() => setDraft({ ...draft, sections: [...draft.sections, { name: `Section ${String.fromCharCode(65 + draft.sections.length)}`, instructions: "", questions: [] }] })}>+ Add section</button>
      </>
    );
  }

  let n = 0;
  return (
    <>
      <PageTitle title={p.title} sub={<>{[p.subject, p.board, p.class_level, p.language].filter(Boolean).join(" · ")} · <b>{p.total_marks} marks</b> · {p.duration_min} min</>}>
        <span className={`badge ${STATUS[p.status][1]}`}>{STATUS[p.status][0]}</span>
        <button className="btn btn-ghost no-print" onClick={() => window.print()}>Print</button>
        <button className="btn btn-ghost no-print" onClick={async () => { const r = await api<{ id: string }>(`/papers/${p.id}/clone`, { body: {} }); nav(`/app/papers/${r.id}`); }}>Duplicate</button>
        <button className="btn btn-ghost no-print" onClick={() => setEdit(true)}>Edit</button>
        <button className="btn btn-danger no-print" onClick={async () => { if (confirm("Delete this paper and any tests using it?")) { await api(`/papers/${p.id}`, { method: "DELETE" }); nav("/app/papers"); } }}>Delete</button>
        {p.status === "draft" && <button className="btn btn-primary no-print" onClick={async () => { await api(`/papers/${p.id}/approve`, { body: {} }); paper.reload(); }}>Approve</button>}
        {p.status !== "failed" && <Link to={`/app/tests?new=1&paper=${p.id}`} className="btn btn-primary no-print">Use in a test →</Link>}
      </PageTitle>
      {p.status === "failed" && <div className="error-box" style={{ marginBottom: 16 }}>Generation failed: {p.error} <Link to="/app/papers/new" className="btn-link">Try again</Link></div>}
      {p.instructions && <div className="card card-pad" style={{ marginBottom: 16 }}><b>Instructions</b><p className="muted" style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{p.instructions}</p></div>}
      {p.sections.map((s) => (
        <div key={s.name} style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 18 }}>{s.name}</h3>
          {s.instructions && <p className="muted small" style={{ margin: "4px 0 10px" }}>{s.instructions}</p>}
          {s.questions.map((q) => <QuestionView key={q.id} q={q} n={++n} />)}
        </div>
      ))}
    </>
  );
}
