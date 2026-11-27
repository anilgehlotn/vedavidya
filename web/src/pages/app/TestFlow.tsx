// The guided test flow: ① question paper → ② answer sheets → ③ AI marking → ④ publish.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CreditLine } from "./Credits";
import { api, blobUrl, DEMO } from "../../lib/api";
import type { Paper } from "../../lib/types";
import { ErrorBox, Modal, useApi } from "../../components/ui";
import type { UploadedFile } from "../../lib/chunkUpload";
import { FileUpload } from "../../components/FileUpload";
import { ImportPaperForm } from "./PaperImport";

export interface FlowAttempt { id: string; status: string; files: number; score: number | null; student_name: string; roll_no: string | null; batch_name: string }
export interface FlowTest {
  id: string; title: string; mode: "offline" | "cbt"; subject: string | null; batch_names: string | null; results_published: number;
  paper: Paper | null; paper_problem: string | null; attempts: FlowAttempt[];
}

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function Step({ n, title, state, children, hint }: { n: number; title: string; state: "done" | "current" | "todo"; children?: ReactNode; hint?: ReactNode }) {
  return (
    <div className={`step ${state}`}>
      <div className="step-num" aria-hidden>{state === "done" ? "✓" : n}</div>
      <div className="step-body">
        <div className="step-head"><b>{title}</b>{hint && <span className="small muted">{hint}</span>}</div>
        {children}
      </div>
    </div>
  );
}

// ---------- ① Question paper ----------
export function PaperStep({ t, state, onChange }: { t: FlowTest; state: "done" | "current" | "todo"; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const p = t.paper;
  const marked = t.attempts.some((a) => a.score != null || a.status === "evaluating");
  const count = p ? p.sections.reduce((n, s) => n + s.questions.length, 0) : 0;
  return (
    <Step n={1} title="Question paper" state={state} hint={!p ? "Add it any time before marking" : undefined}>
      {!p ? (
        <div className="row wrap" style={{ marginTop: 10 }}>
          {!DEMO && <button className="btn btn-primary" onClick={() => setOpen(true)}>⇪ Add question paper</button>}
          <span className="small muted">Photos or a PDF of the printed paper. Add the answer key too if you have it.</span>
        </div>
      ) : p.status === "generating" ? (
        <div className="row" style={{ marginTop: 10 }}><span className="spinner" /><span className="small"><b>Reading your paper…</b> usually 1–2 minutes. You can upload answer sheets meanwhile.</span></div>
      ) : (
        <div className="row wrap between" style={{ marginTop: 8 }}>
          <span className="small">
            {p.status === "failed" ? <span style={{ color: "var(--red)" }}>{t.paper_problem}</span>
              : <><b>{p.title}</b> · {plural(count, "question")} · {p.total_marks} marks{t.paper_problem && <span style={{ color: "var(--amber)" }}> · {t.paper_problem}</span>}</>}
          </span>
          <span className="row">
            <Link className="btn btn-ghost btn-sm" to={`/app/papers/${p.id}`}>{p.status === "failed" ? "Details" : "Check / edit questions"}</Link>
            {!marked && !DEMO && <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>Replace</button>}
          </span>
        </div>
      )}
      {open && <AddPaperModal t={t} onClose={() => setOpen(false)} onDone={() => { setOpen(false); onChange(); }} />}
    </Step>
  );
}

function AddPaperModal({ t, onClose, onDone }: { t: FlowTest; onClose: () => void; onDone: () => void }) {
  const [tab, setTab] = useState<"upload" | "saved" | "ai">("upload");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState("");
  const papers = useApi<Paper[]>(tab === "saved" ? "/papers" : null, [tab]);
  const ready = (papers.data ?? []).filter((p) => (p.status === "draft" || p.status === "approved") && p.total_marks > 0);
  const attach = async (paperId: string) => { await api(`/tests/${t.id}/paper`, { method: "PUT", body: { paper_id: paperId } }); onDone(); };

  return (
    <Modal title="Add the question paper" onClose={busy ? () => {} : onClose}>
      <div className="tabs" style={{ marginBottom: 14 }}>
        <button className={tab === "upload" ? "on" : ""} onClick={() => setTab("upload")}>Upload paper</button>
        <button className={tab === "saved" ? "on" : ""} onClick={() => setTab("saved")}>Use a saved paper</button>
        <button className={tab === "ai" ? "on" : ""} onClick={() => setTab("ai")}>Create with AI</button>
      </div>
      {tab === "upload" && <ImportPaperForm defaults={{ subject: t.subject, class_level: t.batch_names?.slice(0, 60) }} onCancel={onClose} onCreated={attach} />}
      {tab === "saved" && (
        <div className="stack">
          {papers.loading ? <span className="spinner" /> : ready.length ? (
            <>
              <select className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Choose a paper…</option>
                {ready.map((p) => <option key={p.id} value={p.id}>{p.title}{p.subject ? ` · ${p.subject}` : ""} ({p.total_marks} marks)</option>)}
              </select>
              <ErrorBox error={error} />
              <button className="btn btn-primary" disabled={!pick || busy} onClick={async () => { setBusy(true); setError(null); try { await attach(pick); } catch (e) { setError((e as Error).message); setBusy(false); } }}>Use this paper</button>
            </>
          ) : <p className="small muted">No saved papers yet. Upload the paper instead.</p>}
        </div>
      )}
      {tab === "ai" && (
        <div className="stack">
          <p className="small">AI writes a fresh paper from your topics and pattern (CBSE, JEE, unit test…). It is added to this test automatically.</p>
          <Link className="btn btn-primary" to={`/app/papers/new?test=${t.id}${t.subject ? `&subject=${encodeURIComponent(t.subject)}` : ""}`}>Open the paper generator →</Link>
        </div>
      )}
    </Modal>
  );
}

// ---------- ② Answer sheets: the whole class in one go ----------
// The teacher uploads one scanned PDF (or a ZIP) for the class. The server turns it into page images in the
// background; then the pages are split between students in roll-number order (pages per student, absentees
// unticked), with a preview, and assigned.
export interface ClassUpload { id: string; title: string; status: string; error: string | null; pages: number; created_at: string }
interface DocInfo { id: string; status: string; error: string | null; job: { status: string; attempts: number; max_attempts: number; last_error: string | null; next_try_at: string | null } | null; pages: { n: number; width: number; height: number; assigned: boolean }[] }

/** Page thumbnail that loads only when scrolled into view. */
function PageThumb({ docId, n, className }: { docId: string; n: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let made = "";
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      io.disconnect();
      blobUrl(`/documents/${docId}/pages/${n}`).then((f) => { made = f.url; setUrl(f.url); }).catch(() => {});
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => { io.disconnect(); if (made) URL.revokeObjectURL(made); };
  }, [docId, n]);
  return <span ref={ref} className={className ?? "split-thumb"}>{url && <img src={url} alt={`Page ${n}`} />}</span>;
}

