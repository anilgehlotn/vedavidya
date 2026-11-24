import { useParams } from "react-router-dom";
import { ErrorBox, Loading, Logo, useApi } from "../../components/ui";
import type { Section, SheetEvaluation } from "../../lib/types";

interface Report { org_name: string; student_name: string; test_title: string; subject: string | null; score: number; max_score: number; rank: number; evaluation: SheetEvaluation | null; sections: Section[] }

// Parent-facing report reached by a share link - no login required.
export default function PublicReport() {
  const { token } = useParams();
  const r = useApi<Report>(`/public/report/${token}`);
  if (r.loading) return <Loading />;
  if (!r.data) return <div className="site-wrap" style={{ padding: 40 }}><ErrorBox error={r.error} /></div>;
  const d = r.data;
  const qs = new Map(d.sections.flatMap((s) => s.questions).map((q) => [q.id, q]));
  const p = Math.round((d.score / d.max_score) * 100);
  return (
    <main className="site-wrap" style={{ maxWidth: 820, padding: "32px 20px 60px" }}>
      <div className="row between" style={{ marginBottom: 24 }}><Logo /><span className="small muted">Report shared by {d.org_name}</span></div>
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="row between wrap">
          <div><div className="eyebrow">{d.test_title} · {d.subject}</div><h1 style={{ fontSize: 30, marginTop: 6 }}>{d.student_name}</h1></div>
          <div className="row" style={{ gap: 24 }}>
            <div><div className="small muted">Score</div><b style={{ fontSize: 28 }}>{d.score}</b><span className="muted">/{d.max_score}</span></div>
            <div><div className="small muted">Percent</div><b style={{ fontSize: 28 }}>{p}%</b></div>
            <div><div className="small muted">Rank</div><b style={{ fontSize: 28 }}>#{d.rank}</b></div>
          </div>
        </div>
        {d.evaluation?.overall_feedback && <p style={{ marginTop: 14, color: "var(--ink-2)" }}>{d.evaluation.overall_feedback}</p>}
        {!!d.evaluation?.gaps.length && <div className="row wrap" style={{ marginTop: 12 }}><span className="small muted">Focus areas:</span>{d.evaluation.gaps.map((g) => <span key={g} className="badge red">{g}</span>)}</div>}
      </div>
      <div className="card">
        <div className="table-wrap"><table className="t">
          <thead><tr><th>#</th><th>Topic</th><th>Marks</th><th>Feedback</th></tr></thead>
          <tbody>{d.evaluation?.questions.map((qe, i) => (
            <tr key={qe.question_id}><td>Q{i + 1}</td><td className="small">{qs.get(qe.question_id)?.topic}</td>
              <td><span className={`badge ${qe.marks_awarded >= qe.max_marks ? "green" : qe.marks_awarded > 0 ? "amber" : "red"}`}>{qe.marks_awarded}/{qe.max_marks}</span></td>
              <td className="small">{qe.feedback}</td></tr>))}
          </tbody>
        </table></div>
      </div>
    </main>
  );
}
