import { Link, useParams, useSearchParams } from "react-router-dom";
import { BarList, Columns, Empty, ErrorBox, LineChart, Loading, PageTitle, ScoreBadge, useApi } from "../../components/ui";
import { useAuth } from "../../lib/auth";

interface BatchData {
  batch: { id: string; name: string; centre_name: string | null; course: string | null }; student_count: number;
  trend: { test_id: string; title: string; avg: number; top: number }[];
  topics: { topic: string; pct: number }[];
  leaderboard: { id: string; name: string; avg: number; tests: number }[];
  distribution: { label: string; count: number }[];
}

export function Analytics() {
  const [params, setParams] = useSearchParams();
  const batches = useApi<{ id: string; name: string }[]>("/batches");
  const batchId = params.get("batch") ?? batches.data?.[0]?.id ?? null;
  const data = useApi<BatchData>(batchId ? `/analytics/batch/${batchId}` : null);

  if (batches.loading) return <Loading />;
  if (!batches.data?.length) return <><PageTitle title="Analytics" /><div className="card"><Empty title="Create a batch and run a test to see analytics" /></div></>;
  const d = data.data;
  return (
    <>
      <PageTitle title="Analytics" sub={d ? `${d.batch.name} · ${d.batch.centre_name ?? ""} · ${d.student_count} students` : undefined}>
        <select className="input" style={{ width: 240 }} value={batchId ?? ""} onChange={(e) => setParams({ batch: e.target.value })}>
          {batches.data.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </PageTitle>
      <ErrorBox error={data.error} />
      {data.loading || !d ? <Loading /> : !d.trend.length ? <div className="card"><Empty title="No evaluated tests for this batch yet" /></div> : (
        <>
          <div className="grid g4" style={{ marginBottom: 16 }}>
            <div className="card stat"><div className="label">Tests analysed</div><div className="value">{d.trend.length}</div></div>
            <div className="card stat"><div className="label">Latest average</div><div className="value">{d.trend.at(-1)!.avg}%</div></div>
            <div className="card stat"><div className="label">Change since first</div><div className="value" style={{ color: d.trend.at(-1)!.avg >= d.trend[0].avg ? "var(--green)" : "var(--red)" }}>{d.trend.at(-1)!.avg - d.trend[0].avg >= 0 ? "+" : ""}{d.trend.at(-1)!.avg - d.trend[0].avg}%</div></div>
            <div className="card stat"><div className="label">Weakest topic</div><div className="value" style={{ fontSize: 18, marginTop: 10 }}>{d.topics[0]?.topic ?? "—"}</div></div>
          </div>
          <div className="grid g2" style={{ marginBottom: 16 }}>
            <div className="card card-pad">
              <div className="row between" style={{ marginBottom: 8 }}><b>Score trend</b>
                <div className="row small"><span className="badge violet">● Batch average</span><span className="badge green">● Top score</span></div></div>
              <LineChart labels={d.trend.map((t) => t.title)} series={[{ name: "Average", color: "#68003c", values: d.trend.map((t) => t.avg) }, { name: "Top", color: "#138a55", values: d.trend.map((t) => t.top), dashed: true }]} />
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
  trend: { test_id: string; title: string; date: string; pct: number; class_avg: number }[];
  topics: { topic: string; pct: number }[]; gaps: string[]; average: number | null;
}

export function StudentReport({ self }: { self?: boolean }) {
  const params = useParams();
  const { user } = useAuth();
  const id = self ? user!.id : params.id!;
  const r = useApi<StudentData>(`/analytics/student/${id}`);
  if (r.loading) return <Loading />;
  if (!r.data) return <ErrorBox error={r.error} />;
  const d = r.data;
  return (
    <>
      <PageTitle title={self ? "My report card" : d.student.name} sub={`${d.student.batch_name ?? ""} · Roll ${d.student.roll_no ?? "—"} · ${d.trend.length} tests`}>
        <button className="btn btn-ghost no-print" onClick={() => window.print()}>Print</button>
      </PageTitle>
      {!d.trend.length ? <div className="card"><Empty title="No published results yet" /></div> : (
        <>
          <div className="grid g3" style={{ marginBottom: 16 }}>
            <div className="card stat"><div className="label">Average score</div><div className="value">{d.average}%</div></div>
            <div className="card stat"><div className="label">Latest test</div><div className="value">{d.trend.at(-1)!.pct}%</div><div className="small muted">class avg {d.trend.at(-1)!.class_avg}%</div></div>
            <div className="card stat"><div className="label">Strongest topic</div><div className="value" style={{ fontSize: 18, marginTop: 10 }}>{d.topics.at(-1)?.topic ?? "—"}</div></div>
          </div>
          <div className="grid g2" style={{ marginBottom: 16 }}>
            <div className="card card-pad">
              <div className="row between" style={{ marginBottom: 8 }}><b>Progress</b><div className="row small"><span className="badge violet">● {self ? "Me" : "Student"}</span><span className="badge">● Class average</span></div></div>
              <LineChart labels={d.trend.map((t) => t.title)} series={[{ name: "Student", color: "#68003c", values: d.trend.map((t) => t.pct) }, { name: "Class", color: "#9a96a5", values: d.trend.map((t) => t.class_avg), dashed: true }]} />
            </div>
            <div className="card card-pad"><b>Topic mastery</b><p className="small muted" style={{ marginBottom: 14 }}>Weakest first</p><BarList items={d.topics.slice(0, 8).map((t) => ({ label: t.topic, value: t.pct }))} /></div>
          </div>
          {d.gaps.length > 0 && <div className="card card-pad"><b>Focus next on</b><div className="row wrap" style={{ marginTop: 10 }}>{d.gaps.map((g) => <span key={g} className="badge red">{g}</span>)}</div></div>}
        </>
      )}
    </>
  );
}
