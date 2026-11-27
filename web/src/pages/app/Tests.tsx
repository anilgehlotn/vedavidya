import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, blobUrl, fetchBlob, csvCell, DEMO, download, fmtDate, fmtDateTime, pct } from "../../lib/api";
import type { AttemptStatus, Paper, Question, SheetEvaluation } from "../../lib/types";
import { Empty, ErrorBox, ErrorState, Loading, Modal, PageSkeleton, PageTitle, ScoreBadge, SkeletonCards, SkeletonStats, SkeletonTable, StatusBadge, useApi } from "../../components/ui";
import { Icon } from "../../components/icons";
import type { Course } from "./Courses";
import { useToast } from "../../components/toast";
import { useAuth } from "../../lib/auth";
import { checkFile, uploadFile, type UploadedFile } from "../../lib/chunkUpload";
import { FileUpload } from "../../components/FileUpload";
import { FixitCell, MistakeBars, MISTAKES, TestInsights, TopTip, useInsights } from "./Insights";
import { CreditLine } from "./Credits";
import { ClassUploadWizard, PaperStep, Step, type ClassUpload } from "./TestFlow";
import { SendReportsModal } from "./SendReports";
import { MathText } from "../../components/MathText";
// The corrected-sheet viewer (with maths rendering) loads only when a marked sheet is opened.
const SheetView = lazy(() => import("./SheetView").then((m) => ({ default: m.SheetView })));

interface TestRow { id: string; title: string; mode: "offline" | "cbt"; scheduled_at: string | null; created_at: string; results_published: number; paper_id: string | null; paper_title: string | null; paper_status: string | null; total_marks: number | null; subject: string | null; batch_names: string | null; candidates: number; evaluated: number; uploaded: number;
  course_id: string | null; subject_id: string | null; course_name: string | null; state: "draft" | "scheduled" | "live" | "completed"; avg_pct: number | null }
interface TestStats { tests: number; sheets_marked: number; avg_this_month: number | null; avg_last_month: number | null; results_this_month: number; change: number | null; to_mark: number; to_publish: number;
  by_state: Record<"draft" | "scheduled" | "live" | "completed", number> }
const RANGES: [string, string][] = [["30d", "Last 30 days"], ["90d", "Last 3 months"], ["180d", "Last 6 months"], ["365d", "Last 12 months"], ["all", "All time"]];
const STATE: Record<TestRow["state"], [string, string]> = { draft: ["Draft", ""], scheduled: ["Scheduled", "blue"], live: ["Live", "amber"], completed: ["Completed", "violet"] };

