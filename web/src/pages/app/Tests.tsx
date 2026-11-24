import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, DEMO, fileUrl, fmtDate, fmtDateTime, pct } from "../../lib/api";
import type { AttemptStatus, Paper, Question, SheetEvaluation } from "../../lib/types";
import { Empty, ErrorBox, Loading, Modal, PageTitle, ScoreBadge, StatusBadge, useApi } from "../../components/ui";
import { useAuth } from "../../lib/auth";

interface TestRow { id: string; title: string; mode: "offline" | "cbt"; scheduled_at: string | null; results_published: number; paper_title: string; total_marks: number; subject: string | null; batch_names: string | null; candidates: number; evaluated: number }

export function TestList() {
  const [params, setParams] = useSearchParams();
  const tests = useApi<TestRow[]>("/tests");
  const papers = useApi<Paper[]>("/papers");
  const batches = useApi<{ id: string; name: string; student_count: number }[]>("/batches");
  const nav = useNavigate();
  const creating = params.has("new");
  const [f, setF] = useState({ title: "", paper_id: params.get("paper") ?? "", mode: "offline" as "offline" | "cbt", scheduled_at: "", duration_min: "" });
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const ready = (papers.data ?? []).filter((p) => p.status === "draft" || p.status === "approved");

  useEffect(() => {
    const p = ready.find((x) => x.id === f.paper_id);
    if (p && !f.title) setF((cur) => ({ ...cur, title: p.title, duration_min: String(p.duration_min) }));
  }, [f.paper_id, papers.data]);

  const create = async (e: FormEvent) => {
    e.preventDefault(); setError(null);
    try {
      const r = await api<{ id: string }>("/tests", { body: { ...f, duration_min: f.duration_min ? Number(f.duration_min) : undefined, scheduled_at: f.scheduled_at ? new Date(f.scheduled_at).toISOString() : undefined, batch_ids: batchIds } });
      nav(`/app/tests/${r.id}`);
    } catch (err) { setError((err as Error).message); }
  };

  return (
    <>
      <PageTitle title="Tests & evaluation" sub="Schedule tests, upload answer sheets and publish results">
        <button className="btn btn-primary" onClick={() => setParams({ new: "1" })}>+ New test</button>
      </PageTitle>
      <div className="card">
        {tests.loading ? <Loading /> : tests.data?.length ? (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Test</th><th>Batches</th><th>Date</th><th>Evaluated</th><th>Results</th></tr></thead>
            <tbody>{tests.data.map((t) => (
              <tr key={t.id} className="click" onClick={() => nav(`/app/tests/${t.id}`)}>
                <td><b>{t.title}</b><div className="small muted">{t.mode === "cbt" ? "Online test" : "Handwritten"} · {t.total_marks} marks</div></td>
                <td className="small">{t.batch_names ?? "—"}</td>
                <td className="small">{fmtDate(t.scheduled_at)}</td>
                <td><div className="small">{t.evaluated}/{t.candidates}</div><div className="bar" style={{ width: 90, marginTop: 4 }}><i style={{ width: `${t.candidates ? (t.evaluated / t.candidates) * 100 : 0}%` }} /></div></td>
                <td>{t.results_published ? <span className="badge green">Published</span> : <span className="badge">Not published</span>}</td>
              </tr>))}
            </tbody>
          </table></div>
        ) : <Empty title="No tests yet">Create a test from a question paper, then upload sheets or let students take it online.</Empty>}
      </div>

      {creating && (
        <Modal title="New test" onClose={() => setParams({})}>
          {ready.length === 0 ? <Empty title="You need a question paper first"><Link to="/app/papers/new" className="btn-link">Generate one with AI</Link></Empty> : (
            <form className="stack" onSubmit={create}>
              <label className="field"><span>Question paper</span>
                <select className="input" required value={f.paper_id} onChange={(e) => setF({ ...f, paper_id: e.target.value, title: "" })}>
                  <option value="">Select…</option>{ready.map((p) => <option key={p.id} value={p.id}>{p.title} ({p.total_marks} marks)</option>)}
                </select>
              </label>
              <label className="field"><span>Test name</span><input className="input" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
              <div className="field"><span>How will students take it?</span>
                <div className="grid g2">
                  {([["offline", "On paper", "Upload scanned answer sheets for AI evaluation"], ["cbt", "Online (CBT)", "Students answer on screen; scored instantly (MCQ/numeric papers)"]] as const).map(([v, h, d]) => (
                    <label key={v} className={`q-card ${f.mode === v ? "sel" : ""}`} style={{ cursor: "pointer", borderColor: f.mode === v ? "var(--accent)" : undefined, background: f.mode === v ? "var(--accent-soft)" : undefined }}>
                      <input type="radio" name="mode" checked={f.mode === v} onChange={() => setF({ ...f, mode: v })} style={{ display: "none" }} />
                      <b>{h}</b><div className="small muted">{d}</div>
                    </label>))}
                </div>
              </div>
              <div className="grid g2">
                <label className="field"><span>Date & time</span><input className="input" type="datetime-local" value={f.scheduled_at} onChange={(e) => setF({ ...f, scheduled_at: e.target.value })} /></label>
                <label className="field"><span>Duration (min)</span><input className="input" type="number" min={5} value={f.duration_min} onChange={(e) => setF({ ...f, duration_min: e.target.value })} /></label>
              </div>
              <div className="field"><span>Batches</span>
                <div className="row wrap">{batches.data?.map((b) => (
                  <label key={b.id} className={`badge ${batchIds.includes(b.id) ? "violet" : ""}`} style={{ cursor: "pointer", padding: "6px 12px" }}>
                    <input type="checkbox" style={{ display: "none" }} checked={batchIds.includes(b.id)} onChange={() => setBatchIds(batchIds.includes(b.id) ? batchIds.filter((x) => x !== b.id) : [...batchIds, b.id])} />
                    {batchIds.includes(b.id) ? "✓ " : ""}{b.name} ({b.student_count})
                  </label>))}
                </div>
              </div>
              <ErrorBox error={error} />
              <button className="btn btn-primary" disabled={!batchIds.length}>Create test</button>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}

interface AttemptRow { id: string; status: AttemptStatus; score: number | null; max_score: number | null; error: string | null; reviewed: number; files: number; student_id: string; student_name: string; roll_no: string | null; batch_name: string; share_token: string | null }
interface TestDetailData extends TestRow { duration_min: number; paper: Paper; attempts: AttemptRow[] }

function UploadCell({ a, onDone }: { a: AttemptRow; onDone: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = async (files: FileList | null) => {
    if (!files?.length) return;
    const form = new FormData();
    [...files].forEach((f) => form.append("files", f));
    setBusy(true); setErr(null);
    try { await api(`/attempts/${a.id}/files${a.files ? "?replace=1" : ""}`, { form }); onDone(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); if (ref.current) ref.current.value = ""; }
  };
  return (
    <>
      <input ref={ref} type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" style={{ display: "none" }} onChange={(e) => send(e.target.files)} />
      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => ref.current?.click()}>{busy ? "Uploading…" : a.files ? `↻ ${a.files} page${a.files > 1 ? "s" : ""}` : "⇪ Upload sheet"}</button>
      {err && <div className="small" style={{ color: "var(--red)" }}>{err}</div>}
    </>
  );
}

export function TestDetail() {
  const { id } = useParams();
  const t = useApi<TestDetailData>(`/tests/${id}`);
  const nav = useNavigate();
  const [msg, setMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | AttemptStatus>("all");

  const busy = t.data?.attempts.some((a) => a.status === "evaluating");
  useEffect(() => {
    if (!busy) return;
    const i = setInterval(() => t.reload(true), 3000);
    return () => clearInterval(i);
  }, [busy]);

  if (t.loading) return <Loading />;
  if (!t.data) return <ErrorBox error={t.error} />;
  const d = t.data;
  const scored = d.attempts.filter((a) => a.score != null);
  const avg = scored.length ? Math.round(scored.reduce((s, a) => s + pct(a.score, a.max_score)!, 0) / scored.length) : null;
  const high = scored.length ? Math.max(...scored.map((a) => pct(a.score, a.max_score)!)) : null;
  const toEvaluate = d.attempts.filter((a) => a.files > 0 && (a.status === "uploaded" || a.status === "failed")).length;
  const list = d.attempts.filter((a) => filter === "all" || a.status === filter);
  const ranked = [...scored].sort((a, b) => b.score! - a.score!).map((a) => a.id);

  const evaluate = async (ids?: string[]) => {
    const r = await api<{ queued: number }>(`/tests/${d.id}/evaluate`, { body: ids ? { attempt_ids: ids } : {} });
    setMsg(r.queued ? `Evaluating ${r.queued} answer sheet${r.queued > 1 ? "s" : ""}…` : "Nothing to evaluate - upload sheets first.");
    t.reload(true);
  };
  const publish = async (publish: boolean) => {
    await api(`/tests/${d.id}/publish`, { body: { publish } });
    setMsg(publish ? "Results published. Students can see them and parent links are active." : "Results hidden from students.");
    t.reload(true);
  };
  const copyLink = (token: string) => { navigator.clipboard?.writeText(`${location.origin}/report/${token}`); setMsg("Parent report link copied."); };

  return (
    <>
      <PageTitle title={d.title} sub={<>{d.mode === "cbt" ? "Online test" : "Handwritten test"} · {d.paper.total_marks} marks · {d.duration_min} min · {fmtDateTime(d.scheduled_at)} · <Link to={`/app/papers/${d.paper.id}`} className="btn-link">View paper</Link></>}>
        {!DEMO && <a className="btn btn-ghost" href={fileUrl(`/tests/${d.id}/results.csv`)}>Export CSV</a>}
        {d.mode === "offline" && <button className="btn btn-ghost" disabled={!toEvaluate} onClick={() => evaluate()}>✦ Evaluate {toEvaluate || ""} sheet{toEvaluate === 1 ? "" : "s"}</button>}
        {d.results_published ? <button className="btn btn-ghost" onClick={() => publish(false)}>Unpublish</button>
          : <button className="btn btn-primary" disabled={!scored.length} onClick={() => publish(true)}>Publish results</button>}
      </PageTitle>
      {msg && <div className="ok-box" style={{ marginBottom: 14 }}>{msg}</div>}
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <div className="card stat"><div className="label">Candidates</div><div className="value">{d.attempts.length}</div></div>
        <div className="card stat"><div className="label">Evaluated</div><div className="value">{scored.length}</div></div>
        <div className="card stat"><div className="label">Average</div><div className="value">{avg ?? "—"}{avg != null && "%"}</div></div>
        <div className="card stat"><div className="label">Highest</div><div className="value">{high ?? "—"}{high != null && "%"}</div></div>
      </div>
      {d.mode === "offline" && d.attempts.some((a) => a.status === "pending") && (
        <div className="card card-pad small" style={{ marginBottom: 14, background: "var(--accent-soft)", borderColor: "#ddd3fd" }}>
          <b>How it works:</b> upload each student's scanned pages (photos or a PDF), then click <b>Evaluate</b>. AI marks every question step by step using the paper's rubric. Open any sheet to review and adjust marks, then publish.
        </div>
      )}
      <div className="tabs">
        {(["all", "pending", "uploaded", "evaluating", "evaluated", "failed"] as const).map((s) => {
          const n = s === "all" ? d.attempts.length : d.attempts.filter((a) => a.status === s).length;
          return (s === "all" || n > 0) && <button key={s} className={filter === s ? "on" : ""} onClick={() => setFilter(s)} style={{ textTransform: "capitalize" }}>{s} ({n})</button>;
        })}
      </div>
      <div className="card">
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Rank</th><th>Student</th><th>Batch</th><th>Status</th><th>Score</th><th></th></tr></thead>
          <tbody>{list.map((a) => (
            <tr key={a.id}>
              <td className="muted">{ranked.indexOf(a.id) >= 0 ? `#${ranked.indexOf(a.id) + 1}` : "—"}</td>
              <td><b>{a.student_name}</b><div className="small muted">Roll {a.roll_no ?? "—"}</div></td>
              <td className="small">{a.batch_name}</td>
              <td><StatusBadge status={a.status} />{a.reviewed ? <span className="badge blue" style={{ marginLeft: 4 }}>Reviewed</span> : null}
                {a.error && <div className="small" style={{ color: "var(--red)", maxWidth: 260 }}>{a.error}</div>}</td>
              <td>{a.score != null ? <><b>{a.score}</b><span className="muted">/{a.max_score}</span> <ScoreBadge value={pct(a.score, a.max_score)} /></> : "—"}</td>
              <td><div className="row" style={{ justifyContent: "flex-end" }}>
                {d.mode === "offline" && a.status !== "evaluating" && <UploadCell a={a} onDone={() => t.reload(true)} />}
                {d.mode === "offline" && a.files > 0 && a.status !== "evaluating" && <button className="btn btn-ghost btn-sm" onClick={() => evaluate([a.id])}>{a.status === "evaluated" ? "Re-evaluate" : "Evaluate"}</button>}
                {a.score != null && <button className="btn btn-ghost btn-sm" onClick={() => nav(`/app/attempts/${a.id}`)}>Review</button>}
                {a.share_token && d.results_published ? <button className="btn btn-ghost btn-sm" onClick={() => copyLink(a.share_token!)}>🔗</button> : null}
              </div></td>
            </tr>))}
          </tbody>
        </table></div>
        {!list.length && <Empty title="No students here" />}
      </div>
      <div style={{ marginTop: 20 }}><button className="btn btn-danger btn-sm" onClick={async () => { if (confirm("Delete this test and all its results?")) { await api(`/tests/${d.id}`, { method: "DELETE" }); nav("/app/tests"); } }}>Delete test</button></div>
    </>
  );
}

interface AttemptData {
  id: string; status: AttemptStatus; score: number | null; max_score: number | null; student_name: string; test_title: string; test_id: string;
  files: number; evaluation: SheetEvaluation | null; paper: Paper; reviewed: number; share_token: string | null; results_published: number; mode: string;
}

// Shared by teachers (editable) and students (read-only, after publishing).
export function AttemptReview() {
  const { id } = useParams();
  const { user } = useAuth();
  const a = useApi<AttemptData>(`/attempts/${id}`);
  const editable = user!.role !== "student";
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [page, setPage] = useState<number | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  if (a.loading) return <Loading />;
  if (!a.data) return <ErrorBox error={a.error} />;
  const d = a.data;
  const ev = d.evaluation;
  const questions = d.paper.sections.flatMap((s) => s.questions);
  const qById = new Map(questions.map((q) => [q.id, q]));
  const dirty = Object.keys(edits).length > 0;

  const save = async () => {
    const r = await api<{ score: number }>(`/attempts/${d.id}/evaluation`, { method: "PUT", body: { questions: Object.entries(edits).map(([question_id, marks_awarded]) => ({ question_id, marks_awarded })) } });
    setEdits({}); setSaved(`Saved - new total ${r.score}/${d.max_score}`); a.reload(true);
  };

  return (
    <>
      <PageTitle title={d.student_name} sub={<>{d.test_title} {editable && <>· <Link className="btn-link" to={`/app/tests/${d.test_id}`}>Back to test</Link></>}</>}>
        <div className="card stat" style={{ padding: "10px 18px" }}><div className="label">Total</div><div className="value" style={{ fontSize: 24 }}>{d.score}<span className="muted" style={{ fontSize: 16 }}>/{d.max_score}</span></div></div>
        {editable && dirty && <button className="btn btn-primary" onClick={save}>Save changes</button>}
        <button className="btn btn-ghost no-print" onClick={() => window.print()}>Print</button>
      </PageTitle>
      {saved && <div className="ok-box" style={{ marginBottom: 14 }}>{saved}</div>}
      {editable && d.files > 0 && (
        <div className="card card-pad no-print" style={{ marginBottom: 16 }}>
          <div className="row between"><b>Answer sheet ({d.files} page{d.files > 1 ? "s" : ""})</b><span className="small muted">Click a page to enlarge</span></div>
          <div className="row" style={{ overflowX: "auto", marginTop: 10, gap: 10 }}>
            {Array.from({ length: d.files }, (_, i) => (
              <a key={i} href={fileUrl(`/attempts/${d.id}/files/${i}`)} target="_blank" rel="noreferrer" onClick={(e) => { e.preventDefault(); setPage(i); }}
                className="q-card" style={{ padding: 4, flex: "none", width: 110, height: 140, display: "grid", placeItems: "center", overflow: "hidden" }}>
                <object data={fileUrl(`/attempts/${d.id}/files/${i}`)} style={{ width: "100%", height: "100%", pointerEvents: "none" }}>Page {i + 1}</object>
              </a>))}
          </div>
        </div>
      )}
      {page != null && (
        <Modal title={`Page ${page + 1}`} onClose={() => setPage(null)} wide>
          <object data={fileUrl(`/attempts/${d.id}/files/${page}`)} style={{ width: "100%", height: "75vh" }}>Unable to preview</object>
        </Modal>
      )}
      {ev && (ev.overall_feedback || ev.gaps.length > 0) && (
        <div className="grid g2" style={{ marginBottom: 16 }}>
          {ev.overall_feedback && <div className="card card-pad"><b>Overall feedback</b><p className="muted" style={{ marginTop: 6 }}>{ev.overall_feedback}</p>
            {ev.strengths.length > 0 && <div className="row wrap" style={{ marginTop: 10 }}>{ev.strengths.map((s) => <span key={s} className="badge green">✓ {s}</span>)}</div>}</div>}
          {ev.gaps.length > 0 && <div className="card card-pad"><b>Revise these</b><div className="row wrap" style={{ marginTop: 10 }}>{ev.gaps.map((g) => <span key={g} className="badge red">{g}</span>)}</div></div>}
        </div>
      )}
      {!ev ? <div className="card"><Empty title="Not evaluated yet" /></div> : (
        <div className="stack" style={{ gap: 12 }}>
          {ev.questions.map((qe, i) => {
            const q = qById.get(qe.question_id) as Question | undefined;
            const marks = edits[qe.question_id] ?? qe.marks_awarded;
            return (
              <div key={qe.question_id} className="q-card">
                <div className="row between" style={{ alignItems: "flex-start" }}>
                  <div className="grow">
                    <div className="q-meta"><b>Q{i + 1}.</b>{q && <span className="badge">{q.topic}</span>}
                      {!qe.attempted && <span className="badge">Not attempted</span>}
                      {qe.confidence === "low" && <span className="badge amber" title="Handwriting was hard to read - please check">⚠ Check</span>}</div>
                    <div className="q-text">{q?.text}</div>
                  </div>
                  <div className="row" style={{ flex: "none" }}>
                    {editable ? (
                      <input className="input" type="number" step={0.5} min={-(q?.negative_marks ?? 0)} max={qe.max_marks} value={marks}
                        style={{ width: 80, fontWeight: 700, borderColor: qe.question_id in edits ? "var(--accent)" : undefined }}
                        onChange={(e) => setEdits({ ...edits, [qe.question_id]: Number(e.target.value) })} />
                    ) : <b style={{ fontSize: 18 }}>{marks}</b>}
                    <span className="muted">/ {qe.max_marks}</span>
                  </div>
                </div>
                {qe.transcription && <div className="solution"><span className="small muted">{d.mode === "cbt" ? "Answer given" : "Student wrote"}:</span><div className="hand" style={{ fontSize: 20, color: "#263066", whiteSpace: "pre-wrap" }}>{qe.transcription}</div></div>}
                {qe.steps.length > 0 && (
                  <div style={{ marginTop: 10 }}>{qe.steps.map((s, j) => (
                    <div key={j} className="row between small" style={{ padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
                      <span>{s.step}{s.comment && <span className="muted"> - {s.comment}</span>}</span>
                      <span className={`badge ${s.awarded >= s.max_marks ? "green" : s.awarded > 0 ? "amber" : "red"}`}>{s.awarded}/{s.max_marks}</span>
                    </div>))}
                  </div>
                )}
                {qe.feedback && <p className="small" style={{ marginTop: 10 }}><b>Feedback:</b> {qe.feedback}</p>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
