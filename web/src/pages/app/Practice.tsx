// Practice Questions (teachers): Fix-it practice for every test. Each student who lost marks gets questions
// aimed at their mistakes, then a check-up a week later; this page shows progress and improvement per test.
import { Link } from "react-router-dom";
import { Empty, ErrorState, PageTitle, SkeletonTable, useApi } from "../../components/ui";
import { fmtDate } from "../../lib/api";

interface Row { id: string; title: string; created_at: string; subject: string | null; students: number; preparing: number; failed: number;
  completed: number; checkup_done: number; baseline_avg: number | null; checkup_avg: number | null }

export default function Practice() {
  const r = useApi<Row[]>("/practice/overview");
  const rows = r.data ?? [];
  const totals = rows.reduce((t, x) => ({ students: t.students + x.students, completed: t.completed + x.completed, checkups: t.checkups + x.checkup_done }), { students: 0, completed: 0, checkups: 0 });
  return (
    <>
      <PageTitle title="Practice Questions" sub="Fix-it practice: questions aimed at each student's own mistakes, made when you publish results." />
      {r.loading ? <div className="card card-pad"><SkeletonTable rows={4} cols={5} /></div>
        : r.error && !r.data ? <div className="card"><ErrorState error={r.error} onRetry={() => r.reload()} /></div>
        : !rows.length ? (
          <div className="card"><Empty title="No practice yet" icon="practice" action={<Link className="btn btn-primary btn-sm" to="/app/tests">Go to tests</Link>}>
            When you publish a test's results, every student who lost marks gets 5–8 practice questions on exactly those mistakes, and a check-up a week later.
          </Empty></div>
        ) : (
          <>
            <div className="grid g3" style={{ marginBottom: 16 }}>
              <div className="card stat"><div className="label">Students given practice</div><div className="value">{totals.students}</div></div>
              <div className="card stat"><div className="label">Practice completed</div><div className="value">{totals.completed}</div></div>
              <div className="card stat"><div className="label">Check-ups done</div><div className="value">{totals.checkups}</div></div>
            </div>
            <div className="card"><div className="table-wrap"><table className="t">
              <thead><tr><th>Test</th><th>Students</th><th>Practice done</th><th>Check-ups</th><th>Improvement on weak spots</th></tr></thead>
              <tbody>{rows.map((x) => (
                <tr key={x.id}>
                  <td><Link to={`/app/tests/${x.id}`} style={{ fontWeight: 600, textDecoration: "none" }}>{x.title}</Link>
                    <div className="small muted">{[x.subject, fmtDate(x.created_at)].filter(Boolean).join(" · ")}</div></td>
                  <td>{x.students}{x.preparing > 0 && <div><span className="badge amber"><span className="dot pulse" />{x.preparing} preparing</span></div>}
                    {x.failed > 0 && <div><span className="badge red">{x.failed} couldn't be made</span></div>}</td>
                  <td>{x.completed} <span className="muted small">of {x.students}</span></td>
                  <td>{x.checkup_done}</td>
                  <td>{x.checkup_avg == null || x.baseline_avg == null ? <span className="muted small">After the first check-ups</span> : (
                    <span className={`badge ${x.checkup_avg >= x.baseline_avg ? "green" : "red"}`}>{x.baseline_avg}% → {x.checkup_avg}%</span>)}</td>
                </tr>))}
              </tbody>
            </table></div></div>
          </>
        )}
    </>
  );
}
