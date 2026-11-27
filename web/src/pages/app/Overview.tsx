import { Link, useNavigate } from "react-router-dom";
import { BarList, ErrorState, PageSkeleton, PageTitle, ScoreBadge, useApi, Empty } from "../../components/ui";
import { fmtDate } from "../../lib/api";
import { useAuth } from "../../lib/auth";

interface Data {
  stats: Record<string, number>;
  recentTests: { id: string; title: string; mode: string; scheduled_at: string; results_published: number; candidates: number; evaluated: number; avg_pct: number | null }[];
  batchPerf: { id: string; name: string; attempts: number; avg_pct: number | null }[];
}

export default function Overview() {
  const { data, error, loading, reload } = useApi<Data>("/overview");
  const { user, org } = useAuth();
  const nav = useNavigate();
  if (loading) return <PageSkeleton />;
  if (!data) return <><PageTitle title="Home" /><div className="card"><ErrorState error={error} onRetry={() => reload()} /></div></>;
  const s = data.stats;
  return (
    <>
      <PageTitle title={`Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, ${user!.name.split(" ")[0]}`} sub={`${org?.name} at a glance`}>
        <Link to="/app/papers/new" className="btn btn-ghost">✦ Generate paper</Link>
        <Link to="/app/tests?new=1" className="btn btn-primary">+ New test</Link>
      </PageTitle>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        {[["Students", s.students], ["Batches", `${s.batches}`], ["Tests run", s.tests], ["Sheets evaluated", s.sheets_evaluated]].map(([l, v]) => (
          <div key={l as string} className="card stat"><div className="label">{l}</div><div className="value">{v}</div></div>
        ))}
      </div>
      <div className="grid split">
        <div className="card">
          <div className="row between card-pad" style={{ paddingBottom: 8 }}><b>Recent tests</b><Link to="/app/tests" className="btn-link small">View all →</Link></div>
          {data.recentTests.length ? (
            <div className="table-wrap"><table className="t">
              <thead><tr><th>Test</th><th>Date</th><th>Progress</th><th>Avg</th><th>Status</th></tr></thead>
              <tbody>{data.recentTests.map((t) => (
                <tr key={t.id} className="click" onClick={() => nav(`/app/tests/${t.id}`)}>
                  <td><b>{t.title}</b><div className="small muted">{t.mode === "cbt" ? "Online" : "Handwritten"}</div></td>
                  <td className="small">{fmtDate(t.scheduled_at)}</td>
                  <td className="small">{t.evaluated}/{t.candidates} marked</td>
                  <td><ScoreBadge value={t.avg_pct == null ? null : Math.round(t.avg_pct)} /></td>
                  <td>{t.results_published ? <span className="badge green">Published</span> : <span className="badge">Draft</span>}</td>
                </tr>))}
              </tbody>
            </table></div>
          ) : <Empty title="No tests yet" icon="tests" action={<Link to="/app/tests?new=1" className="btn btn-primary btn-sm">+ New test</Link>}>Create a test for a class, add the paper, then upload the answer sheets.</Empty>}
        </div>
        <div className="card card-pad">
          <div className="row between" style={{ marginBottom: 16 }}><b>Batch performance</b><Link to="/app/analytics" className="btn-link small">Analytics →</Link></div>
          {!data.batchPerf.some((b) => b.avg_pct != null) ? <Empty title="No results yet" icon="chart">Batch averages appear once tests are marked.</Empty> : <BarList items={data.batchPerf.filter((b) => b.avg_pct != null).map((b) => ({ label: b.name, value: Math.round(b.avg_pct!), sub: `${Math.round(b.avg_pct!)}% avg` }))} />}
        </div>
      </div>
    </>
  );
}
