// Mistake analysis and Fix-it practice: shared by teacher and student screens.
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, fmtDate } from "../../lib/api";
import { Empty, ErrorBox, ErrorState, Loading, PageTitle, useApi } from "../../components/ui";
import { useToast } from "../../components/toast";

export const MISTAKES: Record<string, { label: string; color: string; tip: string }> = {
  concept: { label: "Concept not clear", color: "var(--red)", tip: "Re-learn the idea, then try 3 fresh questions on it." },
  careless: { label: "Careless slip", color: "var(--amber)", tip: "Slow down and re-check signs, units and arithmetic before moving on." },
  incomplete: { label: "Incomplete steps", color: "#7b61ff", tip: "Write every step. Most marks are given for the working, not just the answer." },
  presentation: { label: "Presentation", color: "var(--blue)", tip: "Show the formula, label diagrams and end with a clear final statement." },
  not_attempted: { label: "Not attempted", color: "var(--muted)", tip: "Plan your time: attempt every question, even partly, to pick up step marks." },
  unclassified: { label: "Other", color: "#b9b9c2", tip: "" },
};

/** Horizontal bars of marks lost per mistake type. */
export function MistakeBars({ data, unit = "marks" }: { data: Record<string, number>; unit?: string }) {
  const rows = Object.entries(data).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((t, [, v]) => t + v, 0);
  if (!rows.length) return <p className="small muted">No marks lost. Excellent work.</p>;
  return (
    <div className="stack" style={{ gap: 12 }}>
      {rows.map(([k, v]) => {
        const m = MISTAKES[k] ?? MISTAKES.unclassified;
        const share = Math.round((v / total) * 100);
        return (
          <div key={k}>
            <div className="row between small" style={{ marginBottom: 4 }}><b>{m.label}</b><span className="muted">{Math.round(v * 10) / 10} {unit} · {share}%</span></div>
            <div className="bar"><i style={{ width: `${Math.max(3, share)}%`, background: m.color }} /></div>
          </div>
        );
      })}
    </div>
  );
}

/** The biggest mistake type and what to do about it. */
export function TopTip({ data }: { data: Record<string, number> }) {
  const top = Object.entries(data).filter(([k, v]) => v > 0 && k !== "unclassified").sort((a, b) => b[1] - a[1])[0];
  if (!top) return null;
  const m = MISTAKES[top[0]];
  return <p className="small" style={{ marginTop: 12, background: "var(--bg-2)", borderRadius: 12, padding: "10px 12px" }}><b>Biggest fix: {m.label.toLowerCase()}.</b> {m.tip}</p>;
}

// ---------------------------------------------------------------- Teacher
interface Insights {
  mistakes: Record<string, number>;
  questions: { id: string; n: number; topic: string; text: string; marks: number; avg_pct: number | null; attempted_pct: number | null; top_mistake: string | null }[];
  brief: { summary: string; misconceptions: { title: string; explanation: string; students_affected: number; example: string; reteach_plan: string; check_question: string }[]; next_steps: string[] } | null;
  brief_status: string | null; brief_error: string | null;
  practice: { students: number; preparing: number; failed: number; completed: number; practice_avg: number | null; checkup_done: number; baseline_avg: number | null; checkup_avg: number | null; by_attempt: Record<string, { practice?: { status: string; score: number | null; max_score: number | null }; checkup?: { status: string; score: number | null; max_score: number | null } }> };
}

export function useInsights(testId: string, live: boolean) {
  const r = useApi<Insights>(`/tests/${testId}/insights`);
  const busy = r.data && (r.data.brief_status === "generating" || r.data.practice.preparing > 0);
  useEffect(() => {
    if (!busy && !live) return;
    const i = setInterval(() => r.reload(true), 4000);
    return () => clearInterval(i);
  }, [busy, live]);
  return r;
}

