import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, blobUrl, csvCell, DEMO, download, fmtDate, fmtDateTime, pct } from "../../lib/api";
import type { AttemptStatus, Paper, Question, SheetEvaluation } from "../../lib/types";
import { Empty, ErrorBox, Loading, Modal, PageTitle, ScoreBadge, StatusBadge, useApi } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { bulkUpload, compressImage, isAllowedFile, type BulkResult } from "../../lib/upload";
import { FixitCell, MistakeBars, MISTAKES, TestInsights, TopTip, useInsights } from "./Insights";
import { ClassUploadWizard, PaperStep, Step } from "./TestFlow";

interface TestRow { id: string; title: string; mode: "offline" | "cbt"; scheduled_at: string | null; results_published: number; paper_id: string | null; paper_title: string | null; paper_status: string | null; total_marks: number | null; subject: string | null; batch_names: string | null; candidates: number; evaluated: number; uploaded: number }

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
  const tests = useApi<TestRow[]>("/tests");
  const nav = useNavigate();
  return (
    <>
      <PageTitle title="Tests & evaluation" sub="Create a test for a class, add the paper, then upload the answer sheets after the exam">
        <button className="btn btn-primary" onClick={() => setParams({ new: "1", ...(params.get("paper") ? { paper: params.get("paper")! } : {}) })}>+ New test</button>
      </PageTitle>
      <div className="card">
        {tests.loading ? <Loading /> : tests.data?.length ? (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Test</th><th>Class</th><th>Date</th><th>Marked</th><th>Next step</th></tr></thead>
            <tbody>{tests.data.map((t) => {
              const [label, tone] = nextStep(t);
              return (
                <tr key={t.id} className="click" onClick={() => nav(`/app/tests/${t.id}`)}>
                  <td><b>{t.title}</b><div className="small muted">{[t.subject, t.mode === "cbt" ? "Online" : "On paper", t.paper_id && t.total_marks ? `${t.total_marks} marks` : null].filter(Boolean).join(" · ")}</div></td>
                  <td className="small">{t.batch_names ?? "—"}</td>
                  <td className="small">{fmtDate(t.scheduled_at)}</td>
                  <td><div className="small">{t.evaluated}/{t.candidates}</div><div className="bar" style={{ width: 90, marginTop: 4 }}><i style={{ width: `${t.candidates ? (t.evaluated / t.candidates) * 100 : 0}%` }} /></div></td>
                  <td><span className={`badge ${tone}`}>{label}</span></td>
                </tr>);
            })}
            </tbody>
          </table></div>
        ) : <Empty title="No tests yet"><button className="btn btn-primary" style={{ marginTop: 10 }} onClick={() => setParams({ new: "1" })}>+ Create your first test</button></Empty>}
      </div>
      {params.has("new") && <NewTestModal paperId={params.get("paper")} onClose={() => setParams({})} />}
    </>
  );
}

