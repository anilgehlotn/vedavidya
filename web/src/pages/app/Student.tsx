// Student-facing pages: my tests and the online (CBT) exam screen.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, fmtDateTime, pct } from "../../lib/api";
import type { Question } from "../../lib/types";
import { Empty, ErrorBox, Loading, Modal, PageTitle, ScoreBadge, useApi } from "../../components/ui";

interface MyTest { id: string; title: string; mode: "cbt" | "offline"; scheduled_at: string | null; duration_min: number; results_published: number; subject: string | null; total_marks: number; attempt_id: string; status: string; score: number | null; max_score: number | null }

export function MyTests() {
  const tests = useApi<MyTest[]>("/my/tests");
  const nav = useNavigate();
  if (tests.loading) return <Loading />;
  const list = tests.data ?? [];
  const live = list.filter((t) => t.mode === "cbt" && (t.status === "pending" || t.status === "in_progress"));
  const done = list.filter((t) => !live.includes(t));
  return (
    <>
      <PageTitle title="My tests" sub="Upcoming online tests and your results" />
      <ErrorBox error={tests.error} />
      {live.length > 0 && (
        <div className="grid g2" style={{ marginBottom: 20 }}>
          {live.map((t) => {
            const notYet = t.scheduled_at && Date.parse(t.scheduled_at) > Date.now();
            return (
              <div key={t.id} className="card card-pad stack" style={{ gap: 8, borderColor: "#ddd3fd" }}>
                <div className="row between"><span className="badge blue">{t.status === "in_progress" ? "In progress" : notYet ? "Upcoming" : "Live now"}</span><span className="small muted">{fmtDateTime(t.scheduled_at)}</span></div>
                <b style={{ fontSize: 18 }}>{t.title}</b>
                <div className="small muted">{t.subject} · {t.total_marks} marks · {t.duration_min} minutes</div>
                <button className="btn btn-primary" disabled={!!notYet} onClick={() => nav(`/exam/${t.id}`)} style={{ alignSelf: "flex-start" }}>{t.status === "in_progress" ? "Resume test →" : "Start test →"}</button>
              </div>
            );
          })}
        </div>
      )}
      <div className="card">
        {done.length ? (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Test</th><th>Date</th><th>Score</th><th></th></tr></thead>
            <tbody>{done.map((t) => (
              <tr key={t.id}>
                <td><b>{t.title}</b><div className="small muted">{t.subject}</div></td>
                <td className="small">{fmtDateTime(t.scheduled_at)}</td>
                <td>{t.results_published && t.score != null ? <><b>{t.score}</b>/{t.max_score} <ScoreBadge value={pct(t.score, t.max_score)} /></> : <span className="badge">{t.status === "evaluated" || t.status === "evaluating" || t.status === "uploaded" ? "Awaiting results" : "Not taken"}</span>}</td>
                <td style={{ textAlign: "right" }}>{t.results_published && t.score != null ? <Link to={`/app/attempts/${t.attempt_id}`} className="btn btn-ghost btn-sm">View answers</Link> : null}</td>
              </tr>))}
            </tbody>
          </table></div>
        ) : <Empty title="No results yet" />}
      </div>
    </>
  );
}

type StrippedQ = Omit<Question, "correct_option" | "numeric_answer" | "solution" | "rubric">;
interface ExamData { attempt_id: string; title: string; remaining_seconds: number; responses: Record<string, { answer: number | null; review?: boolean }>; sections: { name: string; instructions: string; questions: StrippedQ[] }[]; instructions: string | null }