export function TestInsights({ testId, ins, published, onReload }: { testId: string; ins: Insights; published: boolean; onReload: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const act = async (path: string, ok: string) => {
    setBusy(true); setErr(null);
    try { await api(path, { body: {} }); toast.info(ok); onReload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const weakest = [...ins.questions].filter((q) => q.avg_pct !== null).sort((a, b) => (a.avg_pct ?? 0) - (b.avg_pct ?? 0)).slice(0, 6);
  const p = ins.practice;
  const anyMarks = Object.keys(ins.mistakes).length > 0 || ins.questions.some((q) => q.avg_pct !== null);
  if (!anyMarks) return null;
  return (
    <div className="stack" style={{ marginBottom: 18 }}>
      <ErrorBox error={err} />
      <div className="grid g2">
        <div className="card card-pad">
          <b>Where the class lost marks</b>
          <p className="small muted" style={{ margin: "4px 0 14px" }}>Every lost mark is tagged with its reason when sheets are marked.</p>
          <MistakeBars data={ins.mistakes} />
          <TopTip data={ins.mistakes} />
        </div>
        <div className="card card-pad">
          <b>Weakest questions</b>
          <p className="small muted" style={{ margin: "4px 0 14px" }}>Class average per question, lowest first.</p>
          <div className="stack" style={{ gap: 10 }}>
            {weakest.map((q) => (
              <div key={q.id} className="row between small" style={{ gap: 12 }}>
                <span style={{ minWidth: 0 }}><b>Q{q.n}</b> <span className="muted">{q.topic}</span>{q.top_mistake && <span className="badge" style={{ marginLeft: 6 }}>{MISTAKES[q.top_mistake]?.label ?? q.top_mistake}</span>}</span>
                <span className={`badge ${(q.avg_pct ?? 0) >= 75 ? "green" : (q.avg_pct ?? 0) >= 50 ? "amber" : "red"}`}>{q.avg_pct}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <div className="row between wrap">
          <div><b>Re-teach brief</b><p className="small muted" style={{ marginTop: 4 }}>The class's main misconceptions, with a real (anonymised) wrong answer and a 10-minute plan for your next class.</p></div>
          {ins.brief_status === "generating"
            ? <span className="badge amber"><span className="dot pulse" /> Writing…</span>
            : <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(`/tests/${testId}/brief`, "Writing the re-teach brief. It appears here in about a minute.")}>{ins.brief ? "↻ Write again" : "✦ Create re-teach brief"}</button>}
        </div>
        {ins.brief_status === "failed" && <div className="error-box" style={{ marginTop: 10 }}>{ins.brief_error}</div>}
        {ins.brief && (
          <div className="stack" style={{ marginTop: 14 }}>
            <p>{ins.brief.summary}</p>
            {ins.brief.misconceptions.map((m, i) => (
              <div key={i} className="q-card" style={{ background: "var(--bg-2)" }}>
                <div className="row between"><b>{i + 1}. {m.title}</b><span className="badge red">{m.students_affected} student{m.students_affected === 1 ? "" : "s"}</span></div>
                <p className="small" style={{ marginTop: 6 }}>{m.explanation}</p>
                {m.example && <div className="small" style={{ marginTop: 8 }}><span className="muted">A student wrote:</span> <span className="hand" style={{ fontSize: 17, color: "var(--ink-blue)" }}>{m.example}</span></div>}
                <p className="small" style={{ marginTop: 8 }}><b>Re-teach (10 min):</b> {m.reteach_plan}</p>
                <p className="small" style={{ marginTop: 6 }}><b>Check question:</b> {m.check_question}</p>
              </div>
            ))}
            {ins.brief.next_steps.length > 0 && <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{ins.brief.next_steps.map((n) => <li key={n}>{n}</li>)}</ul>}
          </div>
        )}
      </div>

      {published && (
        <div className="card card-pad">
          <div className="row between wrap">
            <div><b>Fix-it practice</b><p className="small muted" style={{ marginTop: 4 }}>Each student who lost marks gets practice on exactly their mistakes, and a check-up a week later that measures improvement.</p></div>
            {(p.failed > 0 || p.students === 0) && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(`/tests/${testId}/practice`, "Preparing Fix-it practice for the students who lost marks.")}>{p.students === 0 ? "✦ Create Fix-it practice" : `↻ Retry ${p.failed} failed`}</button>}
          </div>
          {p.students > 0 && (
            <div className="grid g4" style={{ marginTop: 14 }}>
              <div className="stat" style={{ padding: 0 }}><div className="label">Students with practice</div><div className="value" style={{ fontSize: 26 }}>{p.students}{p.preparing > 0 && <span className="small muted"> ({p.preparing} preparing)</span>}</div></div>
              <div className="stat" style={{ padding: 0 }}><div className="label">Practice completed</div><div className="value" style={{ fontSize: 26 }}>{p.completed}/{p.students}</div></div>
              <div className="stat" style={{ padding: 0 }}><div className="label">Practice average</div><div className="value" style={{ fontSize: 26 }}>{p.practice_avg ?? "—"}{p.practice_avg !== null && "%"}</div></div>
              <div className="stat" style={{ padding: 0 }}><div className="label">On weak spots: test → check-up</div><div className="value" style={{ fontSize: 26 }}>{p.checkup_done ? <>{p.baseline_avg}% → <span style={{ color: (p.checkup_avg ?? 0) >= (p.baseline_avg ?? 0) ? "var(--green)" : "var(--red)" }}>{p.checkup_avg}%</span></> : "—"}</div>{!p.checkup_done && <div className="small muted">Check-ups unlock a week after publishing</div>}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Per-student Fix-it status for the results table. */
export function FixitCell({ s }: { s?: Insights["practice"]["by_attempt"][string] }) {
  if (!s?.practice) return <span className="muted small">—</span>;
  const p = s.practice, c = s.checkup;
  if (p.status === "generating") return <span className="badge amber small"><span className="dot pulse" /> Preparing</span>;
  if (p.status === "failed") return <span className="badge red small">Failed</span>;
  return (
    <span className="small">
      {p.status === "done" ? <span className="badge green">Done {p.score}/{p.max_score}</span> : <span className="badge">Not started</span>}
      {c?.status === "done" && <span className="badge blue" style={{ marginLeft: 4 }}>Check-up {Math.round(((c.score ?? 0) / (c.max_score || 1)) * 100)}%</span>}
    </span>
  );
}

// ---------------------------------------------------------------- Student
interface MySet { id: string; kind: "practice" | "checkup"; status: string; score: number | null; max_score: number | null; available_at: string; completed_at: string | null; test_title: string; subject: string | null; count: number; answered: number; locked: boolean }

export function FixitList() {
  const sets = useApi<MySet[]>("/my/practice");
  const nav = useNavigate();
  const list = sets.data ?? [];
  const open = list.filter((s) => s.status !== "done" && !s.locked);
  const locked = list.filter((s) => s.locked);
  const done = list.filter((s) => s.status === "done");
  if (!list.length) return null;
  return (
    <div className="card card-pad" style={{ marginBottom: 20 }}>
      <div className="row between wrap"><b style={{ fontSize: 18 }}>Fix-it practice</b><span className="small muted">Practice made from your own mistakes</span></div>
      <div className="stack" style={{ gap: 10, marginTop: 14 }}>
        {open.map((s) => (
          <div key={s.id} className="q-card row between wrap" style={{ gap: 12, borderColor: "var(--accent-soft)" }}>
            <div>
              <span className={`badge ${s.kind === "checkup" ? "blue" : "violet"}`}>{s.kind === "checkup" ? "Check-up" : "Practice"}</span>
              <b style={{ marginLeft: 8 }}>{s.test_title}</b>
              <div className="small muted" style={{ marginTop: 4 }}>{s.subject} · {s.count} questions{s.answered ? ` · ${s.answered} done` : ""}</div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => nav(`/app/practice/${s.id}`)}>{s.answered ? "Continue" : "Start"} →</button>
          </div>
        ))}
        {locked.map((s) => (
          <div key={s.id} className="q-card row between wrap" style={{ gap: 12, opacity: 0.7 }}>
            <div><span className="badge">Check-up</span> <b style={{ marginLeft: 6 }}>{s.test_title}</b><div className="small muted" style={{ marginTop: 4 }}>Unlocks on {fmtDate(s.available_at)}. It checks that what you fixed has stuck.</div></div>
            <span className="badge">🔒 Locked</span>
          </div>
        ))}
        {done.length > 0 && (
          <details>
            <summary className="small" style={{ cursor: "pointer" }}>Completed ({done.length})</summary>
            <div className="stack" style={{ gap: 8, marginTop: 8 }}>
              {done.map((s) => (
                <Link key={s.id} to={`/app/practice/${s.id}`} className="row between small" style={{ textDecoration: "none", color: "inherit" }}>
                  <span>{s.kind === "checkup" ? "Check-up" : "Practice"} · {s.test_title}</span><span className="badge green">{s.score}/{s.max_score}</span>
                </Link>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

interface PQ { id: string; type: "mcq" | "numeric"; text: string; options: string[]; topic: string; targets: string; given?: number; correct?: boolean; answer?: number; explanation?: string }
interface PSet { id: string; kind: "practice" | "checkup"; status: string; focus: string; test_title: string; subject: string | null; score: number | null; max_score: number | null; baseline_pct: number | null; questions: PQ[] }

export function PracticePlayer() {
  const { id } = useParams();
  const set = useApi<PSet>(`/practice/${id}`);
  const [cur, setCur] = useState<number | null>(null);
  const [choice, setChoice] = useState<number | null>(null);
  const [num, setNum] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const crumbs = [{ label: "My tests", to: "/app/my" }];
  if (set.loading) return <Loading lines={5} label="Loading your practice…" />;
  if (!set.data) return <><PageTitle title="Practice" crumbs={crumbs} /><div className="card"><ErrorState error={set.error} onRetry={() => set.reload()} /></div><Link to="/app/my" className="btn btn-ghost" style={{ marginTop: 14 }}>← Back to my tests</Link></>;
  const d = set.data;
  const qs = d.questions;
  const firstOpen = qs.findIndex((q) => q.given === undefined);
  const idx = cur ?? (firstOpen === -1 ? qs.length : firstOpen);
  const answered = qs.filter((q) => q.given !== undefined).length;
  const correct = qs.filter((q) => q.correct).length;

  const submit = async () => {
    const q = qs[idx];
    const answer = q.type === "mcq" ? choice : Number(num);
    if (answer === null || (q.type === "numeric" && (num.trim() === "" || !Number.isFinite(answer)))) return;
    setBusy(true); setErr(null);
    try {
      const r = await api<{ correct: boolean; answer: number; explanation: string }>(`/practice/${d.id}/answer`, { body: { question_id: q.id, answer } });
      set.setData({ ...d, questions: qs.map((x, i) => (i === idx ? { ...x, given: answer as number, correct: r.correct, answer: r.answer, explanation: r.explanation } : x)) });
      setCur(idx);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const next = () => { setCur(idx + 1 < qs.length ? idx + 1 : qs.length); setChoice(null); setNum(""); };

  if (idx >= qs.length) {
    const pct = Math.round((correct / qs.length) * 100);
    return (
      <>
        <PageTitle crumbs={crumbs} title={d.kind === "checkup" ? "Check-up complete" : "Practice complete"} sub={`${d.test_title} · ${d.subject ?? ""}`} />
        <div className="card card-pad stack" style={{ maxWidth: 560 }}>
          <div className="value" style={{ fontSize: 44 }}>{correct}/{qs.length}</div>
          {d.kind === "checkup" && d.baseline_pct !== null
            ? <p>On these skills you scored <b>{d.baseline_pct}%</b> in the test. Now: <b style={{ color: pct >= (d.baseline_pct ?? 0) ? "var(--green)" : "var(--red)" }}>{pct}%</b>. {pct > (d.baseline_pct ?? 0) ? "That's real improvement. Well done!" : "Keep going: revise the explanations and try again with your teacher."}</p>
            : <p>{pct >= 80 ? "Excellent. These mistakes are fixed." : pct >= 50 ? "Good progress. Read the explanations for the ones you missed." : "Read each explanation carefully. Your check-up next week will show how much has stuck."}</p>}
          <div className="stack" style={{ gap: 8 }}>
            {qs.map((q, i) => <div key={q.id} className="row between small"><span>Q{i + 1}. {q.topic}</span><span className={`badge ${q.correct ? "green" : "red"}`}>{q.correct ? "✓" : "✗"}</span></div>)}
          </div>
          <Link to="/app/my" className="btn btn-primary" style={{ alignSelf: "flex-start" }}>Back to my tests</Link>
        </div>
      </>
    );
  }

  const q = qs[idx];
  const shown = q.given !== undefined;
  return (
    <>
      <PageTitle crumbs={crumbs} title={d.kind === "checkup" ? "Check-up" : "Fix-it practice"} sub={`${d.test_title} · ${d.subject ?? ""}`}>
        <span className="badge violet">{answered}/{qs.length} done · {correct} correct</span>
      </PageTitle>
      {d.focus && answered === 0 && <div className="card card-pad" style={{ marginBottom: 14, maxWidth: 720 }}>{d.focus}</div>}
      <div className="card card-pad stack" style={{ maxWidth: 720 }}>
        <div className="bar"><i style={{ width: `${(idx / qs.length) * 100}%` }} /></div>
        <div className="row wrap small"><b>Question {idx + 1} of {qs.length}</b><span className="badge">{q.topic}</span>{q.targets && <span className="muted">Fixes: {q.targets}</span>}</div>
        <div className="q-text" style={{ fontSize: 17 }}>{q.text}</div>
        {q.type === "mcq" ? (
          <div className="stack" style={{ gap: 8 }}>
            {q.options.map((o, i) => {
              const state = shown ? (i === q.answer ? "right" : i === q.given ? "wrong" : "") : choice === i ? "sel" : "";
              return (
                <button key={i} disabled={shown} onClick={() => setChoice(i)} className={`cbt-opt ${state === "sel" ? "sel" : ""}`}
                  style={state === "right" ? { borderColor: "var(--green)", background: "var(--green-soft)" } : state === "wrong" ? { borderColor: "var(--red)", background: "var(--red-soft)" } : undefined}>
                  <span className="k">{String.fromCharCode(65 + i)}</span>{o}
                </button>
              );
            })}
          </div>
        ) : (
          <label className="field" style={{ maxWidth: 260 }}><span>Your answer</span>
            <input className="input" type="number" step="any" inputMode="decimal" disabled={shown} value={shown ? String(q.given) : num} onChange={(e) => setNum(e.target.value)} /></label>
        )}
        {shown && (
          <div className={q.correct ? "ok-box" : "error-box"} style={{ color: "var(--ink)" }}>
            <b style={{ color: q.correct ? "var(--green)" : "var(--red)" }}>{q.correct ? "Correct!" : `Not quite. The answer is ${q.type === "mcq" ? String.fromCharCode(65 + (q.answer ?? 0)) : q.answer}.`}</b>
            <p style={{ marginTop: 6 }}>{q.explanation}</p>
          </div>
        )}
        <ErrorBox error={err} />
        <div className="row" style={{ justifyContent: "flex-end" }}>
          {shown ? <button className="btn btn-primary" onClick={next}>{idx + 1 < qs.length ? "Next question →" : "See my result"}</button>
            : <button className="btn btn-primary" disabled={busy || (q.type === "mcq" ? choice === null : num.trim() === "")} onClick={submit}>{busy ? "Checking…" : "Check answer"}</button>}
        </div>
      </div>
    </>
  );
}

export function EmptyPractice() { return <Empty title="No practice yet" icon="practice">Practice appears after your teacher publishes a test's results.</Empty>; }