const SUBJECTS = ["Physics", "Chemistry", "Biology", "Mathematics", "Science", "English", "Hindi", "Social Science", "Computer Science", "Accountancy", "Economics"];
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const nice = (d: string) => new Date(d + "T00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/** What the teacher should do next for a test, shown in the list. */
function nextStep(t: TestRow): [string, string] {
  if (t.results_published) return ["Published", "green"];
  if (!t.paper_id) return ["Add question paper", "amber"];
  if (t.paper_status === "generating") return ["Reading paper…", "blue"];
  if (t.mode === "offline" && t.uploaded < t.candidates && t.evaluated === 0) return [`Upload sheets ${t.uploaded}/${t.candidates}`, "violet"];
  if (t.mode === "offline" && t.uploaded > t.evaluated) return [`Mark ${t.uploaded - t.evaluated} sheets`, "violet"];
  if (t.evaluated > 0) return ["Ready to publish", "violet"];
  return [t.mode === "cbt" ? "Waiting for students" : "Upload sheets", ""];
}

export function TestList() {
  const [params, setParams] = useSearchParams();
  const course = params.get("course") ?? "", subject = params.get("subject") ?? "", range = params.get("range") ?? "all";
  const tests = useApi<TestRow[]>("/tests");
  const courses = useApi<Course[]>("/courses");
  const scope = new URLSearchParams({ range, ...(course ? { course_id: course } : {}), ...(subject ? { subject_id: subject } : {}) }).toString();
  const stats = useApi<TestStats>(`/tests/stats?${scope}`);
  const nav = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"all" | "action" | "published" | "draft">("all");
  const setParam = (k: string, v: string) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); if (k === "course") n.delete("subject"); setParams(n, { replace: true }); };
  const subjects = courses.data?.find((c) => c.id === course)?.subjects ?? [];
  const days = { "30d": 30, "90d": 90, "180d": 180, "365d": 365 }[range];
  const inScope = (tests.data ?? []).filter((t) => (!course || t.course_id === course) && (!subject || t.subject_id === subject) &&
    (!days || Date.parse((t.scheduled_at ?? t.created_at).replace(" ", "T") + (/[zZ+]/.test(t.scheduled_at ?? t.created_at) ? "" : "Z")) >= Date.now() - days * 86400000));
  const needsAction = (t: TestRow) => !t.results_published && (!t.paper_id || t.uploaded > t.evaluated || t.evaluated > 0 || (t.mode === "offline" && t.uploaded < t.candidates));
  const list = inScope.filter((t) => (tab === "all" || (tab === "published" ? t.results_published : tab === "draft" ? !t.paper_id : needsAction(t))) &&
    (!q || `${t.title} ${t.subject ?? ""} ${t.batch_names ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  const recent = inScope.slice(0, 6);
  const st = stats.data;
  const downloadAll = () => download(`/tests/summary.csv?${scope}`, "test_results_summary.csv").then(() => toast.success("Results summary downloaded.")).catch((e) => toast.error((e as Error).message));

  return (
    <>
      <PageTitle title="Tests" sub="Create a test for a class, add the paper, then upload the answer sheets after the exam">
        {!DEMO && <button className="btn btn-ghost" onClick={downloadAll} disabled={!inScope.length}>⤓ Download results</button>}
        <button className="btn btn-primary" onClick={() => setParams({ new: "1", ...(params.get("paper") ? { paper: params.get("paper")! } : {}) })}>+ New test</button>
      </PageTitle>
      <div className="filters" role="group" aria-label="Filters">
        <select className="input" value={course} onChange={(e) => setParam("course", e.target.value)} aria-label="Course">
          <option value="">All courses</option>{courses.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {course && subjects.length > 0 && <select className="input" value={subject} onChange={(e) => setParam("subject", e.target.value)} aria-label="Subject">
          <option value="">All subjects</option>{subjects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>}
        <select className="input" value={range} onChange={(e) => setParam("range", e.target.value === "all" ? "" : e.target.value)} aria-label="Time range">
          {RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {(course || subject || range !== "all") && <button className="btn btn-ghost btn-sm" onClick={() => setParams({}, { replace: true })}>Clear filters</button>}
      </div>

      {stats.loading && !st ? <SkeletonStats /> : !st ? <div className="card" style={{ marginBottom: 16 }}><ErrorState error={stats.error} onRetry={() => stats.reload()} /></div> : (
        <div className="grid g4 stat-grid" style={{ marginBottom: 20 }}>
          <div className="card stat"><div className="label">Tests</div><div className="value">{st.tests}</div>
            <span className="trend muted">{[st.by_state.live && `${st.by_state.live} live`, st.by_state.scheduled && `${st.by_state.scheduled} scheduled`, st.by_state.draft && `${st.by_state.draft} draft`].filter(Boolean).join(" · ") || "—"}</span></div>
          <div className="card stat"><div className="label">Sheets marked</div><div className="value">{st.sheets_marked}</div><span className="trend muted">by AI, checked by you</span></div>
          <div className="card stat"><div className="label">Average this month</div><div className="value">{st.avg_this_month == null ? "—" : `${st.avg_this_month}%`}</div>
            {st.change == null ? <span className="trend muted">{st.avg_last_month == null ? "No results last month" : `Last month ${st.avg_last_month}%`}</span>
              : <span className={`trend ${st.change >= 0 ? "up" : "down"}`}>{st.change >= 0 ? "▲" : "▼"} {Math.abs(st.change)}% <span className="muted">vs last month</span></span>}</div>
          <div className="card stat"><div className="label">Waiting for you</div><div className="value">{st.to_mark + st.to_publish}</div>
            <span className="trend muted">{st.to_mark} sheet{st.to_mark === 1 ? "" : "s"} to mark · {st.to_publish} to publish</span></div>
        </div>
      )}

      {tests.loading ? <SkeletonCards count={3} height={160} /> : !tests.data ? <div className="card"><ErrorState error={tests.error} onRetry={() => tests.reload()} /></div>
        : !tests.data.length ? (
          <div className="card"><Empty title="No tests yet" icon="tests" action={<button className="btn btn-primary btn-sm" onClick={() => setParams({ new: "1" })}>+ Create your first test</button>}>Create a test for a class, add the paper, then upload the answer sheets after the exam.</Empty></div>
        ) : !inScope.length ? (
          <div className="card"><Empty title="No tests match these filters" icon="search" action={<button className="btn btn-ghost btn-sm" onClick={() => setParams({}, { replace: true })}>Clear filters</button>}>Try another course, subject or time range.</Empty></div>
        ) : (
          <>
            <div className="row between" style={{ marginBottom: 10 }}><h2 className="h-sec">Recent tests</h2>
              <button className="btn-link small" onClick={() => document.getElementById("all-tests")?.scrollIntoView({ behavior: "smooth" })}>Explore all {inScope.length} →</button></div>
            <div className="grid g3" style={{ marginBottom: 24 }}>
              {recent.map((t) => {
                const [label, tone] = nextStep(t);
                const pctDone = t.candidates ? (t.evaluated / t.candidates) * 100 : 0;
                return (
                  <Link key={t.id} to={`/app/tests/${t.id}`} className="card card-pad test-card">
                    <div className="row between"><span className={`badge ${t.results_published ? "green" : STATE[t.state][1]}`}>{t.state === "live" && <span className="dot pulse" />}{t.results_published ? "Published" : STATE[t.state][0]}</span>
                      <span className="small muted">{fmtDate(t.scheduled_at ?? t.created_at)}</span></div>
                    <b className="test-title">{t.title}</b>
                    <span className="small muted">{[t.subject, t.batch_names, t.mode === "cbt" ? "Online" : "On paper"].filter(Boolean).join(" · ")}</span>
                    <div><div className="row between small"><span>{t.evaluated}/{t.candidates} marked</span>{t.avg_pct != null && <span>Avg <b>{t.avg_pct}%</b></span>}</div>
                      <div className="bar" style={{ marginTop: 6 }}><i style={{ width: `${pctDone}%` }} /></div></div>
                    {!t.results_published && <span className="small next-step">Next: <span className={`badge ${tone}`}>{label}</span></span>}
                  </Link>
                );
              })}
            </div>
            <div className="card" id="all-tests">
              <div className="card-pad row between wrap" style={{ paddingBottom: 6, gap: 10 }}>
                <div className="tabs" role="tablist" style={{ margin: 0, border: 0 }}>
                  {([["all", "All"], ["action", "Needs action"], ["published", "Published"], ["draft", "No paper yet"]] as const).map(([k, l]) => (
                    <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
                  ))}
                </div>
                <div className="search-field"><Icon name="search" size={16} /><input className="input" placeholder="Search tests…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tests" /></div>
              </div>
              {!list.length ? <Empty title="No tests here" icon="tests">Try another tab or search.</Empty> : (
                <div className="table-wrap"><table className="t">
                  <thead><tr><th>Test</th><th>Class</th><th>Date</th><th>Marked</th><th>Avg</th><th>Next step</th></tr></thead>
                  <tbody>{list.map((t) => {
                    const [label, tone] = nextStep(t);
                    return (
                      <tr key={t.id} className="click" onClick={() => nav(`/app/tests/${t.id}`)}>
                        <td><Link to={`/app/tests/${t.id}`} className="row-link"><b>{t.title}</b></Link><div className="small muted">{[t.subject, t.mode === "cbt" ? "Online" : "On paper", t.paper_id && t.total_marks ? `${t.total_marks} marks` : null].filter(Boolean).join(" · ")}</div></td>
                        <td className="small">{t.batch_names ?? "—"}</td>
                        <td className="small">{fmtDate(t.scheduled_at ?? t.created_at)}</td>
                        <td><div className="small">{t.evaluated}/{t.candidates}</div><div className="bar" style={{ width: 90, marginTop: 4 }}><i style={{ width: `${t.candidates ? (t.evaluated / t.candidates) * 100 : 0}%` }} /></div></td>
                        <td><ScoreBadge value={t.avg_pct} /></td>
                        <td><span className={`badge ${tone}`}>{label}</span></td>
                      </tr>);
                  })}
                  </tbody>
                </table></div>
              )}
            </div>
          </>
        )}
      {params.has("new") && <NewTestModal paperId={params.get("paper")} onClose={() => { const n = new URLSearchParams(params); n.delete("new"); n.delete("paper"); setParams(n); }} />}
    </>
  );
}

function NewTestModal({ paperId, onClose }: { paperId: string | null; onClose: () => void }) {
  const nav = useNavigate();
  const batches = useApi<{ id: string; name: string; student_count: number }[]>("/batches");
  const paper = useApi<Paper>(paperId ? `/papers/${paperId}` : null);
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [date, setDate] = useState(today());
  const [mode, setMode] = useState<"offline" | "cbt">("offline");
  const [title, setTitle] = useState("");
  const [titleEdited, setTitleEdited] = useState(false);
  const [more, setMore] = useState(false);
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (paper.data?.subject && !subject) setSubject(paper.data.subject); }, [paper.data]);
  const autoTitle = [subject.trim() || "Test", "test", date ? `· ${nice(date)}` : ""].join(" ").replace("Test test", "Test");
  useEffect(() => { if (!titleEdited) setTitle(paper.data?.title ?? autoTitle); }, [autoTitle, paper.data, titleEdited]);

  const create = async (e: FormEvent) => {
    e.preventDefault(); setError(null); setBusy(true);
    try {
      const when = date ? new Date(`${date}T${time || "09:00"}`).toISOString() : undefined;
      const r = await api<{ id: string }>("/tests", { body: { title: title.trim() || autoTitle, subject: subject.trim() || undefined, mode, scheduled_at: when,
        duration_min: duration ? Number(duration) : undefined, batch_ids: batchIds, paper_id: paperId || undefined } });
      nav(`/app/tests/${r.id}`);
    } catch (err) { setError((err as Error).message); setBusy(false); }
  };
  const toggle = (id: string) => setBatchIds(batchIds.includes(id) ? batchIds.filter((x) => x !== id) : [...batchIds, id]);

  return (
    <Modal title="New test" onClose={onClose}>
      {batches.data && !batches.data.length ? <Empty title="Add a class first" icon="batches" action={<Link to="/app/batches" className="btn btn-primary btn-sm">Go to batches</Link>}>A test is given to one or more classes (batches). Create one and add its students.</Empty> : (
        <form className="stack" onSubmit={create}>
          <div className="field"><span>1. Which class?</span>
            <div className="row wrap">{batches.data?.map((b) => (
              <button type="button" key={b.id} className={`pick-chip ${batchIds.includes(b.id) ? "on" : ""}`} onClick={() => toggle(b.id)} aria-pressed={batchIds.includes(b.id)}>
                {batchIds.includes(b.id) ? "✓ " : ""}{b.name} <span className="muted">· {b.student_count}</span>
              </button>))}
            </div>
          </div>
          <label className="field"><span>2. Subject</span>
            <input className="input" list="subjects" placeholder="e.g. Physics" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={60} />
            <datalist id="subjects">{SUBJECTS.map((s) => <option key={s} value={s} />)}</datalist>
          </label>
          <div className="grid g2">
            <label className="field"><span>3. Exam date</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <div className="field"><span>How do students answer?</span>
              <div className="row">
                <button type="button" className={`pick-chip ${mode === "offline" ? "on" : ""}`} onClick={() => setMode("offline")}>On paper</button>
                <button type="button" className={`pick-chip ${mode === "cbt" ? "on" : ""}`} onClick={() => setMode("cbt")}>Online (MCQ)</button>
              </div>
            </div>
          </div>
          <label className="field"><span>Test name</span><input className="input" value={title} maxLength={160} onChange={(e) => { setTitle(e.target.value); setTitleEdited(true); }} /></label>
          {paperId && paper.data && <div className="small">Question paper: <b>{paper.data.title}</b> ({paper.data.total_marks} marks)</div>}
          {!more ? <button type="button" className="btn-link small" style={{ alignSelf: "flex-start" }} onClick={() => setMore(true)}>More options (time, duration)</button> : (
            <div className="grid g2">
              <label className="field"><span>Start time</span><input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
              <label className="field"><span>Duration (min)</span><input className="input" type="number" min={5} max={360} placeholder="60" value={duration} onChange={(e) => setDuration(e.target.value)} /></label>
            </div>
          )}
          <ErrorBox error={error} />
          <button className="btn btn-primary" disabled={!batchIds.length || busy}>{busy ? "Creating…" : batchIds.length ? "Create test →" : "Choose a class to continue"}</button>
          {!paperId && <p className="small muted" style={{ margin: 0, textAlign: "center" }}>Next you can add the question paper and, after the exam, upload the answer sheets.</p>}
        </form>
      )}
    </Modal>
  );
}

interface AttemptRow { processing: string | null; checks: number; phone: string | null; parent_phone: string | null; id: string; status: AttemptStatus; score: number | null; max_score: number | null; error: string | null; reviewed: number; files: number; student_id: string; student_name: string; roll_no: string | null; batch_name: string; share_token: string | null }
interface TestDetailData extends TestRow { duration_min: number; paper: Paper | null; paper_problem: string | null; attempts: AttemptRow[]; uploads: ClassUpload[] }

/** Upload one student's sheet: resumable upload with progress and cancel; pages are processed in the background. */
function UploadCell({ a, onDone }: { a: AttemptRow; onDone: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);
  const send = async (list: FileList | null) => {
    const files = [...(list ?? [])];
    if (!files.length) return;
    setErr(null); setProgress(0);
    const c = new AbortController(); ctrl.current = c;
    try {
      const total = files.reduce((t, f) => t + f.size, 0);
      let before = 0;
      const ids: string[] = [];
      for (const f of files) {
        const check = await checkFile(f, "student_sheet");
        if (!check.ok) throw new Error(check.error);
        const u = await uploadFile(f, "student_sheet", { signal: c.signal, onProgress: (sent) => setProgress(Math.min(99, Math.floor(((before + sent) / Math.max(1, total)) * 100))) });
        ids.push(u.id); before += f.size;
      }
      await api(`/attempts/${a.id}/files`, { body: { upload_ids: ids } });
      onDone();
    } catch (e) { if ((e as Error).name !== "AbortError") setErr((e as Error).message); }
    finally { setProgress(null); ctrl.current = null; if (ref.current) ref.current.value = ""; }
  };
  if (a.processing) return <span className="small muted"><span className="spinner" /> Processing pages…</span>;
  return (
    <>
      <input ref={ref} type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" style={{ display: "none" }} onChange={(e) => send(e.target.files)} />
      {progress != null
        ? <span className="row" style={{ gap: 6 }}><span className="small">Uploading {progress}%</span><button className="btn btn-ghost btn-sm" onClick={() => ctrl.current?.abort()}>Cancel</button></span>
        : <button className="btn btn-ghost btn-sm" onClick={() => ref.current?.click()}>{a.files ? `↻ ${a.files} page${a.files > 1 ? "s" : ""}` : "⇪ Upload sheet"}</button>}
      {err && <div className="small" style={{ color: "var(--red)", maxWidth: 260 }}>{err}</div>}
    </>
  );
}

interface BulkResult { students: number; files: number; unmatched: string[]; ambiguous: string[]; busy: string[] }
/** Files named by roll number ("7.jpg", "7-1.jpg", "Roll 12.pdf"): uploaded (resumable), then matched to students. */
function BulkUploadModal({ testId, batches, onClose, onDone }: { testId: string; batches: string[]; onClose: () => void; onDone: () => void }) {
  const [uploads, setUploads] = useState<UploadedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setError(null); setSaving(true);
    try { const r = await api<BulkResult>(`/tests/${testId}/bulk-files`, { body: { upload_ids: uploads.map((u) => u.id) } }); setResult(r); onDone(); }
    catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  };
  return (
    <Modal title="Upload sheets named by roll number" onClose={busy || saving ? () => {} : onClose} wide>
      <div className="stack">
        {result ? (
          <div className="ok-box">
            Received <b>{result.files}</b> file{result.files === 1 ? "" : "s"} for <b>{result.students}</b> student{result.students === 1 ? "" : "s"}. Pages are being prepared now.
            {result.unmatched.length > 0 && <div style={{ color: "var(--red)", marginTop: 6 }}>No student with that roll number: {result.unmatched.join(", ")}</div>}
            {result.ambiguous.length > 0 && <div style={{ color: "var(--amber)", marginTop: 6 }}>Roll number used in more than one batch (upload these from the student's row): {result.ambiguous.join(", ")}</div>}
            {result.busy.length > 0 && <div style={{ color: "var(--amber)", marginTop: 6 }}>Skipped while being marked: {result.busy.join(", ")}</div>}
          </div>
        ) : (
          <>
            <p className="small" style={{ margin: 0 }}>Name each photo or PDF with the student's <b>roll number first</b>. For several pages, add a page number:
              <code> 7.jpg</code>, <code>7-1.jpg</code>, <code>7-2.jpg</code>, <code>Roll 12.pdf</code>. Pages are put in order by file name.</p>
            {batches.length > 1 && <p className="small" style={{ color: "var(--amber)", margin: 0 }}>This test has more than one batch ({batches.join(", ")}). If two students share a roll number, upload those from each student's row instead.</p>}
            <FileUpload purpose="student_sheet" multiple label="Answer sheet files" onChange={(u, b) => { setUploads(u); setBusy(b); }} />
          </>
        )}
        <ErrorBox error={error} />
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" disabled={saving} onClick={onClose}>{result ? "Done" : "Cancel"}</button>
          {!result && <button className="btn btn-primary" disabled={!uploads.length || busy || saving} onClick={start}>{saving ? "Matching…" : busy ? "Uploading…" : `Match ${uploads.length || ""} file${uploads.length === 1 ? "" : "s"} to students`}</button>}
        </div>
      </div>
    </Modal>
  );
}

const waNumber = (phone: string | null) => {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length === 10 ? `91${d}` : d.length >= 11 && d.length <= 13 ? d.replace(/^0+/, "") : "";
};
const reportUrl = (token: string) => `${location.origin}/report/${token}`;
const resultMessage = (a: AttemptRow, test: string, org: string) =>
  `Hello! ${a.student_name}'s result for "${test}"${org ? ` at ${org}` : ""}: ${a.score}/${a.max_score} (${pct(a.score, a.max_score)}%). ` +
  `See the full report with feedback here: ${reportUrl(a.share_token!)}`;

export function TestDetail() {
  const { id } = useParams();
  const t = useApi<TestDetailData>(`/tests/${id}`);
  const { org, user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const setMsg = (m: string) => toast.success(m);
  const [err, setErrText] = useState<string | null>(null);
  const setErr = (e: string | null) => { setErrText(e); if (e) toast.error(e); };
  const wasBusy = useRef(false);
  const [filter, setFilter] = useState<"all" | "check" | AttemptStatus>("all");
  const [bulk, setBulk] = useState(false);
  const [wizard, setWizard] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [markedBusy, setMarkedBusy] = useState<string | null>(null);
  const [showSteps, setShowSteps] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);

  const busy = t.data?.attempts.some((a) => a.status === "evaluating");
  // Keep the page live while sheets are being processed in the background.
  const processing = Boolean(t.data?.attempts.some((a) => a.processing) || t.data?.uploads?.some((u) => u.status === "queued" || u.status === "processing"));
  const reading = t.data?.paper?.status === "generating";
  const ins = useInsights(id!, Boolean(busy));
  useEffect(() => {
    if (busy) wasBusy.current = true;
    else if (wasBusy.current) { wasBusy.current = false; toast.success("All sheets are marked. Check any flagged sheet below, then publish."); }
    if (!busy && !reading && !processing) return;
    const i = setInterval(() => t.reload(true), 3000);
    return () => clearInterval(i);
  }, [busy, reading, processing]);

  if (t.loading) return <PageSkeleton />;
  if (!t.data) return <><PageTitle title="Test" /><div className="card"><ErrorState error={t.error} onRetry={() => t.reload()} /></div></>;
  const d = t.data;
  const scored = d.attempts.filter((a) => a.score != null);
  const avg = scored.length ? Math.round(scored.reduce((s, a) => s + pct(a.score, a.max_score)!, 0) / scored.length) : null;
  const high = scored.length ? Math.max(...scored.map((a) => pct(a.score, a.max_score)!)) : null;
  const withSheets = d.attempts.filter((a) => a.files > 0).length;
  const toEvaluate = d.attempts.filter((a) => a.files > 0 && (a.status === "uploaded" || a.status === "failed")).length;
  const marking = d.attempts.filter((a) => a.status === "evaluating").length;
  const submitted = d.attempts.filter((a) => a.status !== "pending" && a.status !== "in_progress").length;
  const ranked = [...scored].sort((a, b) => b.score! - a.score!).map((a) => a.id);
  const rankOf = (id: string) => { const i = ranked.indexOf(id); return i < 0 ? Infinity : i; };
  // Rank list: best score first; students without a score after them, by roll number.
  const list = d.attempts.filter((a) => filter === "all" || (filter === "check" ? a.checks > 0 : a.status === filter))
    .sort((a, b) => rankOf(a.id) - rankOf(b.id) || String(a.roll_no ?? "").localeCompare(String(b.roll_no ?? ""), undefined, { numeric: true }));
  const toCheck = d.attempts.reduce((t, a) => t + (a.checks || 0), 0);
  const sheetsToCheck = d.attempts.filter((a) => a.checks > 0).length;
  const total = d.paper?.total_marks;
  const offline = d.mode === "offline";

  const evaluate = async (ids?: string[]) => {
    setErr(null);
    try {
      const r = await api<{ queued: number }>(`/tests/${d.id}/evaluate`, { body: ids ? { attempt_ids: ids } : {} });
      setMsg(r.queued ? `Marking ${r.queued} answer sheet${r.queued > 1 ? "s" : ""}… you can leave this page, it keeps going.` : "Nothing to mark. Upload answer sheets first.");
      t.reload(true);
    } catch (e) { setErr((e as Error).message); }
  };
  const publish = async (publish: boolean) => {
    if (publish && toCheck && !confirm(`${toCheck} answer${toCheck > 1 ? "s" : ""} on ${sheetsToCheck} sheet${sheetsToCheck > 1 ? "s" : ""} still need your check. Publish anyway?`)) return;
    let r: { practice_queued: number };
    try { r = await api<{ practice_queued: number }>(`/tests/${d.id}/publish`, { body: { publish } }); }
    catch (e) { setErr((e as Error).message); return; }
    setMsg(publish ? `Results published. Students see them when they log in, and parent links are active.${r.practice_queued ? ` Fix-it practice is being prepared for ${r.practice_queued} student${r.practice_queued === 1 ? "" : "s"}.` : ""}` : "Results hidden from students.");
    ins.reload(true);
    t.reload(true);
  };
  const downloadLinks = () => {
    const esc = csvCell;
    const rows = d.attempts.filter((a) => a.share_token && a.score != null).map((a) =>
      [a.roll_no, a.student_name, a.batch_name, a.parent_phone, a.phone, a.score, a.max_score, `${pct(a.score, a.max_score)}%`, reportUrl(a.share_token!)].map(esc).join(","));
    const csv = ["Roll,Name,Batch,Parent phone,Student phone,Score,Max,Percent,Report link", ...rows].join("\n");
    const el = document.createElement("a");
    el.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    el.download = `${d.title.replace(/\W+/g, "_")}_report_links.csv`;
    el.click();
  };
  const pdf = async (path: string, name: string) => {
    setErr(null); setPdfBusy(true);
    try { await download(path, `${d.title.replace(/\W+/g, "_")}_${name}.pdf`); } catch (e) { setErr((e as Error).message); } finally { setPdfBusy(false); }
  };
  // Every marked student's answer sheet with the corrections drawn on, in roll order, as one PDF.
  const downloadMarked = async () => {
    setErr(null);
    const list = scored.filter((a) => a.files > 0).sort((a, b) => (Number(a.roll_no) || 1e9) - (Number(b.roll_no) || 1e9) || a.student_name.localeCompare(b.student_name));
    try {
      const [{ markedCopyPdf }, { layoutMarks }] = await Promise.all([import("../../lib/markedCopy"), import("../../lib/marks")]);
      const sheets = [];
      for (const [i, a] of list.entries()) {
        setMarkedBusy(`Preparing ${i + 1} of ${list.length}…`);
        const at = await api<AttemptData>(`/attempts/${a.id}`);
        const pages = await Promise.all(Array.from({ length: at.files }, async (_, n) => {
          if (at.page_types?.[n] === "pdf") return null;
          return fetchBlob(`/attempts/${a.id}/files/${n}`).catch(() => null);
        }));
        sheets.push({ pages, layout: layoutMarks(at.evaluation, at.files, at.paper.sections), total: { score: at.score ?? 0, max: at.max_score ?? 0 }, label: `Roll ${a.roll_no ?? "-"} · ${a.student_name}` });
      }
      setMarkedBusy("Making the PDF…");
      const out = await markedCopyPdf(sheets, `${d.title} - marked answer sheets`);
      const el = document.createElement("a");
      el.href = URL.createObjectURL(out); el.download = `${d.title.replace(/\W+/g, "_")}_marked_answer_sheets.pdf`; el.click();
      setTimeout(() => URL.revokeObjectURL(el.href), 10000);
    } catch (e) { setErr((e as Error).message); }
    finally { setMarkedBusy(null); }
  };
  const copyLink = (token: string) => { navigator.clipboard?.writeText(`${location.origin}/report/${token}`); setMsg("Parent report link copied."); };

  // Where the teacher is in the flow.
  const paperDone = Boolean(d.paper && !d.paper_problem);
  const sheetsDone = offline ? withSheets > 0 : submitted > 0;
  const markedAll = scored.length > 0 && !marking && toEvaluate === 0;
  const st = (done: boolean, current: boolean) => (done ? "done" : current ? "current" : "todo") as "done" | "current" | "todo";
  const s1 = st(paperDone, true);
  const s2 = st(offline ? withSheets > 0 && (withSheets === d.attempts.length || scored.length > 0) : submitted > 0, paperDone || !d.paper || reading || offline);
  const s3 = st(markedAll, sheetsDone);
  const s4 = st(Boolean(d.results_published), markedAll || scored.length > 0);

  // The single next thing to do, for the banner.
  const next: { text: string; action?: { label: string; run: () => void; primary?: boolean }; busy?: boolean } =
    d.results_published ? { text: "Results are out. Students can see them, and each parent can get their report." }
    : !d.paper ? { text: "Add the question paper for this test.", action: { label: "Add paper", run: () => setShowSteps(true), primary: true } }
    : reading ? { text: "The AI is reading the question paper…", busy: true }
    : d.paper_problem ? { text: d.paper_problem, action: { label: "Open the steps", run: () => setShowSteps(true) } }
    : offline && withSheets === 0 && !scored.length ? { text: "After the exam, upload the class's answer sheets.", action: DEMO ? undefined : { label: "⇪ Upload answer sheets", run: () => setWizard(true), primary: true } }
    : !offline && submitted === 0 ? { text: "Waiting for students to take the test online." }
    : marking > 0 ? { text: `Marking ${marking} sheet${marking > 1 ? "s" : ""}… ${scored.length} done. You can leave this page.`, busy: true }
    : toEvaluate > 0 ? { text: `${toEvaluate} answer sheet${toEvaluate === 1 ? " is" : "s are"} ready to mark.`, action: DEMO ? undefined : { label: `✦ Mark ${toEvaluate} sheet${toEvaluate === 1 ? "" : "s"}`, run: () => evaluate(), primary: true } }
    : !d.results_published && toCheck > 0 ? { text: `${toCheck} answer${toCheck > 1 ? "s" : ""} on ${sheetsToCheck} sheet${sheetsToCheck > 1 ? "s" : ""} need your check before publishing.`, action: { label: "Show them", run: () => setFilter("check"), primary: true } }
    : !d.results_published && scored.length ? { text: "All marked. Check any sheet, then publish the results.", action: DEMO ? undefined : { label: "Publish results", run: () => publish(true), primary: true } }
    : d.results_published ? { text: "Results are out. Students can see them, and each parent can get their report." }
    : { text: "Nothing to do yet." };
  const stepN = !paperDone ? 1 : !sheetsDone ? 2 : !markedAll ? 3 : 4;
  const absent = offline ? d.attempts.filter((a) => a.files === 0 && a.score == null).length : d.attempts.filter((a) => a.status === "pending" || a.status === "in_progress").length;
  const present = d.attempts.length - absent;
  const low = scored.length ? Math.min(...scored.map((a) => pct(a.score, a.max_score)!)) : null;
  const statusCount = (s: string) => d.attempts.filter((a) => a.status === s).length;
  const downloads = [
    scored.length > 0 && { label: "Results (CSV)", run: () => download(`/tests/${d.id}/results.csv`, `${d.title.replace(/\W+/g, "_")}_results.csv`).catch((e) => setErr(e.message)) },
    scored.length > 0 && { label: "Class report (PDF)", run: () => pdf(`/tests/${d.id}/class-report.pdf`, "class_report") },
    scored.length > 0 && { label: "All student reports (PDF)", run: () => pdf(`/tests/${d.id}/reports.pdf`, "student_reports") },
    offline && scored.some((a) => a.files > 0) && { label: markedBusy ?? "Marked answer sheets (PDF)", run: downloadMarked },
    d.results_published && { label: "Parent report links (CSV)", run: downloadLinks },
  ].filter(Boolean) as { label: string; run: () => void }[];

  return (
    <>
      <PageTitle title={d.title} sub={[d.subject, d.batch_names].filter(Boolean).join(" · ")}>
        {!DEMO && downloads.length > 0 && <MenuButton label="⤓ Downloads" items={downloads} disabled={!!markedBusy || pdfBusy} />}
        {d.results_published && !DEMO && <button className="btn btn-primary" onClick={() => setSendOpen(true)}>✉ Send reports</button>}
      </PageTitle>
      {pdfBusy && <div className="ok-box" style={{ marginBottom: 14 }}><span className="spinner" /> Making the PDF…</div>}
      {err && <div className="error-box" role="alert" style={{ marginBottom: 14 }}><div className="row between" style={{ alignItems: "flex-start" }}><span>{err}</span><button className="btn-link" style={{ color: "inherit" }} onClick={() => setErrText(null)} aria-label="Dismiss">×</button></div></div>}

      <dl className="info-strip card">
        <div><dt>Date</dt><dd>{d.scheduled_at ? fmtDateTime(d.scheduled_at) : fmtDate(d.created_at)}</dd></div>
        <div><dt>Mode</dt><dd>{offline ? "On paper" : "Online"}</dd></div>
        <div><dt>Class</dt><dd>{d.batch_names ?? "—"}</dd></div>
        <div><dt>Paper</dt><dd>{d.paper ? <Link to={`/app/papers/${d.paper.id}`} className="btn-link">{d.paper.title}</Link> : "Not added"}</dd></div>
        <div><dt>Marks · time</dt><dd>{total ? `${total} marks` : "—"} · {d.duration_min} min</dd></div>
        <div><dt>Status</dt><dd><span className={`badge ${d.results_published ? "green" : STATE[d.state][1]}`}>{d.results_published ? "Published" : STATE[d.state][0]}</span></dd></div>
      </dl>

      <div className={`next-banner ${d.results_published ? "done" : ""}`} role="status">
        <span className="step-dots" aria-label={`Step ${stepN} of 4`}>{[1, 2, 3, 4].map((i) => <i key={i} className={i < stepN || d.results_published ? "done" : i === stepN ? "now" : ""} />)}</span>
        {next.busy && <span className="spinner" />}
        <span className="grow"><b>{d.results_published ? "Done" : `Step ${stepN} of 4`}:</b> {next.text}</span>
        {next.action && <button className={`btn btn-sm ${next.action.primary ? "btn-primary" : "btn-ghost"}`} onClick={next.action.run}>{next.action.label}</button>}
        {next.action?.label.startsWith("✦ Mark") && !d.paper_problem && <CreditLine action="mark_sheet" units={toEvaluate} />}
        <button className="btn-link small" onClick={() => setShowSteps(!showSteps)} aria-expanded={showSteps}>{showSteps ? "Hide steps" : "All steps"}</button>
      </div>
      {showSteps && <div className="card card-pad steps" style={{ marginBottom: 16 }}>
        <PaperStep t={d} state={s1} onChange={() => { setMsg("Question paper added."); t.reload(true); }} />
        {offline ? (
          <Step n={2} title="Answer sheets" state={s2} hint="After the exam">
            <div className="row wrap" style={{ marginTop: 10 }}>
              {!DEMO && <button className={`btn ${s2 === "current" && withSheets === 0 ? "btn-primary" : "btn-ghost"}`} onClick={() => setWizard(true)}>⇪ Upload class answer sheets</button>}
              <span className="small"><b>{withSheets}</b> of {d.attempts.length} students uploaded</span>
              <div className="bar grow" style={{ minWidth: 80, maxWidth: 200 }}><i style={{ width: `${d.attempts.length ? (withSheets / d.attempts.length) * 100 : 0}%` }} /></div>
            </div>
            {!DEMO && <div className="small muted" style={{ marginTop: 8 }}>One scanned PDF in roll-number order works best. Files already named by roll number? <button className="btn-link" onClick={() => setBulk(true)}>Upload by file name</button>. One student only? Use “Upload” on their row below.</div>}
          </Step>
        ) : (
          <Step n={2} title="Students take the test online" state={s2}>
            <div className="small" style={{ marginTop: 8 }}>{d.paper ? <>Students open it from their login at the test time. <b>{submitted}</b> of {d.attempts.length} submitted.</> : "Add the question paper so students can start."}</div>
          </Step>
        )}
        <Step n={3} title={offline ? "AI marking" : "Scores"} state={s3}>
          {offline ? (
            <div className="row wrap" style={{ marginTop: 10 }}>
              {marking > 0 ? <><span className="spinner" /><span className="small"><b>Marking {marking} sheet{marking > 1 ? "s" : ""}…</b> {scored.length} done. You can leave this page.</span></>
                : <button className={`btn ${toEvaluate ? "btn-primary" : "btn-ghost"}`} disabled={!toEvaluate || DEMO} onClick={() => evaluate()}>✦ Mark {toEvaluate || ""} answer sheet{toEvaluate === 1 ? "" : "s"}</button>}
              {toEvaluate > 0 && !marking && d.paper_problem && <span className="small" style={{ color: "var(--amber)" }}>{d.paper_problem}</span>}
              {toEvaluate > 0 && !marking && !d.paper_problem && !DEMO && <CreditLine action="mark_sheet" units={toEvaluate} />}
              {scored.length > 0 && !marking && <span className="small">{scored.length} marked · average <b>{avg}%</b>. Open any sheet to check or change marks.</span>}
              {toCheck > 0 && <button className="btn btn-ghost btn-sm" style={{ borderColor: "var(--amber)", color: "var(--amber)" }} onClick={() => setFilter("check")}>⚠ {toCheck} answer{toCheck > 1 ? "s" : ""} need your check</button>}
            </div>
          ) : <div className="small" style={{ marginTop: 8 }}>{scored.length ? <>{scored.length} scored automatically · average <b>{avg}%</b></> : "Scored automatically when each student submits."}</div>}
        </Step>
        <Step n={4} title="Share results" state={s4}>
          <div className="row wrap" style={{ marginTop: 10 }}>
            {d.results_published ? <>
              <span className="small">Students can see their results. Send each parent their report on WhatsApp from the list below.</span>
              {!DEMO && <button className="btn btn-ghost btn-sm" onClick={() => publish(false)}>Unpublish</button>}
            </> : <>
              <button className={`btn ${scored.length ? "btn-primary" : "btn-ghost"}`} disabled={!scored.length || DEMO} onClick={() => publish(true)}>Publish results</button>
              <span className="small muted">Students see marks and feedback; each one gets personal Fix-it practice.</span>
            </>}
          </div>
        </Step>
      </div>}
      {bulk && <BulkUploadModal testId={d.id} batches={(d.batch_names ?? "").split(", ").filter(Boolean)} onClose={() => setBulk(false)} onDone={() => t.reload(true)} />}
      {wizard && <ClassUploadWizard t={d} uploads={d.uploads} onClose={() => setWizard(false)} onDone={(n) => { t.reload(true); if (n) setMsg(`Answer sheets uploaded for ${n} student${n === 1 ? "" : "s"}.${d.paper_problem ? "" : " Next: click “Mark answer sheets”."}`); }} />}


      <div className="grid g3" style={{ marginBottom: 16 }}>
        <div className="card card-pad">
          <div className="row between"><b>Attendance</b><span className="small muted">{offline ? "sheets received" : "submitted online"}</span></div>
          <div className="attend">
            <Donut value={present} total={d.attempts.length} />
            <div className="stack" style={{ gap: 6 }}>
              <span><b>{present}</b> <span className="muted small">present</span></span>
              <span><b>{absent}</b> <span className="muted small">{offline ? "no sheet yet" : "not taken"}</span></span>
              {absent > 0 && <button className="btn-link small" style={{ alignSelf: "flex-start" }} onClick={() => setFilter(offline ? "pending" : "pending")}>Show who</button>}
            </div>
          </div>
        </div>
        <div className="card card-pad">
          <div className="row between"><b>Evaluation progress</b><span className="small muted">{scored.length}/{present || d.attempts.length} marked</span></div>
          <div className="bar" style={{ margin: "12px 0" }}><i style={{ width: `${(present || d.attempts.length) ? (scored.length / (present || d.attempts.length)) * 100 : 0}%` }} /></div>
          <div className="row wrap" style={{ gap: 6 }}>
            {statusCount("evaluated") > 0 && <span className="badge green">{statusCount("evaluated")} marked</span>}
            {marking > 0 && <span className="badge amber"><span className="dot pulse" />{marking} marking</span>}
            {statusCount("uploaded") > 0 && <span className="badge violet">{statusCount("uploaded")} waiting</span>}
            {statusCount("failed") > 0 && <button className="badge red badge-btn" onClick={() => setFilter("failed")}>{statusCount("failed")} problem{statusCount("failed") > 1 ? "s" : ""}</button>}
            {toCheck > 0 && <button className="badge amber badge-btn" onClick={() => setFilter("check")}>⚠ {toCheck} to check</button>}
          </div>
          {offline && d.uploads.length > 0 && (
            <ul className="upload-list">{d.uploads.map((u) => (
              <li key={u.id}><Icon name="paper" size={15} /><span className="grow ellipsis" title={u.title}>{u.title}</span><span className="small muted">{u.pages} p</span>
                <span className={`badge ${u.status === "completed" ? "green" : u.status === "failed" ? "red" : "amber"}`}>{u.status === "completed" ? "Ready" : u.status === "failed" ? "Problem" : "Processing"}</span>
                {u.status !== "failed" && <Link to={`/app/tests/${d.id}/review/${u.id}`} className="btn-link small">Review pages</Link>}</li>
            ))}</ul>
          )}
        </div>
        <div className="card card-pad">
          <b>Scores</b>
          {!scored.length ? <p className="small muted" style={{ marginTop: 10 }}>Scores appear here once sheets are marked.</p> : (
            <div className="score-grid">
              <div><span className="small muted">Average</span><b>{avg}%</b></div>
              <div><span className="small muted">Highest</span><b>{high}%</b></div>
              <div><span className="small muted">Lowest</span><b>{low}%</b></div>
              <div><span className="small muted">Marked</span><b>{scored.length}</b></div>
            </div>
          )}
        </div>
      </div>

      <h2 className="h-sec" style={{ margin: "8px 0 10px" }}>Rank list</h2>
      <div className="tabs" role="tablist" aria-label="Filter students">
        {(["all", "check", "pending", "uploaded", "evaluating", "evaluated", "failed"] as const).map((s) => {
          const n = s === "all" ? d.attempts.length : s === "check" ? sheetsToCheck : d.attempts.filter((a) => a.status === s).length;
          const label = { all: "All", check: "⚠ Needs checking", pending: "No sheet yet", uploaded: "Uploaded", evaluating: "Marking", evaluated: "Marked", failed: "Problem" }[s];
          return (s === "all" || n > 0) && <button key={s} className={filter === s ? "on" : ""} onClick={() => setFilter(s)}>{label} ({n})</button>;
        })}
      </div>
      <div className="card">
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Rank</th><th>Student</th><th>Class</th><th>Status</th><th>Score</th>{d.results_published ? <th>Fix-it</th> : null}<th></th></tr></thead>
          <tbody>{list.map((a) => (
            <tr key={a.id}>
              <td><Rank n={ranked.indexOf(a.id)} /></td>
              <td><b>{a.student_name}</b><div className="small muted">Roll {a.roll_no ?? "—"}{a.files ? ` · ${a.files} page${a.files > 1 ? "s" : ""}` : ""}</div></td>
              <td className="small">{a.batch_name}</td>
              <td><StatusBadge status={a.status} />{a.reviewed ? <span className="badge blue" style={{ marginLeft: 4 }}>Reviewed</span> : null}
                {a.checks > 0 && <span className="badge amber" style={{ marginLeft: 4 }} title="Answers the AI wasn't sure about">⚠ {a.checks} to check</span>}
                {a.error && <div className="small" style={{ color: "var(--red)", maxWidth: 260 }}>{a.error}</div>}</td>
              <td>{a.score != null ? <><b>{a.score}</b><span className="muted">/{a.max_score}</span> <ScoreBadge value={pct(a.score, a.max_score)} /></> : "—"}</td>
              {d.results_published ? <td><FixitCell s={ins.data?.practice.by_attempt[a.id]} /></td> : null}
              <td><div className="row" style={{ justifyContent: "flex-end" }}>
                {offline && a.status !== "evaluating" && !DEMO && <UploadCell a={a} onDone={() => t.reload(true)} />}
                {offline && a.files > 0 && a.status !== "evaluating" && a.status !== "uploaded" && !DEMO && <button className="btn btn-ghost btn-sm" onClick={() => { if (a.status !== "evaluated" || confirm(`Re-mark ${a.student_name}'s sheet? This uses AI credits again and replaces any marks you changed.`)) evaluate([a.id]); }}>{a.status === "evaluated" ? "Re-mark" : "Retry"}</button>}
                {a.score != null && <button className="btn btn-ghost btn-sm" onClick={() => nav(`/app/attempts/${a.id}`)}>Review</button>}
                {a.score != null && !DEMO && <MenuButton label="⋯" small ariaLabel={`More for ${a.student_name}`} items={[
                  { label: "Report card PDF", run: () => pdf(`/attempts/${a.id}/report.pdf`, `Roll_${a.roll_no ?? ""}_${a.student_name.replace(/\W+/g, "_")}`) },
                  ...(a.share_token && d.results_published ? [
                    { label: `Send on WhatsApp${a.parent_phone || a.phone ? ` (${a.parent_phone || a.phone})` : ""}`, run: () => {
                      void api(`/tests/${d.id}/report-sends/whatsapp`, { body: { attempt_id: a.id, to: a.parent_phone || a.phone || "", recipient: a.parent_phone ? "parent" : "student" } }).catch(() => {});
                      window.open(`https://wa.me/${waNumber(a.parent_phone || a.phone)}?text=${encodeURIComponent(resultMessage(a, d.title, org?.name ?? ""))}`, "_blank", "noopener");
                    } },
                    { label: "Copy parent report link", run: () => copyLink(a.share_token!) },
                  ] : []),
                ]} />}
              </div></td>
            </tr>))}
          </tbody>
        </table></div>
        {!list.length && <Empty title={filter === "all" ? "No students in this test" : "No sheets match this filter"} icon="student">{filter === "all" ? "Add students to the test's batch, then they appear here." : "Pick another filter above."}</Empty>}
      </div>

      {ins.data && scored.length > 0 && <QuestionPerformance qs={ins.data.questions} />}
      {ins.data && scored.length > 0 && <TestInsights testId={d.id} ins={ins.data} published={Boolean(d.results_published)} onReload={() => ins.reload(true)} />}
      {sendOpen && <SendReportsModal test={d} onClose={() => setSendOpen(false)} />}
      {(!d.results_published || user?.role === "admin") && !DEMO && (
        <div style={{ marginTop: 20 }}><button className="btn btn-danger btn-sm" onClick={async () => {
          if (!confirm("Delete this test and all its results? This can't be undone.")) return;
          try { await api(`/tests/${d.id}`, { method: "DELETE" }); setMsg(`"${d.title}" was deleted.`); nav("/app/tests"); } catch (e) { setErr((e as Error).message); }
        }}>Delete test</button></div>
      )}
    </>
  );
}

/** Rank with medals for the top three. */
function Rank({ n }: { n: number }) {
  if (n < 0) return <span className="muted">—</span>;
  if (n < 3) return <span className={`medal m${n + 1}`} aria-label={`Rank ${n + 1}`}>{n + 1}</span>;
  return <span className="muted">#{n + 1}</span>;
}

/** Ring showing present out of total. */
function Donut({ value, total }: { value: number; total: number }) {
  const r = 30, c = 2 * Math.PI * r, f = total ? value / total : 0;
  return (
    <svg width="78" height="78" viewBox="0 0 78 78" role="img" aria-label={`${value} of ${total}`}>
      <circle cx="39" cy="39" r={r} fill="none" stroke="var(--bg-2)" strokeWidth="9" />
      <circle cx="39" cy="39" r={r} fill="none" stroke="var(--accent-2)" strokeWidth="9" strokeDasharray={`${c * f} ${c}`} strokeLinecap="round" transform="rotate(-90 39 39)" />
      <text x="39" y="44" textAnchor="middle" fontSize="15" fontWeight="600" fill="var(--ink)">{total ? Math.round(f * 100) : 0}%</text>
    </svg>
  );
}

/** Every question: class average, how many attempted it, and the most common mistake. */
function QuestionPerformance({ qs }: { qs: { id: string; n: number; topic: string; text: string; marks: number; avg_pct: number | null; attempted_pct: number | null; top_mistake: string | null }[] }) {
  const [sort, setSort] = useState<"n" | "avg">("n");
  const list = [...qs].sort((a, b) => (sort === "n" ? a.n - b.n : (a.avg_pct ?? 101) - (b.avg_pct ?? 101)));
  return (
    <div className="card card-pad" style={{ margin: "16px 0" }}>
      <div className="row between wrap"><div><b>Question-wise performance</b><p className="small muted" style={{ margin: "2px 0 0" }}>Class average on each question. Low bars show what to re-teach.</p></div>
        <div className="seg" role="group" aria-label="Sort"><button className={sort === "n" ? "on" : ""} aria-pressed={sort === "n"} onClick={() => setSort("n")}>By number</button><button className={sort === "avg" ? "on" : ""} aria-pressed={sort === "avg"} onClick={() => setSort("avg")}>Weakest first</button></div></div>
      <div className="qperf">
        {list.map((q) => (
          <div key={q.id} className="qperf-row" title={q.text}>
            <b className="qperf-n">Q{q.n}</b>
            <span className="qperf-topic ellipsis">{q.topic || "—"}<span className="small muted"> · {q.marks} mark{q.marks === 1 ? "" : "s"}</span></span>
            <span className="qperf-bar"><span className="bar"><i style={{ width: `${q.avg_pct ?? 0}%`, background: (q.avg_pct ?? 0) >= 75 ? "var(--green)" : (q.avg_pct ?? 0) >= 50 ? "var(--amber)" : "var(--red)" }} /></span></span>
            <b className="qperf-pct">{q.avg_pct == null ? "—" : `${q.avg_pct}%`}</b>
            <span className="small muted qperf-att">{q.attempted_pct == null ? "" : `${q.attempted_pct}% tried`}</span>
            <span className="qperf-mis">{q.top_mistake && q.top_mistake !== "none" ? <span className="badge">{MISTAKES[q.top_mistake as keyof typeof MISTAKES]?.label ?? q.top_mistake}</span> : null}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A button that opens a small menu of actions. */
function MenuButton({ label, items, disabled, small, ariaLabel }: { label: string; items: { label: string; run: () => void }[]; disabled?: boolean; small?: boolean; ariaLabel?: string }) {
  // The menu floats above the page (fixed position), so it isn't cut off inside scrolling tables.
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pos) return;
    const c = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setPos(null); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { setPos(null); btn.current?.focus(); } };
    const close = () => setPos(null);
    document.addEventListener("mousedown", c); document.addEventListener("keydown", k); window.addEventListener("scroll", close, true); window.addEventListener("resize", close);
    menu.current?.querySelector<HTMLElement>("button")?.focus();
    return () => { document.removeEventListener("mousedown", c); document.removeEventListener("keydown", k); window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [pos]);
  const toggle = () => {
    if (pos) return setPos(null);
    const r = btn.current!.getBoundingClientRect();
    setPos({ top: Math.min(r.bottom + 4, window.innerHeight - 40 * items.length - 20), right: Math.max(8, window.innerWidth - r.right) });
  };
  return (
    <div className="menu-wrap" ref={ref}>
      <button ref={btn} className={`btn btn-ghost ${small ? "btn-sm" : ""}`} disabled={disabled} aria-haspopup="menu" aria-expanded={Boolean(pos)} aria-label={ariaLabel} onClick={toggle}>{label}{small ? "" : " ▾"}</button>
      {pos && <div ref={menu} className="pop-menu" role="menu" style={{ position: "fixed", top: pos.top, right: pos.right }}
        onKeyDown={(e) => {
          const list = [...(menu.current?.querySelectorAll<HTMLElement>("button") ?? [])];
          const i = list.indexOf(document.activeElement as HTMLElement);
          if (e.key === "ArrowDown") { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
          if (e.key === "ArrowUp") { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
        }}>
        {items.map((i) => <button key={i.label} role="menuitem" onClick={() => { setPos(null); btn.current?.focus(); i.run(); }}>{i.label}</button>)}
      </div>}
    </div>
  );
}

interface AttemptData {
  id: string; status: AttemptStatus; score: number | null; max_score: number | null; student_name: string; test_title: string; test_id: string;
  files: number; page_types?: string[]; evaluation: SheetEvaluation | null; paper: Paper & { answers_hidden?: boolean }; reviewed: number; share_token: string | null; results_published: number; mode: string;
  report?: ReportFacts;
}
interface ReportFacts { roll_no: string | null; batch_name: string | null; test_date: string | null; subject: string | null; rank: number | null; of: number; top_pct: number | null;
  class_avg: number | null; class_high: number | null; pct: number | null; topics: { topic: string; got: number; max: number; pct: number; class_pct: number | null }[]; badges: { key: string; label: string }[] }

/** Report card header: who, which test, score, class rank, badges. */
function ReportHeader({ d }: { d: AttemptData }) {
  const r = d.report;
  if (!r || d.score == null) return null;
  return (
    <div className="report-head">
      <dl className="info-strip card report-info">
        <div><dt>Roll no</dt><dd>{r.roll_no ?? "—"}</dd></div>
        <div><dt>Batch</dt><dd>{r.batch_name ?? "—"}</dd></div>
        <div><dt>Subject</dt><dd>{r.subject ?? "—"}</dd></div>
        <div><dt>Date</dt><dd>{fmtDate(r.test_date)}</dd></div>
        <div><dt>Score</dt><dd><b>{d.score}</b>/{d.max_score} <ScoreBadge value={r.pct} /></dd></div>
        <div><dt>Class average</dt><dd>{r.class_avg == null ? "—" : `${r.class_avg}%`}{r.class_high != null && <span className="muted small"> · top {r.class_high}%</span>}</dd></div>
      </dl>
      <div className="card card-pad rank-card">
        <span className="small muted">Class rank</span>
        <div className="rank-big">{r.rank ?? "—"}<span className="muted"> / {r.of}</span></div>
        {r.top_pct != null && r.of > 1 && <span className={`badge ${r.top_pct <= 25 ? "green" : r.top_pct <= 50 ? "amber" : ""}`}>Top {r.top_pct}%</span>}
        {r.badges.length > 0 && <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>{r.badges.map((b) => <span key={b.key} className="achv">★ {b.label}</span>)}</div>}
      </div>
    </div>
  );
}

/** Topic-wise marks: this student's % per topic as bars, the class average as a marker; hover or focus for details. */
function TopicChart({ topics }: { topics: ReportFacts["topics"] }) {
  const [tip, setTip] = useState<number | null>(null);
  if (!topics.length) return null;
  return (
    <div className="card card-pad" style={{ marginBottom: 16 }}>
      <div className="row between wrap"><b>Topic-wise performance</b>
        <span className="row small" style={{ gap: 12 }}><span className="legend"><i className="lg-bar" />This student</span><span className="legend"><i className="lg-mark" />Class average</span></span></div>
      <div className="topic-chart" role="list">
        {topics.map((t, i) => (
          <div key={t.topic} className="topic-row" role="listitem" tabIndex={0} onMouseEnter={() => setTip(i)} onMouseLeave={() => setTip(null)} onFocus={() => setTip(i)} onBlur={() => setTip(null)}
            aria-label={`${t.topic}: ${t.got} of ${t.max} marks, ${t.pct}%${t.class_pct != null ? `, class average ${t.class_pct}%` : ""}`}>
            <span className="topic-name ellipsis">{t.topic}</span>
            <span className="topic-track">
              <i style={{ width: `${t.pct}%`, background: t.pct >= 75 ? "var(--green)" : t.pct >= 50 ? "var(--amber)" : "var(--red)" }} />
              {t.class_pct != null && <b className="topic-avg" style={{ left: `${t.class_pct}%` }} />}
              {tip === i && <span className="topic-tip" role="tooltip"><b>{t.topic}</b><span>{t.got}/{t.max} marks · {t.pct}%</span>{t.class_pct != null && <span>Class average {t.class_pct}% ({t.pct - t.class_pct >= 0 ? "+" : ""}{t.pct - t.class_pct})</span>}</span>}
            </span>
            <b className="topic-pct">{t.pct}%</b>
          </div>
        ))}
      </div>
    </div>
  );
}

// Shared by teachers (editable) and students (read-only, after publishing).
// Shows one uploaded page using the login header; images as <img>, PDFs in a frame.
function PagePreview({ attemptId, n, big }: { attemptId: string; n: number; big?: boolean }) {
  const [file, setFile] = useState<{ url: string; type: string } | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let url = "";
    blobUrl(`/attempts/${attemptId}/files/${n}`).then((f) => { url = f.url; setFile(f); }).catch(() => setErr(true));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [attemptId, n]);
  if (err) return <span className="small muted">Page {n + 1} unavailable</span>;
  if (!file) return <span className="spinner" />;
  return file.type === "application/pdf"
    ? <iframe src={file.url} title={`Page ${n + 1}`} style={{ width: "100%", height: big ? "75vh" : "100%", border: 0, pointerEvents: big ? "auto" : "none" }} />
    : <img src={file.url} alt={`Page ${n + 1}`} style={{ width: "100%", height: big ? "auto" : "100%", objectFit: big ? "contain" : "cover" }} />;
}

export function AttemptReview() {
  const { id } = useParams();
  const { user } = useAuth();
  const a = useApi<AttemptData>(`/attempts/${id}`);
  const editable = user!.role !== "student";
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [page, setPage] = useState<number | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [qtab, setQtab] = useState<"all" | "objective" | "written">("all");
  const toast = useToast();
  if (a.loading) return <PageSkeleton />;
  if (!a.data) return <><PageTitle title="Answer sheet" /><div className="card"><ErrorState error={a.error} onRetry={() => a.reload()} /></div></>;
  const d = a.data;
  const ev = d.evaluation;
  const questions = d.paper.sections.flatMap((s) => s.questions);
  const qById = new Map(questions.map((q) => [q.id, q]));
  const dirty = Object.keys(edits).length > 0;
  /** A typed mark outside the question's range (the browser doesn't stop typing it). */
  const outOfRange = (qid: string) => {
    if (!(qid in edits)) return false;
    const v = edits[qid], q = qById.get(qid), max = ev?.questions.find((x) => x.question_id === qid)?.max_marks ?? q?.marks ?? 0;
    return !Number.isFinite(v) || v > max || v < -(q?.negative_marks ?? 0);
  };
  const invalid = Object.keys(edits).some(outOfRange);

  const save = async () => {
    setSaveErr(null);
    try {
      const r = await api<{ score: number }>(`/attempts/${d.id}/evaluation`, { method: "PUT", body: { questions: Object.entries(edits).map(([question_id, marks_awarded]) => ({ question_id, marks_awarded, note: notes[question_id]?.trim() || undefined })) } });
      setEdits({}); setNotes({}); toast.success(`Saved - new total ${r.score}/${d.max_score}`); a.reload(true);
    } catch (e) { setSaveErr((e as Error).message); toast.error((e as Error).message); }
  };

  return (
    <>
      <PageTitle title={d.student_name} sub={<>Report card · {d.test_title}</>}
        crumbs={editable ? [{ label: "Assessments" }, { label: "Tests", to: "/app/tests" }, { label: d.test_title, to: `/app/tests/${d.test_id}` }] : [{ label: "My tests", to: "/app/my" }]}>
        <div className="card stat" style={{ padding: "10px 18px" }}><div className="label">Total</div><div className="value" style={{ fontSize: 24 }}>{d.score}<span className="muted" style={{ fontSize: 16 }}>/{d.max_score}</span></div></div>
        {editable && dirty && <button className="btn btn-primary" onClick={save} disabled={invalid} title={invalid ? "A mark is outside the allowed range" : undefined}>Save changes</button>}
        {editable && !dirty && !d.reviewed && ev?.questions.some((q) => q.needs_review) && <button className="btn btn-primary" onClick={save}>✓ Marks look right</button>}
        {!DEMO && d.score != null && <button className="btn btn-primary no-print" onClick={() => download(`/attempts/${d.id}/report.pdf`, `${d.test_title.replace(/\W+/g, "_")}_${d.student_name.replace(/\W+/g, "_")}.pdf`).catch((e) => setSaveErr(e.message))}>⤓ Report card PDF</button>}
        <button className="btn btn-ghost no-print" onClick={() => window.print()}>Print</button>
      </PageTitle>
      {saveErr && <div className="error-box" style={{ marginBottom: 14 }}>{saveErr}</div>}
      <ReportHeader d={d} />
      {d.report && d.score != null && <TopicChart topics={d.report.topics} />}
      {invalid && <div className="error-box" style={{ marginBottom: 14 }}>A mark is outside what that question allows (see the red box). Fix it to save.</div>}
      {d.files > 0 && ev && d.score != null && (
        <Suspense fallback={<Loading />}><SheetView pages={d.files} pageTypes={d.page_types} ev={ev} questions={questions} sections={d.paper.sections} score={d.score} max={d.max_score ?? 0}
          title={`${d.test_title} - ${d.student_name}`} answersHidden={d.paper.answers_hidden} staff={editable}
          loadPage={(n) => blobUrl(`/attempts/${d.id}/files/${n}`).then((f) => f.url)}
          loadBlob={(n) => fetchBlob(`/attempts/${d.id}/files/${n}`)} /></Suspense>
      )}
      {editable && d.files > 0 && !(ev && d.score != null) && (
        <div className="card card-pad no-print" style={{ marginBottom: 16 }}>
          <div className="row between"><b>Answer sheet ({d.files} page{d.files > 1 ? "s" : ""})</b><span className="small muted">Click a page to enlarge</span></div>
          <div className="row" style={{ overflowX: "auto", marginTop: 10, gap: 10 }}>
            {Array.from({ length: d.files }, (_, i) => (
              <button key={i} type="button" onClick={() => setPage(i)} aria-label={`Open page ${i + 1}`}
                className="q-card" style={{ padding: 4, flex: "none", width: 110, height: 140, display: "grid", placeItems: "center", overflow: "hidden" }}>
                <PagePreview attemptId={d.id} n={i} />
              </button>))}
          </div>
        </div>
      )}
      {page != null && (
        <Modal title={`Page ${page + 1}`} onClose={() => setPage(null)} wide>
          <PagePreview attemptId={d.id} n={page} big />
        </Modal>
      )}
      {ev && ev.questions.some((q) => q.marks_awarded < q.max_marks) && (() => {
        const lost: Record<string, number> = {};
        for (const q of ev.questions) {
          const l = Math.max(0, q.max_marks - Math.max(0, q.marks_awarded)); if (!l) continue;
          const k = !q.attempted ? "not_attempted" : q.mistake_type && q.mistake_type !== "none" ? q.mistake_type : "unclassified";
          lost[k] = (lost[k] ?? 0) + l;
        }
        return <div className="card card-pad" style={{ marginBottom: 16 }}><b>Where the marks went</b><div style={{ marginTop: 12 }}><MistakeBars data={lost} /></div><TopTip data={lost} /></div>;
      })()}
      {ev && (ev.overall_feedback || ev.gaps.length > 0) && (
        <div className="grid g2" style={{ marginBottom: 16 }}>
          {ev.overall_feedback && <div className="card card-pad"><b>Overall feedback</b><div className="muted" style={{ marginTop: 6 }}><MathText text={ev.overall_feedback} /></div>
            {ev.strengths.length > 0 && <div className="row wrap" style={{ marginTop: 10 }}>{ev.strengths.map((s) => <span key={s} className="badge green">✓ {s}</span>)}</div>}</div>}
          {ev.gaps.length > 0 && <div className="card card-pad"><b>Revise these</b><div className="row wrap" style={{ marginTop: 10 }}>{ev.gaps.map((g) => <span key={g} className="badge red">{g}</span>)}</div></div>}
        </div>
      )}
      {ev && (() => {
        const kindOf = (id: string) => { const t = (qById.get(id) as Question | undefined)?.type; return t === "mcq" || t === "numeric" ? "objective" : "written"; };
        const n = { all: ev.questions.length, objective: ev.questions.filter((q) => kindOf(q.question_id) === "objective").length, written: ev.questions.filter((q) => kindOf(q.question_id) === "written").length };
        if (!n.objective || !n.written) return null;
        return (
          <div className="tabs" role="tablist" aria-label="Question type">
            {(["all", "objective", "written"] as const).map((k) => <button key={k} role="tab" aria-selected={qtab === k} className={qtab === k ? "on" : ""} onClick={() => setQtab(k)}>
              {{ all: "All", objective: "Objective", written: "Written" }[k]} ({n[k]})</button>)}
          </div>
        );
      })()}
      {!ev ? <div className="card"><Empty title="Not marked yet" icon="tests">Marks and feedback appear here once this sheet has been marked.</Empty></div> : (
        <div className="stack" style={{ gap: 12 }}>
          {ev.questions.map((qe, i) => {
            const q = qById.get(qe.question_id) as Question | undefined;
            if (qtab !== "all" && ((q?.type === "mcq" || q?.type === "numeric") ? "objective" : "written") !== qtab) return null;
            const marks = edits[qe.question_id] ?? qe.marks_awarded;
            return (
              <div key={qe.question_id} className="q-card">
                <div className="row between" style={{ alignItems: "flex-start" }}>
                  <div className="grow">
                    <div className="q-meta"><b>Q{i + 1}.</b>{q && <span className="badge">{q.topic}{q.subtopic ? ` › ${q.subtopic}` : ""}</span>}
                      {!qe.attempted && <span className="badge">Not attempted</span>}
                      {editable && qe.needs_review && !d.reviewed ? <span className="badge amber" title={qe.check_note || "Please check this answer"}>⚠ Please check</span>
                        : qe.confidence === "low" && <span className="badge amber" title="Handwriting was hard to read - please check">⚠ Check</span>}
                      {editable && qe.second_check === "agreed" && <span className="badge green" title="A second, stronger AI model marked this answer again and agreed">✓ Double-checked</span>}
                      {editable && qe.second_check === "changed" && <span className="badge blue" title={`First marked ${qe.first_marks}; a second, stronger AI model gave ${qe.marks_awarded}`}>Corrected by second check (was {qe.first_marks})</span>}
                      {qe.attempted && qe.marks_awarded < qe.max_marks && qe.mistake_type && qe.mistake_type !== "none" && MISTAKES[qe.mistake_type] &&
                        <span className="badge" style={{ color: MISTAKES[qe.mistake_type].color }}>{MISTAKES[qe.mistake_type].label}</span>}</div>
                    <div className="q-text"><MathText text={q?.text} /></div>
                  </div>
                  <div className="row" style={{ flex: "none" }}>
                    {editable ? (
                      <input className="input" type="number" step={0.5} min={-(q?.negative_marks ?? 0)} max={qe.max_marks} value={marks}
                        aria-invalid={outOfRange(qe.question_id) || undefined} aria-label={`Marks for this question, out of ${qe.max_marks}`}
                        style={{ width: 80, fontWeight: 700, borderColor: outOfRange(qe.question_id) ? "var(--red)" : qe.question_id in edits ? "var(--accent)" : undefined }}
                        onChange={(e) => setEdits({ ...edits, [qe.question_id]: Number(e.target.value) })} />
                    ) : <b style={{ fontSize: 18 }}>{marks}</b>}
                    <span className="muted">/ {qe.max_marks}</span>
                  </div>
                </div>
                {editable && qe.question_id in edits && edits[qe.question_id] !== qe.marks_awarded && (
                  <label className="field" style={{ marginTop: 10 }}><span className="small">Why are you changing the AI's marks? (optional, helps improve the marking)</span>
                    <input className="input" maxLength={1000} placeholder="e.g. Method is correct, only the final unit is missing" value={notes[qe.question_id] ?? ""} onChange={(e) => setNotes({ ...notes, [qe.question_id]: e.target.value })} /></label>
                )}
                {qe.transcription && <div className="solution"><span className="small muted">{d.mode === "cbt" ? "Answer given" : "Student wrote"}:</span><div className="hand" style={{ fontSize: 20, color: "#263066", whiteSpace: "pre-wrap" }}>{qe.transcription}</div></div>}
                {qe.steps.length > 0 && (
                  <div style={{ marginTop: 10 }}>{qe.steps.map((s, j) => (
                    <div key={j} className="row between small" style={{ padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
                      <span><MathText text={s.step} className="inline" />{s.comment && <span className="muted"> - <MathText text={s.comment} className="inline" /></span>}</span>
                      <span className={`badge ${s.awarded >= s.max_marks ? "green" : s.awarded > 0 ? "amber" : "red"}`}>{s.awarded}/{s.max_marks}</span>
                    </div>))}
                  </div>
                )}
                {editable && qe.needs_review && !d.reviewed && qe.check_note && <div className="small" style={{ marginTop: 10, padding: "8px 12px", borderRadius: 10, background: "var(--amber-soft)", color: "var(--amber)" }}>⚠ {qe.check_note}</div>}
                {qe.mistake_note && qe.marks_awarded < qe.max_marks && <p className="small" style={{ marginTop: 10 }}><b>Mistake:</b> <MathText text={qe.mistake_note} className="inline" /></p>}
                {qe.feedback && <p className="small" style={{ marginTop: 10 }}><b>Feedback:</b> <MathText text={qe.feedback} className="inline" /></p>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