export function ClassUploadWizard({ t, uploads, onClose, onDone }: { t: FlowTest; uploads?: ClassUpload[]; onClose: () => void; onDone: (assigned: number) => void }) {
  const classes = [...new Set(t.attempts.map((a) => a.batch_name))];
  const [cls, setCls] = useState(classes.length === 1 ? classes[0] : "");
  const roster = useMemo(() => t.attempts.filter((a) => a.batch_name === cls)
    .sort((a, b) => (Number(a.roll_no) || 1e9) - (Number(b.roll_no) || 1e9) || (a.roll_no ?? "").localeCompare(b.roll_no ?? "") || a.student_name.localeCompare(b.student_name)), [cls, t.attempts]);
  const [docId, setDocId] = useState<string | null>(null);
  const [doc, setDoc] = useState<DocInfo | null>(null);
  const [upl, setUpl] = useState<UploadedFile[]>([]);
  const [uplBusy, setUplBusy] = useState(false);
  const [absent, setAbsent] = useState<Set<string>>(new Set());
  const [perStudent, setPerStudent] = useState(0);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ students: number; pages: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [how, setHow] = useState<"ai" | "order">("ai");
  const nav = useNavigate();

  // Start processing as soon as the scan has finished uploading. With "AI finds each student" the teacher
  // goes straight to the review screen, which fills in as the pages are read.
  useEffect(() => {
    if (!upl.length || uplBusy || docId) return;
    api<{ document_id: string }>(`/tests/${t.id}/sheets`, { body: { upload_id: upl[0].id, identify: how === "ai" } })
      .then((r) => { if (how === "ai") nav(`/app/tests/${t.id}/review/${r.document_id}`); else setDocId(r.document_id); })
      .catch((e) => setError((e as Error).message));
  }, [upl, uplBusy]); // eslint-disable-line react-hooks/exhaustive-deps
  // Follow the processing job until the pages are ready (or it fails).
  useEffect(() => {
    if (!docId) return;
    let stop = false;
    const poll = async () => {
      try { const d = await api<DocInfo>(`/documents/${docId}`); if (!stop) setDoc(d); if (d.status === "completed" || d.status === "failed") return; }
      catch (e) { if (!stop) setError((e as Error).message); }
      if (!stop) setTimeout(poll, 1500);
    };
    void poll();
    return () => { stop = true; };
  }, [docId]);
  // Students who already have marked sheets start unticked, so a re-upload never overwrites them by accident.
  useEffect(() => { setAbsent(new Set(roster.filter((a) => a.status === "evaluated" || a.status === "evaluating").map((a) => a.id))); }, [cls]); // eslint-disable-line react-hooks/exhaustive-deps

  const pageCount = doc?.status === "completed" ? doc.pages.length : 0;
  const present = roster.filter((a) => !absent.has(a.id));
  useEffect(() => { if (pageCount && !touched) setPerStudent(present.length ? (pageCount % present.length === 0 ? pageCount / present.length : Math.max(1, Math.round(pageCount / present.length))) : 1); }, [pageCount, present.length, touched]);
  const k = Math.max(1, perStudent || 1);
  const plan = present.map((a, i) => ({ a, pages: Array.from({ length: k }, (_, j) => i * k + j + 1).filter((n) => n <= pageCount) }));
  const empty = plan.filter((p) => !p.pages.length).length;
  const leftover = Math.max(0, pageCount - present.length * k);
  const busyNow = present.filter((a) => a.status === "evaluating").length;

  const assign = async () => {
    setSaving(true); setError(null);
    try {
      const r = await api<{ students: number; pages: number }>(`/documents/${docId}/assign`, { body: { assignments: plan.filter((p) => p.pages.length).map((p) => ({ attempt_id: p.a.id, pages: p.pages })) } });
      setResult(r); onDone(r.students);
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  };
  const restart = () => { setDocId(null); setDoc(null); setUpl([]); setError(null); setTouched(false); };
  const earlier = (uploads ?? []).filter((u) => u.status === "completed" && u.id !== docId);

  return (
    <Modal title="Upload the class's answer sheets" onClose={saving ? () => {} : onClose} wide>
      <div className="stack">
        {result ? (
          <div className="stack">
            <div className="ok-box">Answer sheets given to <b>{plural(result.students, "student")}</b> ({plural(result.pages, "page")}).</div>
            <p className="small muted" style={{ margin: 0 }}>Someone wrote on extra sheets? Use "Upload" on their row to replace just their pages.</p>
            <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn btn-primary" onClick={onClose}>Done</button></div>
          </div>
        ) : (
          <>
            {!docId && (
              <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="step-label" style={{ marginBottom: 6 }}>How should pages be matched to students?</legend>
                <div className="seg-choice" role="radiogroup">
                  <label className={how === "ai" ? "on" : ""}><input type="radio" name="how" checked={how === "ai"} onChange={() => setHow("ai")} />
                    <b>AI finds each student (recommended)</b><span className="small muted">Reads the name or roll number on each first page. Any order, any number of pages. You check the result.</span></label>
                  <label className={how === "order" ? "on" : ""}><input type="radio" name="how" checked={how === "order"} onChange={() => setHow("order")} />
                    <b>Roll-number order</b><span className="small muted">Sheets scanned in roll order, the same number of pages each.</span></label>
                </div>
              </fieldset>
            )}
            {how === "order" && classes.length > 1 && (
              <label className="field"><span>Which class are these sheets from?</span>
                <select className="input" value={cls} onChange={(e) => { setCls(e.target.value); setTouched(false); }}>
                  <option value="">Choose…</option>{classes.map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
            )}
            {(how === "ai" || cls) && !docId && (
              <>
                <div className="tip-box small">{how === "ai"
                  ? <><b>Tip:</b> make sure every student wrote their name or roll number at the top of their first page. Scan the whole class as one PDF (or a ZIP of PDFs/photos). Big files are fine: the upload resumes if the connection drops.</>
                  : <><b>Easiest way:</b> put the sheets in <b>roll-number order</b> and scan them as one PDF (or a ZIP of PDFs/photos). Big files are fine: the upload resumes if the connection drops.</>}</div>
                {how === "ai" && <span className="row wrap small" style={{ gap: 8 }}><CreditLine /><span className="muted">Finding students costs a small amount per page (see Settings → What things cost).</span></span>}
                <FileUpload purpose="class_sheets" label="Class scan (PDF or ZIP)" onChange={(u, b) => { setUpl(u); setUplBusy(b); }} />
                {earlier.length > 0 && (
                  <div className="small">Or use an earlier upload: {earlier.map((u) => <button key={u.id} type="button" className="btn-link" style={{ marginRight: 10 }} onClick={() => how === "ai" ? nav(`/app/tests/${t.id}/review/${u.id}`) : setDocId(u.id)}>{u.title} ({u.pages} pages)</button>)}</div>
                )}
              </>
            )}
            {docId && doc?.status !== "completed" && (
              <div className="stack" style={{ gap: 8 }}>
                {doc?.status === "failed" ? (
                  <>
                    <div className="error-box">{doc.error ?? "Processing failed."}</div>
                    <div><button className="btn btn-ghost" onClick={restart}>Upload again</button></div>
                  </>
                ) : (
                  <div className="row"><span className="spinner" />
                    <span className="small"><b>{!doc || doc.status === "queued" ? "Queued" : "Processing pages"}…</b>
                      {doc?.job?.attempts && doc.job.last_error ? ` Try ${doc.job.attempts} of ${doc.job.max_attempts} failed; trying again shortly.` : " Big scans take a minute or two. You can close this and come back."}</span></div>
                )}
              </div>
            )}
            {cls && doc?.status === "completed" && (
              <>
                <div className="row wrap" style={{ gap: 18 }}>
                  <label className="field" style={{ width: 170 }}><span>Pages per student</span>
                    <input className="input" type="number" min={1} max={40} value={perStudent || ""} onChange={(e) => { setTouched(true); setPerStudent(Math.min(40, Math.max(0, Number(e.target.value) || 0))); }} />
                  </label>
                  <div className="small grow" style={{ alignSelf: "center" }}>
                    {pageCount === present.length * k ? <span style={{ color: "var(--green)" }}>✓ {pageCount} pages = {present.length} students × {k} pages</span>
                      : empty > 0 ? <span style={{ color: "var(--red)" }}>{pageCount} pages isn't enough for {present.length} students × {k} pages. {plural(empty, "student")} would get nothing. Untick absent students or change pages per student.</span>
                      : <span style={{ color: "var(--amber)" }}>{plural(leftover, "page")} left over at the end. Check for absent students or a different page count.</span>}
                  </div>
                </div>
                <div className="small muted">Untick students who were absent. Each row shows the pages they will get.</div>
                <div className="split-list">
                  {roster.map((a) => {
                    const row = plan.find((p) => p.a.id === a.id);
                    const off = absent.has(a.id);
                    return (
                      <label key={a.id} className={`split-row ${off ? "off" : ""}`}>
                        <input type="checkbox" checked={!off} onChange={() => { const s = new Set(absent); off ? s.delete(a.id) : s.add(a.id); setAbsent(s); }} />
                        <span className="split-roll">{a.roll_no ?? "—"}</span>
                        <span className="grow"><b>{a.student_name}</b>{a.status === "evaluated" && <span className="badge green" style={{ marginLeft: 6 }}>Marked</span>}{a.files > 0 && a.status !== "evaluated" && <span className="badge" style={{ marginLeft: 6 }}>Has sheet</span>}</span>
                        <span className="small muted split-pages">{off ? "Absent" : row?.pages.length ? (row.pages.length === 1 ? `page ${row.pages[0]}` : `pages ${row.pages[0]}–${row.pages[row.pages.length - 1]}`) : <span style={{ color: "var(--red)" }}>no pages</span>}</span>
                        {!off && row?.pages.length ? <PageThumb docId={docId!} n={row.pages[0]} /> : <span className="split-thumb" />}
                      </label>
                    );
                  })}
                </div>
                {busyNow > 0 && <div className="error-box">{plural(busyNow, "sheet")} in this class {busyNow === 1 ? "is" : "are"} being marked right now. Untick {busyNow === 1 ? "it" : "them"} or wait a minute.</div>}
              </>
            )}
            <ErrorBox error={error} />
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" disabled={saving} onClick={onClose}>{doc?.status === "completed" ? "Cancel" : "Close"}</button>
              {doc?.status === "completed" && (
                <button className="btn btn-primary" disabled={saving || empty > 0 || busyNow > 0 || !present.length} onClick={assign}>
                  {saving ? "Saving…" : `Give pages to ${plural(present.length, "student")}`}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