export function CbtExam() {
  const { testId } = useParams();
  const nav = useNavigate();
  const [exam, setExam] = useState<ExamData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resp, setResp] = useState<ExamData["responses"]>({});
  const [cur, setCur] = useState(0);
  const [left, setLeft] = useState(0);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const respRef = useRef(resp);
  respRef.current = resp;

  useEffect(() => {
    api<ExamData>(`/cbt/${testId}/start`, { body: {} })
      .then((d) => { setExam(d); setResp(d.responses); setLeft(d.remaining_seconds); })
      .catch((e) => setError(e.message));
  }, [testId]);

  const submit = useCallback(async () => {
    setSubmitting(true);
    try { await api(`/cbt/${testId}/submit`, { body: { responses: respRef.current } }); nav("/app/my", { replace: true }); }
    catch (e) { setError((e as Error).message); setSubmitting(false); }
  }, [testId]);

  // Countdown; auto-submit at zero. Autosave every 15s.
  useEffect(() => {
    if (!exam) return;
    const tick = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    const save = setInterval(() => api(`/cbt/${testId}/responses`, { method: "PUT", body: { responses: respRef.current } }).catch(() => {}), 15000);
    return () => { clearInterval(tick); clearInterval(save); };
  }, [exam]);
  useEffect(() => { if (exam && left === 0 && !submitting) submit(); }, [left]);

  if (error) return <div className="main"><PageTitle title="Online test" /><ErrorBox error={error} /><Link to="/app/my" className="btn btn-ghost" style={{ marginTop: 14 }}>← Back</Link></div>;
  if (!exam) return <Loading label="Loading your test…" />;

  const qs = exam.sections.flatMap((s) => s.questions.map((q) => ({ ...q, section: s.name })));
  const q = qs[cur];
  const r = resp[q.id] ?? { answer: null };
  const setAnswer = (answer: number | null) => setResp({ ...resp, [q.id]: { ...r, answer } });
  const answered = qs.filter((x) => resp[x.id]?.answer != null).length;
  const hh = String(Math.floor(left / 3600)).padStart(2, "0"), mm = String(Math.floor((left % 3600) / 60)).padStart(2, "0"), ss = String(left % 60).padStart(2, "0");

  return (
    <div className="cbt">
      <div className="cbt-main">
        <div className="row between" style={{ marginBottom: 18 }}>
          <div><b style={{ fontSize: 18 }}>{exam.title}</b><div className="small muted">{q.section}</div></div>
          <span className="badge violet">+{q.marks}{q.negative_marks ? ` / −${q.negative_marks}` : ""}</span>
        </div>
        <div className="card card-pad grow" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="small muted">Question {cur + 1} of {qs.length} · {q.type === "mcq" ? "Single correct" : "Numerical answer"}</div>
          <div className="q-text" style={{ fontSize: 18 }}>{q.text}</div>
          {q.type === "mcq" ? (
            <div className="stack" style={{ gap: 10 }}>
              {q.options.map((o, i) => (
                <button key={i} className={`cbt-opt ${r.answer === i ? "sel" : ""}`} onClick={() => setAnswer(r.answer === i ? null : i)}>
                  <span className="k">{String.fromCharCode(65 + i)}</span>{o}
                </button>))}
            </div>
          ) : (
            <label className="field" style={{ maxWidth: 260 }}><span>Your answer</span>
              <input className="input" type="number" step="any" value={r.answer ?? ""} onChange={(e) => setAnswer(e.target.value === "" ? null : Number(e.target.value))} /></label>
          )}
        </div>
        <div className="row between wrap" style={{ marginTop: 16 }}>
          <div className="row">
            <button className="btn btn-ghost" onClick={() => setResp({ ...resp, [q.id]: { ...r, review: !r.review } })}>{r.review ? "★ Marked for review" : "☆ Mark for review"}</button>
            <button className="btn btn-ghost" onClick={() => setAnswer(null)}>Clear</button>
          </div>
          <div className="row">
            <button className="btn btn-ghost" disabled={cur === 0} onClick={() => setCur(cur - 1)}>← Previous</button>
            {cur < qs.length - 1 ? <button className="btn btn-primary" onClick={() => setCur(cur + 1)}>Save & next →</button>
              : <button className="btn btn-primary" onClick={() => setConfirmSubmit(true)}>Finish</button>}
          </div>
        </div>
      </div>
      <aside className="cbt-side">
        <div><div className="small muted">Time left</div><div className="timer" style={{ color: left < 300 ? "var(--red)" : undefined }}>{hh}:{mm}:{ss}</div></div>
        <div className="cbt-grid">{qs.map((x, i) => (
          <button key={x.id} className={`${resp[x.id]?.review ? "rev" : resp[x.id]?.answer != null ? "ans" : ""} ${i === cur ? "cur" : ""}`} onClick={() => setCur(i)}>{i + 1}</button>))}
        </div>
        <div className="row wrap small"><span className="badge green">{answered} answered</span><span className="badge">{qs.length - answered} left</span><span className="badge amber">{qs.filter((x) => resp[x.id]?.review).length} review</span></div>
        <button className="btn btn-primary" style={{ marginTop: "auto" }} onClick={() => setConfirmSubmit(true)}>Submit test</button>
      </aside>
      {confirmSubmit && (
        <Modal title="Submit test?" onClose={() => setConfirmSubmit(false)}>
          <p>You've answered <b>{answered}</b> of <b>{qs.length}</b> questions. You can't change answers after submitting.</p>
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 20 }}>
            <button className="btn btn-ghost" onClick={() => setConfirmSubmit(false)}>Keep working</button>
            <button className="btn btn-primary" disabled={submitting} onClick={submit}>{submitting ? "Submitting…" : "Submit"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
