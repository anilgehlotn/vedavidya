// Home dashboard: greeting, centre/course filters, four stat cards with 30-day trends,
// a course & batch chart, recent students and recent tests.
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Empty, ErrorState, PageTitle, ScoreBadge, SkeletonStats, useApi } from "../../components/ui";
import { Icon, type IconName } from "../../components/icons";
import { fmtDate } from "../../lib/api";
import { useAuth } from "../../lib/auth";

interface Card { total: number; new_30d: number }
interface ChartBatch { id: string; name: string; centre_name: string | null; students: number; avg_pct: number | null }
interface Data {
  cards: Record<"students" | "teachers" | "batches" | "tests", Card>;
  courses: { id: string | null; name: string; batches: ChartBatch[] }[];
  recentStudents: { id: string; name: string; created_at: string; roll_no: string | null; batch_name: string; course_name: string | null }[];
  recentTests: { id: string; title: string; mode: string; scheduled_at: string; results_published: number; candidates: number; evaluated: number; avg_pct: number | null }[];
}

const CARDS: { key: keyof Data["cards"]; label: string; icon: IconName; to: string }[] = [
  { key: "students", label: "Students", icon: "student", to: "/app/students" },
  { key: "teachers", label: "Teachers", icon: "staff", to: "/app/teachers" },
  { key: "batches", label: "Batches", icon: "batches", to: "/app/batches" },
  { key: "tests", label: "Tests", icon: "tests", to: "/app/tests" },
];
const greeting = () => { const h = new Date().getHours(); return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening"; };
const initials = (n: string) => n.split(" ").filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

export default function Overview() {
  const { user, org } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const centre = params.get("centre") ?? "", course = params.get("course") ?? "";
  const qs = new URLSearchParams({ ...(centre ? { centre_id: centre } : {}), ...(course ? { course_id: course } : {}) }).toString();
  const ov = useApi<Data>(`/overview${qs ? `?${qs}` : ""}`);
  const centres = useApi<{ id: string; name: string }[]>("/centres");
  const courses = useApi<{ id: string; name: string }[]>("/courses");
  const setFilter = (k: "centre" | "course", v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v); else n.delete(k);
    setParams(n, { replace: true });
  };
  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const d = ov.data;

  return (
    <>
      <PageTitle title={`Good ${greeting()}, ${user!.name.split(" ")[0]}`} sub={`${today} · ${org?.name ?? ""}`}>
        <Link to="/app/papers/new" className="btn btn-ghost">✦ Generate paper</Link>
        <Link to="/app/tests?new=1" className="btn btn-primary">+ New test</Link>
      </PageTitle>

      <div className="filters" role="group" aria-label="Filters">
        <select className="input" value={centre} onChange={(e) => setFilter("centre", e.target.value)} aria-label="Centre">
          <option value="">All centres</option>{centres.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="input" value={course} onChange={(e) => setFilter("course", e.target.value)} aria-label="Course">
          <option value="">All courses</option>{courses.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {(centre || course) && <button className="btn btn-ghost btn-sm" onClick={() => setParams({}, { replace: true })}>Clear filters</button>}
      </div>

      {ov.loading && !d ? <SkeletonStats /> : !d ? <div className="card"><ErrorState error={ov.error} onRetry={() => ov.reload()} /></div> : (
        <>
          <div className="grid g4 stat-grid" style={{ marginBottom: 16 }}>
            {CARDS.map((c) => {
              const v = d.cards[c.key];
              return (
                <Link key={c.key} to={c.to} className="card stat stat-link">
                  <div className="row between"><span className="label">{c.label}</span><span className="stat-ic"><Icon name={c.icon} size={18} /></span></div>
                  <div className="value">{v.total}</div>
                  {v.new_30d > 0 ? <span className="trend up">+{v.new_30d} new <span className="muted">(last 30 days)</span></span>
                    : <span className="trend muted">No new in the last 30 days</span>}
                </Link>
              );
            })}
          </div>
          <div className="grid split" style={{ marginBottom: 16 }}>
            <div className="card card-pad">
              <div className="row between" style={{ marginBottom: 4 }}><b>Courses & batches</b><Link to="/app/batches" className="btn-link small">Batches →</Link></div>
              <p className="small muted" style={{ marginBottom: 16 }}>Students in each batch, grouped by course. Hover a bar for details.</p>
              <CourseChart courses={d.courses} />
            </div>
            <div className="card card-pad">
              <div className="row between" style={{ marginBottom: 12 }}><b>Recent students</b><Link to="/app/students" className="btn-link small">All →</Link></div>
              {!d.recentStudents.length ? <Empty title="No students yet" icon="student" action={<Link to="/app/students" className="btn btn-primary btn-sm">Add students</Link>} /> : (
                <ul className="people-list">
                  {d.recentStudents.map((s) => (
                    <li key={s.id}><Link to={`/app/students/${s.id}`}>
                      <span className="ava-sm">{initials(s.name)}</span>
                      <span className="grow"><b>{s.name}</b><span className="small muted">{[s.batch_name, s.roll_no && `Roll ${s.roll_no}`].filter(Boolean).join(" · ")}</span></span>
                      <span className="small muted">{fmtDate(s.created_at.replace(" ", "T") + "Z")}</span>
                    </Link></li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="card">
            <div className="row between card-pad" style={{ paddingBottom: 8 }}><b>Recent tests</b><Link to="/app/tests" className="btn-link small">View all →</Link></div>
            {d.recentTests.length ? (
              <div className="table-wrap"><table className="t">
                <thead><tr><th>Test</th><th>Date</th><th>Progress</th><th>Avg</th><th>Status</th></tr></thead>
                <tbody>{d.recentTests.map((t) => (
                  <tr key={t.id} className="click" onClick={() => nav(`/app/tests/${t.id}`)}>
                    <td><Link to={`/app/tests/${t.id}`} className="row-link"><b>{t.title}</b></Link><div className="small muted">{t.mode === "cbt" ? "Online" : "Handwritten"}</div></td>
                    <td className="small">{fmtDate(t.scheduled_at)}</td>
                    <td className="small">{t.evaluated}/{t.candidates} marked</td>
                    <td><ScoreBadge value={t.avg_pct == null ? null : Math.round(t.avg_pct)} /></td>
                    <td>{t.results_published ? <span className="badge green">Published</span> : <span className="badge">Draft</span>}</td>
                  </tr>))}
                </tbody>
              </table></div>
            ) : <Empty title="No tests yet" icon="tests" action={<Link to="/app/tests?new=1" className="btn btn-primary btn-sm">+ New test</Link>}>Create a test for a class, add the paper, then upload the answer sheets.</Empty>}
          </div>
        </>
      )}
    </>
  );
}

/** Vertical bars: one per batch (height = students), grouped under their course. */
function CourseChart({ courses }: { courses: Data["courses"] }) {
  const [tip, setTip] = useState<{ b: ChartBatch; course: string; x: number; y: number } | null>(null);
  const all = courses.flatMap((c) => c.batches);
  if (!all.length) return <Empty title="No batches yet" icon="batches" action={<Link to="/app/batches" className="btn btn-primary btn-sm">Create a batch</Link>} />;
  const max = Math.max(1, ...all.map((b) => b.students));
  return (
    <div className="cchart" onMouseLeave={() => setTip(null)}>
      <div className="cchart-groups" role="img" aria-label={courses.map((c) => `${c.name}: ${c.batches.map((b) => `${b.name} ${b.students} students`).join(", ")}`).join("; ")}>
        {courses.map((c) => (
          <div key={c.id ?? "none"} className="cchart-group">
            <div className="cchart-bars">
              {c.batches.map((b) => (
                <button key={b.id} type="button" className="cchart-bar" style={{ height: `${Math.max(4, (b.students / max) * 100)}%` }}
                  aria-label={`${b.name}: ${b.students} students${b.avg_pct != null ? `, average ${Math.round(b.avg_pct)}%` : ""}`}
                  onMouseEnter={(e) => { const r = e.currentTarget.getBoundingClientRect(), p = e.currentTarget.closest(".cchart")!.getBoundingClientRect(); setTip({ b, course: c.name, x: r.left - p.left + r.width / 2, y: r.top - p.top }); }}
                  onFocus={(e) => { const r = e.currentTarget.getBoundingClientRect(), p = e.currentTarget.closest(".cchart")!.getBoundingClientRect(); setTip({ b, course: c.name, x: r.left - p.left + r.width / 2, y: r.top - p.top }); }}
                  onBlur={() => setTip(null)}>
                  <span className="cchart-val">{b.students}</span>
                </button>
              ))}
            </div>
            <div className="cchart-label" title={c.name}>{c.name}</div>
          </div>
        ))}
      </div>
      {tip && (
        <div className="cchart-tip" style={{ left: tip.x, top: tip.y }} role="tooltip">
          <b>{tip.b.name}</b><span>{tip.course}{tip.b.centre_name ? ` · ${tip.b.centre_name}` : ""}</span>
          <span>{tip.b.students} student{tip.b.students === 1 ? "" : "s"}{tip.b.avg_pct != null ? ` · avg ${Math.round(tip.b.avg_pct)}%` : ""}</span>
        </div>
      )}
    </div>
  );
}