/** Create a test in a few taps: class, subject, date. The question paper can be added afterwards. */
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
      {batches.data && !batches.data.length ? <Empty title="Add a class first"><Link to="/app/batches" className="btn-link">Create a class (batch) and add students</Link></Empty> : (
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

interface AttemptRow { phone: string | null; parent_phone: string | null; id: string; status: AttemptStatus; score: number | null; max_score: number | null; error: string | null; reviewed: number; files: number; student_id: string; student_name: string; roll_no: string | null; batch_name: string; share_token: string | null }
interface TestDetailData extends TestRow { duration_min: number; paper: Paper | null; paper_problem: string | null; attempts: AttemptRow[] }

function UploadCell({ a, onDone }: { a: AttemptRow; onDone: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true); setErr(null);
    try {
      const form = new FormData();
      for (const f of [...files].filter(isAllowedFile)) { const c = await compressImage(f); form.append("files", c, c.name); }
      if (!form.has("files")) throw new Error("Choose JPG, PNG, WEBP or PDF files");
      await api(`/attempts/${a.id}/files${a.files ? "?replace=1" : ""}`, { form }); onDone();
    }
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

function BulkUploadModal({ testId, batches, onClose, onDone }: { testId: string; batches: string[]; onClose: () => void; onDone: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number; stage: string } | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setError(null); setResult(null);
    try { const r = await bulkUpload(testId, files, null, (done, total, stage) => setProgress({ done, total, stage })); setResult(r); onDone(); }
    catch (e) { setError((e as Error).message); }
    finally { setProgress(null); }
  };
  return (
    <Modal title="Upload the whole class" onClose={progress ? () => {} : onClose} wide>
      <div className="stack">
        <p className="small">Name each photo or PDF with the student's <b>roll number first</b>. For several pages, add a page number:
          <code> 7.jpg</code>, <code>7-1.jpg</code>, <code>7-2.jpg</code>, <code>Roll 12.pdf</code>. Pages are put in order by file name.</p>
        {batches.length > 1 && <p className="small" style={{ color: "var(--amber)" }}>This test has more than one batch ({batches.join(", ")}). If two students share a roll number, upload one batch at a time from each student's row instead.</p>}
        <input ref={ref} type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" style={{ display: "none" }}
          onChange={(e) => { setFiles([...(e.target.files ?? [])].filter(isAllowedFile)); setResult(null); }} />
        <div className="drop" onClick={() => !progress && ref.current?.click()} role="button" tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && ref.current?.click()}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); setFiles([...e.dataTransfer.files].filter(isAllowedFile)); setResult(null); }}>
          {files.length ? <b>{files.length} file{files.length > 1 ? "s" : ""} selected</b> : <>Click to choose files, or drop them here</>}
        </div>
        {progress && (
          <div>
            <div className="row between small"><span>{progress.stage}…</span><span>{progress.done} / {progress.total}</span></div>
            <div className="bar" style={{ marginTop: 6 }}><i style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
          </div>
        )}
        {error && <div className="error-box">{error}</div>}
        {result && (
          <div className="ok-box">
            Uploaded <b>{result.pages}</b> page{result.pages === 1 ? "" : "s"} for <b>{result.students}</b> student{result.students === 1 ? "" : "s"}.
            {result.unmatched.length > 0 && <div style={{ color: "var(--red)", marginTop: 6 }}>No student with that roll number: {result.unmatched.join(", ")}</div>}
            {result.ambiguous.length > 0 && <div style={{ color: "var(--amber)", marginTop: 6 }}>Roll number used in more than one batch (upload these from the student's row): {result.ambiguous.join(", ")}</div>}
            {result.busy.length > 0 && <div style={{ color: "var(--amber)", marginTop: 6 }}>Skipped while being evaluated: {result.busy.join(", ")}</div>}
            {result.warnings.length > 0 && <div style={{ color: "var(--amber)", marginTop: 6 }}>{result.warnings.join(" ")}</div>}
          </div>
        )}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" disabled={!!progress} onClick={onClose}>{result ? "Done" : "Cancel"}</button>
          {!result && <button className="btn btn-primary" disabled={!files.length || !!progress} onClick={start}>{progress ? "Uploading…" : `Upload ${files.length || ""} file${files.length === 1 ? "" : "s"}`}</button>}
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
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | AttemptStatus>("all");
  const [bulk, setBulk] = useState(false);
  const [wizard, setWizard] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const busy = t.data?.attempts.some((a) => a.status === "evaluating");
  const reading = t.data?.paper?.status === "generating";
  const ins = useInsights(id!, Boolean(busy));
  useEffect(() => {
    if (!busy) setMsg((m) => (m?.startsWith("Marking") ? "All sheets are marked. Check any sheet below, then publish." : m));
    if (!busy && !reading) return;
    const i = setInterval(() => t.reload(true), 3000);
    return () => clearInterval(i);
  }, [busy, reading]);

  if (t.loading) return <Loading />;
  if (!t.data) return <ErrorBox error={t.error} />;
  const d = t.data;
  const scored = d.attempts.filter((a) => a.score != null);
  const avg = scored.length ? Math.round(scored.reduce((s, a) => s + pct(a.score, a.max_score)!, 0) / scored.length) : null;
  const high = scored.length ? Math.max(...scored.map((a) => pct(a.score, a.max_score)!)) : null;
  const withSheets = d.attempts.filter((a) => a.files > 0).length;
  const toEvaluate = d.attempts.filter((a) => a.files > 0 && (a.status === "uploaded" || a.status === "failed")).length;
  const marking = d.attempts.filter((a) => a.status === "evaluating").length;
  const submitted = d.attempts.filter((a) => a.status !== "pending" && a.status !== "in_progress").length;
  const list = d.attempts.filter((a) => filter === "all" || a.status === filter);
  const ranked = [...scored].sort((a, b) => b.score! - a.score!).map((a) => a.id);
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
    const r = await api<{ practice_queued: number }>(`/tests/${d.id}/publish`, { body: { publish } });
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

  return (
    <>
      <PageTitle title={d.title} sub={<>{[d.subject, d.batch_names, offline ? "On paper" : "Online test", total ? `${total} marks` : null, fmtDate(d.scheduled_at)].filter(Boolean).join(" · ")}</>}>
        {!DEMO && scored.length > 0 && <button className="btn btn-ghost" onClick={() => download(`/tests/${d.id}/results.csv`, `${d.title.replace(/\W+/g, "_")}_results.csv`).catch((e) => setErr(e.message))}>Export CSV</button>}
        {!DEMO && scored.length > 0 && <button className="btn btn-primary" onClick={() => pdf(`/tests/${d.id}/class-report.pdf`, "class_report")}>⤓ Class report PDF</button>}
        {!DEMO && scored.length > 0 && <button className="btn btn-ghost" onClick={() => pdf(`/tests/${d.id}/reports.pdf`, "student_reports")}>⤓ All student reports PDF</button>}
        {d.results_published && !DEMO ? <button className="btn btn-ghost" onClick={downloadLinks}>⤓ Report links</button> : null}
      </PageTitle>
      {pdfBusy && <div className="ok-box" style={{ marginBottom: 14 }}><span className="spinner" /> Making the PDF…</div>}
      {msg && <div className="ok-box" style={{ marginBottom: 14 }}>{msg}</div>}
      {err && <div className="error-box" style={{ marginBottom: 14 }}>{err}</div>}

      <div className="card card-pad steps" style={{ marginBottom: 16 }}>
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
              {scored.length > 0 && !marking && <span className="small">{scored.length} marked · average <b>{avg}%</b>. Open any sheet to check or change marks.</span>}
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
      </div>

      {bulk && <BulkUploadModal testId={d.id} batches={(d.batch_names ?? "").split(", ").filter(Boolean)} onClose={() => setBulk(false)} onDone={() => t.reload(true)} />}
      {wizard && <ClassUploadWizard t={d} onClose={() => setWizard(false)} onDone={(n) => { t.reload(true); if (n) setMsg(`Answer sheets uploaded for ${n} student${n === 1 ? "" : "s"}.${d.paper_problem ? "" : " Next: click “Mark answer sheets”."}`); }} />}

      {scored.length > 0 && (
        <div className="grid g4" style={{ marginBottom: 16 }}>
          <div className="card stat"><div className="label">Students</div><div className="value">{d.attempts.length}</div></div>
          <div className="card stat"><div className="label">Marked</div><div className="value">{scored.length}</div></div>
          <div className="card stat"><div className="label">Average</div><div className="value">{avg ?? "—"}{avg != null && "%"}</div></div>
          <div className="card stat"><div className="label">Highest</div><div className="value">{high ?? "—"}{high != null && "%"}</div></div>
        </div>
      )}
      {ins.data && scored.length > 0 && <TestInsights testId={d.id} ins={ins.data} published={Boolean(d.results_published)} onReload={() => ins.reload(true)} />}
      <div className="tabs">
        {(["all", "pending", "uploaded", "evaluating", "evaluated", "failed"] as const).map((s) => {
          const n = s === "all" ? d.attempts.length : d.attempts.filter((a) => a.status === s).length;
          const label = { all: "All", pending: "No sheet yet", uploaded: "Uploaded", evaluating: "Marking", evaluated: "Marked", failed: "Problem" }[s];
          return (s === "all" || n > 0) && <button key={s} className={filter === s ? "on" : ""} onClick={() => setFilter(s)}>{label} ({n})</button>;
        })}
      </div>
      <div className="card">
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Rank</th><th>Student</th><th>Class</th><th>Status</th><th>Score</th>{d.results_published ? <th>Fix-it</th> : null}<th></th></tr></thead>
          <tbody>{list.map((a) => (
            <tr key={a.id}>
              <td className="muted">{ranked.indexOf(a.id) >= 0 ? `#${ranked.indexOf(a.id) + 1}` : "—"}</td>
              <td><b>{a.student_name}</b><div className="small muted">Roll {a.roll_no ?? "—"}{a.files ? ` · ${a.files} page${a.files > 1 ? "s" : ""}` : ""}</div></td>
              <td className="small">{a.batch_name}</td>
              <td><StatusBadge status={a.status} />{a.reviewed ? <span className="badge blue" style={{ marginLeft: 4 }}>Reviewed</span> : null}
                {a.error && <div className="small" style={{ color: "var(--red)", maxWidth: 260 }}>{a.error}</div>}</td>
              <td>{a.score != null ? <><b>{a.score}</b><span className="muted">/{a.max_score}</span> <ScoreBadge value={pct(a.score, a.max_score)} /></> : "—"}</td>
              {d.results_published ? <td><FixitCell s={ins.data?.practice.by_attempt[a.id]} /></td> : null}
              <td><div className="row" style={{ justifyContent: "flex-end" }}>
                {offline && a.status !== "evaluating" && !DEMO && <UploadCell a={a} onDone={() => t.reload(true)} />}
                {offline && a.files > 0 && a.status !== "evaluating" && a.status !== "uploaded" && !DEMO && <button className="btn btn-ghost btn-sm" onClick={() => { if (a.status !== "evaluated" || confirm(`Re-mark ${a.student_name}'s sheet? This uses AI credits again and replaces any marks you changed.`)) evaluate([a.id]); }}>{a.status === "evaluated" ? "Re-mark" : "Retry"}</button>}
                {a.score != null && <button className="btn btn-ghost btn-sm" onClick={() => nav(`/app/attempts/${a.id}`)}>Review</button>}
                {a.score != null && !DEMO && <button className="btn btn-ghost btn-sm" title="Download this student's report card" onClick={() => pdf(`/attempts/${a.id}/report.pdf`, `Roll_${a.roll_no ?? ""}_${a.student_name.replace(/\W+/g, "_")}`)}>PDF</button>}
                {a.share_token && d.results_published && a.score != null ? <>
                  <a className="btn btn-ghost btn-sm" target="_blank" rel="noreferrer" title={`Send on WhatsApp${a.parent_phone || a.phone ? ` to ${a.parent_phone || a.phone}` : ""}`}
                    href={`https://wa.me/${waNumber(a.parent_phone || a.phone)}?text=${encodeURIComponent(resultMessage(a, d.title, org?.name ?? ""))}`}>WhatsApp</a>
                  <button className="btn btn-ghost btn-sm" title="Copy report link" onClick={() => copyLink(a.share_token!)}>🔗</button>
                </> : null}
              </div></td>
            </tr>))}
          </tbody>
        </table></div>
        {!list.length && <Empty title="No students here" />}
      </div>
      {(!d.results_published || user?.role === "admin") && !DEMO && (
        <div style={{ marginTop: 20 }}><button className="btn btn-danger btn-sm" onClick={async () => {
          if (!confirm("Delete this test and all its results? This can't be undone.")) return;
          try { await api(`/tests/${d.id}`, { method: "DELETE" }); nav("/app/tests"); } catch (e) { setErr((e as Error).message); }
        }}>Delete test</button></div>
      )}
    </>
  );
}

interface AttemptData {
  id: string; status: AttemptStatus; score: number | null; max_score: number | null; student_name: string; test_title: string; test_id: string;
  files: number; evaluation: SheetEvaluation | null; paper: Paper; reviewed: number; share_token: string | null; results_published: number; mode: string;
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
        {!DEMO && d.score != null && <button className="btn btn-primary no-print" onClick={() => download(`/attempts/${d.id}/report.pdf`, `${d.test_title.replace(/\W+/g, "_")}_${d.student_name.replace(/\W+/g, "_")}.pdf`).catch((e) => setSaved(e.message))}>⤓ Report card PDF</button>}
        <button className="btn btn-ghost no-print" onClick={() => window.print()}>Print</button>
      </PageTitle>
      {saved && <div className="ok-box" style={{ marginBottom: 14 }}>{saved}</div>}
      {editable && d.files > 0 && (
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
                      {qe.confidence === "low" && <span className="badge amber" title="Handwriting was hard to read - please check">⚠ Check</span>}
                      {qe.attempted && qe.marks_awarded < qe.max_marks && qe.mistake_type && qe.mistake_type !== "none" && MISTAKES[qe.mistake_type] &&
                        <span className="badge" style={{ color: MISTAKES[qe.mistake_type].color }}>{MISTAKES[qe.mistake_type].label}</span>}</div>
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
                {qe.mistake_note && qe.marks_awarded < qe.max_marks && <p className="small" style={{ marginTop: 10 }}><b>Mistake:</b> {qe.mistake_note}</p>}
                {qe.feedback && <p className="small" style={{ marginTop: 10 }}><b>Feedback:</b> {qe.feedback}</p>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
