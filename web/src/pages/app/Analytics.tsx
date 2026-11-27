import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { BarList, Columns, Empty, ErrorState, LineChart, PageSkeleton, PageTitle, ScoreBadge, SkeletonStats, useApi } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { MistakeBars, TopTip } from "./Insights";

interface BatchData {
  batch: { id: string; name: string; centre_name: string | null; course: string | null }; student_count: number;
  trend: { test_id: string; title: string; avg: number; top: number }[];
  topics: { topic: string; pct: number }[];
  leaderboard: { id: string; name: string; avg: number; tests: number }[];
  distribution: { label: string; count: number }[];
  subjects: { subject: string; avg: number; tests: number }[]; subject: string | null;
}

function SubjectPicker({ subjects, value, onChange }: { subjects: { subject: string }[]; value: string; onChange: (v: string) => void }) {
  if (subjects.length < 2 && !value) return null;
  return (
    <select className="input" style={{ width: 200 }} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Subject">
      <option value="">All subjects</option>
      {subjects.map((x) => <option key={x.subject} value={x.subject}>{x.subject}</option>)}
    </select>
  );
}

export function Analytics() {
  const [params, setParams] = useSearchParams();
  const batches = useApi<{ id: string; name: string }[]>("/batches");
  const batchId = params.get("batch") ?? batches.data?.[0]?.id ?? null;
  const subject = params.get("subject") ?? "";
  const data = useApi<BatchData>(batchId ? `/analytics/batch/${batchId}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}` : null);

  if (batches.loading) return <PageSkeleton />;
  if (!batches.data) return <><PageTitle title="Analytics" /><div className="card"><ErrorState error={batches.error} onRetry={() => batches.reload()} /></div></>;
  if (!batches.data.length) return <><PageTitle title="Analytics" /><div className="card"><Empty title="Nothing to analyse yet" icon="chart" action={<Link to="/app/batches" className="btn btn-primary btn-sm">Go to batches</Link>}>Create a batch and run a test to see score trends, topics and the leaderboard.</Empty></div></>;
  const d = data.data;
  return (
    <>
      <PageTitle title="Analytics" sub={d ? [d.batch.name, d.batch.centre_name, `${d.student_count} students`].filter(Boolean).join(" · ") : undefined}>
        {d && <SubjectPicker subjects={d.subjects} value={subject} onChange={(v) => setParams(v ? { batch: batchId!, subject: v } : { batch: batchId! })} />}
        <select className="input" style={{ width: 240 }} value={batchId ?? ""} onChange={(e) => setParams({ batch: e.target.value })}>
          {batches.data.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </PageTitle>
      {data.loading ? <SkeletonStats /> : !d ? <div className="card"><ErrorState error={data.error} onRetry={() => data.reload()} /></div>
        : !d.trend.length ? <div className="card"><Empty title="No marked tests for this batch yet" icon="chart">Analytics appear once a test for this batch has been marked.</Empty></div> : (
        <>
          <div className="grid g4" style={{ marginBottom: 16 }}>
            <div className="card stat"><div className="label">Tests analysed</div><div className="value">{d.trend.length}</div></div>
            <div className="card stat"><div className="label">Latest average</div><div className="value">{d.trend.at(-1)!.avg}%</div></div>
            <div className="card stat"><div className="label">Change since first</div><div className="value" style={{ color: d.trend.at(-1)!.avg >= d.trend[0].avg ? "var(--green)" : "var(--red)" }}>{d.trend.at(-1)!.avg - d.trend[0].avg >= 0 ? "+" : ""}{d.trend.at(-1)!.avg - d.trend[0].avg}%</div></div>
            <div className="card stat"><div className="label">Weakest topic</div><div className="value" style={{ fontSize: 18, marginTop: 10 }}>{d.topics[0]?.topic ?? "—"}</div></div>
          </div>
          {d.subjects.length > 1 && !subject && (
            <div className="card card-pad" style={{ marginBottom: 16 }}><b>By subject</b><p className="small muted" style={{ marginBottom: 14 }}>Class average per subject. Pick a subject above to see only its tests.</p>
              <BarList items={d.subjects.map((x) => ({ label: x.subject, value: x.avg, sub: `${x.avg}% · ${x.tests} result${x.tests === 1 ? "" : "s"}` }))} /></div>
          )}
          <div className="grid g2" style={{ marginBottom: 16 }}>
            <div className="card card-pad">
              <div className="row between" style={{ marginBottom: 8 }}><b>Score trend</b>
                <div className="row small"><span className="badge violet">● Batch average</span><span className="badge green">● Top score</span></div></div>
              <LineChart labels={d.trend.map((t) => t.title)} series={[{ name: "Average", color: "#ff6a4c", values: d.trend.map((t) => t.avg) }, { name: "Top", color: "#138a55", values: d.trend.map((t) => t.top), dashed: true }]} />
            </div>
            <div className="card card-pad"><b>Topic mastery</b><p className="small muted" style={{ marginBottom: 14 }}>Share of marks earned per topic across all tests - weakest first</p>
              <BarList items={d.topics.slice(0, 8).map((t) => ({ label: t.topic, value: t.pct }))} /></div>
          </div>
          <div className="grid g2">
            <div className="card card-pad"><b>Score distribution</b><p className="small muted" style={{ marginBottom: 14 }}>Students by average %</p><Columns items={d.distribution.map((x) => ({ label: x.label, value: x.count }))} /></div>
            <div className="card">
              <div className="card-pad" style={{ paddingBottom: 6 }}><b>Leaderboard</b></div>
              <div className="table-wrap" style={{ maxHeight: 300, overflowY: "auto" }}><table className="t"><tbody>
                {d.leaderboard.map((s, i) => (
                  <tr key={s.id}><td className="muted">#{i + 1}</td><td><Link to={`/app/students/${s.id}`} className="btn-link" style={{ color: "var(--ink)" }}>{s.name}</Link></td><td className="small muted">{s.tests} tests</td><td><ScoreBadge value={s.avg} /></td></tr>))}
              </tbody></table></div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

interface StudentData {
  student: { id: string; name: string; username: string; roll_no: string | null; batch_name: string | null };
  trend: { test_id: string; title: string; subject: string; date: string; pct: number; class_avg: number }[];
  topics: { topic: string; pct: number }[]; gaps: string[]; average: number | null;
  subjects: { subject: string; avg: number; tests: number }[]; subject: string | null;
  mistakes: Record<string, number>;
  practice: { sets: number; completed: number; checkups_done: number; before_pct: number | null; after_pct: number | null };
}

export function StudentReport({ self }: { self?: boolean }) {
  const params = useParams();
  const { user } = useAuth();
  const id = self ? user!.id : params.id!;
  const [subject, setSubject] = useState("");
  const r = useApi<StudentData>(`/analytics/student/${id}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`);
  if (r.loading) return <PageSkeleton />;
  if (!r.data) return <><PageTitle title={self ? "My report card" : "Student report"} crumbs={self ? [] : undefined} /><div className="card"><ErrorState error={r.error} onRetry={() => r.reload()} /></div></>;
  const d = r.data;
  return (
    <>
      <PageTitle title={self ? "My report card" : d.student.name} crumbs={self ? [] : undefined} sub={`${d.student.batch_name ?? ""} · Roll ${d.student.roll_no ?? "—"} · ${d.trend.length} tests`}>
        <SubjectPicker subjects={d.subjects} value={subject} onChange={setSubject} />
        <button className="btn btn-ghost no-print" onClick={() => window.print()}>Print</button>
      </PageTitle>
      {d.subjects.length > 1 && !subject && (
        <div className="card card-pad" style={{ marginBottom: 16 }}><b>By subject</b>
          <div style={{ marginTop: 14 }}><BarList items={d.subjects.map((x) => ({ label: x.subject, value: x.avg, sub: `${x.avg}% · ${x.tests} test${x.tests === 1 ? "" : "s"}` }))} /></div></div>
      )}
      {!d.trend.length ? <div className="card"><Empty title="No published results yet" icon="report">{self ? "Your scores appear here once your teacher publishes a test's results." : "Scores appear once a test with this student is published."}</Empty></div> : (
        <>
          <div className="grid g3" style={{ marginBottom: 16 }}>
            <div className="card stat"><div className="label">Average score</div><div className="value">{d.average}%</div></div>
            <div className="card stat"><div className="label">Latest test</div><div className="value">{d.trend.at(-1)!.pct}%</div><div className="small muted">class avg {d.trend.at(-1)!.class_avg}%</div></div>
            <div className="card stat"><div className="label">Strongest topic</div><div className="value" style={{ fontSize: 18, marginTop: 10 }}>{d.topics.at(-1)?.topic ?? "—"}</div></div>
          </div>
          <div className="grid g2" style={{ marginBottom: 16 }}>
            <div className="card card-pad">
              <div className="row between" style={{ marginBottom: 8 }}><b>Progress</b><div className="row small"><span className="badge violet">● {self ? "Me" : "Student"}</span><span className="badge">● Class average</span></div></div>
              <LineChart labels={d.trend.map((t) => t.title)} series={[{ name: "Student", color: "#ff6a4c", values: d.trend.map((t) => t.pct) }, { name: "Class", color: "#9a96a5", values: d.trend.map((t) => t.class_avg), dashed: true }]} />
            </div>
            <div className="card card-pad"><b>Topic mastery</b><p className="small muted" style={{ marginBottom: 14 }}>Weakest first</p><BarList items={d.topics.slice(0, 8).map((t) => ({ label: t.topic, value: t.pct }))} /></div>
          </div>
          <div className="grid g2" style={{ marginBottom: 16 }}>
            <div className="card card-pad"><b>Where {self ? "your" : "the"} marks go</b><p className="small muted" style={{ margin: "4px 0 14px" }}>Marks lost across all tests, by reason</p>
              <MistakeBars data={d.mistakes} /><TopTip data={d.mistakes} /></div>
            <div className="card card-pad"><b>Fix-it practice</b>
              {d.practice.sets ? <div className="stack" style={{ gap: 10, marginTop: 12 }}>
                <div className="row between small"><span>Practice sets completed</span><b>{d.practice.completed}/{d.practice.sets}</b></div>
                <div className="row between small"><span>Check-ups done</span><b>{d.practice.checkups_done}</b></div>
                {d.practice.after_pct !== null && <div className="row between small"><span>On weak spots: test → check-up</span><b>{d.practice.before_pct}% → <span style={{ color: (d.practice.after_pct ?? 0) >= (d.practice.before_pct ?? 0) ? "var(--green)" : "var(--red)" }}>{d.practice.after_pct}%</span></b></div>}
              </div> : <p className="small muted" style={{ marginTop: 8 }}>Practice sets appear after results are published.</p>}
            </div>
          </div>
          {d.gaps.length > 0 && <div className="card card-pad"><b>Focus next on</b><div className="row wrap" style={{ marginTop: 10 }}>{d.gaps.map((g) => <span key={g} className="badge red">{g}</span>)}</div></div>}
        </>
      )}
    </>
  );
}
