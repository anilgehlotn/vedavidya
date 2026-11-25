// The guided test flow: ① question paper → ② answer sheets → ③ AI marking → ④ publish.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api, DEMO } from "../../lib/api";
import type { Paper } from "../../lib/types";
import { ErrorBox, Modal, useApi } from "../../components/ui";
import { compressImage, isAllowedFile } from "../../lib/upload";
import { listPages, suggestPerStudent, uploadSplit, type PageRef, type SplitResult } from "../../lib/split";

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
  const [paper, setPaper] = useState<File[]>([]);
  const [key, setKey] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState("");
  const papers = useApi<Paper[]>(tab === "saved" ? "/papers" : null, [tab]);
  const ready = (papers.data ?? []).filter((p) => (p.status === "draft" || p.status === "approved") && p.total_marks > 0);
  const attach = async (paperId: string) => { await api(`/tests/${t.id}/paper`, { method: "PUT", body: { paper_id: paperId } }); onDone(); };

  const upload = async () => {
    setBusy(true); setError(null);
    try {
      const form = new FormData();
      for (const x of paper) { const c = await compressImage(x); form.append("paper", c, c.name); }
      for (const x of key) { const c = await compressImage(x); form.append("key", c, c.name); }
      if (t.subject) form.append("subject", t.subject);
      if (t.batch_names) form.append("class_level", t.batch_names.slice(0, 60));
      const r = await api<{ id: string }>("/papers/import", { form });
      await attach(r.id);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  const picker = (set: (f: File[]) => void) => (e: { target: HTMLInputElement }) => set([...(e.target.files ?? [])].filter(isAllowedFile));

  return (
    <Modal title="Add the question paper" onClose={busy ? () => {} : onClose}>
      <div className="tabs" style={{ marginBottom: 14 }}>
        <button className={tab === "upload" ? "on" : ""} onClick={() => setTab("upload")}>Upload paper</button>
        <button className={tab === "saved" ? "on" : ""} onClick={() => setTab("saved")}>Use a saved paper</button>
        <button className={tab === "ai" ? "on" : ""} onClick={() => setTab("ai")}>Create with AI</button>
      </div>
      {tab === "upload" && (
        <div className="stack">
          <FilePick label="Question paper" required files={paper} onPick={picker(setPaper)} help="Photos of each page or one PDF" />
          <FilePick label="Answer key / marking scheme" files={key} onPick={picker(setKey)} help="Optional. Without it, AI solves each question and you can check it." />
          <ErrorBox error={error} />
          <button className="btn btn-primary" disabled={busy || !paper.length} onClick={upload}>{busy ? "Uploading…" : "Add paper"}</button>
          <p className="small muted" style={{ margin: 0 }}>AI reads the questions and marks in 1–2 minutes. You can check and edit them before marking.</p>
        </div>
      )}
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

function FilePick({ label, files, onPick, help, required }: { label: string; files: File[]; onPick: (e: { target: HTMLInputElement }) => void; help: string; required?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="field">
      <span>{label}{required ? "" : " (optional)"}</span>
      <input ref={ref} type="file" multiple accept={ACCEPT} style={{ display: "none" }} onChange={onPick} />
      <div className="drop" role="button" tabIndex={0} onClick={() => ref.current?.click()} onKeyDown={(e) => e.key === "Enter" && ref.current?.click()}>
        {files.length ? <b>{plural(files.length, "file")} chosen ✓</b> : <>Tap to choose · <span className="small">{help}</span></>}
      </div>
    </div>
  );
}

// ---------- ② Answer sheets: the whole class in one go ----------
export function ClassUploadWizard({ t, onClose, onDone }: { t: FlowTest; onClose: () => void; onDone: (uploaded: number) => void }) {
  const classes = [...new Set(t.attempts.map((a) => a.batch_name))];
  const [cls, setCls] = useState(classes.length === 1 ? classes[0] : "");
  const roster = useMemo(() => t.attempts.filter((a) => a.batch_name === cls)
    .sort((a, b) => (Number(a.roll_no) || 1e9) - (Number(b.roll_no) || 1e9) || (a.roll_no ?? "").localeCompare(b.roll_no ?? "") || a.student_name.localeCompare(b.student_name)), [cls, t.attempts]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<PageRef[] | null>(null);
  const [reading, setReading] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [absent, setAbsent] = useState<Set<string>>(new Set());
  const [perStudent, setPerStudent] = useState(0);
  const [touched, setTouched] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<SplitResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Students who already have marked sheets start unticked, so re-uploading never overwrites them by accident.
  useEffect(() => { setAbsent(new Set(roster.filter((a) => a.status === "evaluated" || a.status === "evaluating").map((a) => a.id))); }, [cls]); // eslint-disable-line react-hooks/exhaustive-deps
  const present = roster.filter((a) => !absent.has(a.id));
  useEffect(() => { if (pages && !touched) setPerStudent(suggestPerStudent(pages.length, present.length)); }, [pages, present.length, touched]);

  const choose = async (list: File[]) => {
    setReading(true); setError(null); setResult(null); setTouched(false);
    const r = await listPages(list);
    setPages(r.pages.length ? r.pages : null); setProblems(r.problems); setReading(false);
    if (!r.pages.length) setError("No pages found. Choose a PDF or photos (JPG, PNG, WEBP).");
  };
  const k = Math.max(1, perStudent || 1);
  const needed = present.length * k;
  const plan = present.map((a, i) => ({ a, pages: (pages ?? []).slice(i * k, (i + 1) * k) }));
  const empty = plan.filter((p) => !p.pages.length).length;
  const leftover = Math.max(0, (pages?.length ?? 0) - needed);
  const busyNow = present.filter((a) => a.status === "evaluating").length;

  const thumbs = useMemo(() => new Map((pages ?? []).filter((p) => p.kind === "image").map((p) => [p, URL.createObjectURL(p.file)])), [pages]);
  useEffect(() => () => thumbs.forEach((u) => URL.revokeObjectURL(u)), [thumbs]);

  const start = async () => {
    setError(null);
    const jobs = plan.filter((p) => p.pages.length).map((p) => ({ attemptId: p.a.id, label: `Roll ${p.a.roll_no ?? "-"} ${p.a.student_name}`, pages: p.pages }));
    try { const r = await uploadSplit(jobs, (done, total) => setProgress({ done, total })); setResult(r); onDone(r.done.length); }
    catch (e) { setError((e as Error).message); }
    finally { setProgress(null); }
  };

  return (
    <Modal title="Upload the class's answer sheets" onClose={progress ? () => {} : onClose} wide>
      <div className="stack">
        {result ? (
          <div className="stack">
            <div className="ok-box">Uploaded answer sheets for <b>{plural(result.done.length, "student")}</b>.</div>
            {result.failed.length > 0 && <div className="error-box">Not uploaded: {result.failed.map((f) => `${f.label} (${f.error})`).join("; ")}. Upload these from the student's row.</div>}
            <p className="small muted" style={{ margin: 0 }}>Someone wrote on extra sheets? Use “Upload” on their row in the list to replace just their pages.</p>
            <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn btn-primary" onClick={onClose}>Done</button></div>
          </div>
        ) : (
          <>
            {classes.length > 1 && (
              <label className="field"><span>Which class are these sheets from?</span>
                <select className="input" value={cls} onChange={(e) => { setCls(e.target.value); setTouched(false); }}>
                  <option value="">Choose…</option>{classes.map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
            )}
            {cls && (
              <>
                <div className="tip-box small">
                  <b>Easiest way:</b> put the answer sheets in <b>roll-number order</b> and scan them as one PDF (or take photos in that order).
                  We split the pages between students for you.
                </div>
                <input ref={inputRef} type="file" multiple accept={ACCEPT} style={{ display: "none" }} onChange={(e) => choose([...(e.target.files ?? [])])} />
                <div className="drop" role="button" tabIndex={0} onClick={() => !progress && inputRef.current?.click()} onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); choose([...e.dataTransfer.files]); }}>
                  {reading ? <><span className="spinner" /> Counting pages…</> : pages ? <b>{plural(pages.length, "page")} found ✓ <span className="small muted">(tap to choose again)</span></b> : <>Tap to choose the scanned PDF or photos, or drop them here</>}
                </div>
                {problems.length > 0 && <div className="error-box">{problems.join(" ")}</div>}
                {pages && (
                  <>
                    <div className="row wrap" style={{ gap: 18 }}>
                      <label className="field" style={{ width: 170 }}><span>Pages per student</span>
                        <input className="input" type="number" min={1} max={30} value={perStudent || ""} onChange={(e) => { setTouched(true); setPerStudent(Math.min(30, Math.max(0, Number(e.target.value) || 0))); }} />
                      </label>
                      <div className="small grow" style={{ alignSelf: "center" }}>
                        {pages.length === needed ? <span style={{ color: "var(--green)" }}>✓ {pages.length} pages = {present.length} students × {k} pages</span>
                          : empty > 0 ? <span style={{ color: "var(--red)" }}>{pages.length} pages isn't enough for {present.length} students × {k} pages. {plural(empty, "student")} would get nothing. Untick absent students or change pages per student.</span>
                          : <span style={{ color: "var(--amber)" }}>{plural(leftover, "page")} left over at the end. Check for absent students or a different page count.</span>}
                      </div>
                    </div>
                    <div className="small muted">Untick students who were absent. Each row shows the pages they will get.</div>
                    <div className="split-list">
                      {roster.map((a) => {
                        const row = plan.find((p) => p.a.id === a.id);
                        const first = row?.pages[0];
                        const off = absent.has(a.id);
                        return (
                          <label key={a.id} className={`split-row ${off ? "off" : ""}`}>
                            <input type="checkbox" checked={!off} onChange={() => { const s = new Set(absent); off ? s.delete(a.id) : s.add(a.id); setAbsent(s); }} />
                            <span className="split-roll">{a.roll_no ?? "—"}</span>
                            <span className="grow"><b>{a.student_name}</b>{a.status === "evaluated" && <span className="badge green" style={{ marginLeft: 6 }}>Marked</span>}{a.files > 0 && a.status !== "evaluated" && <span className="badge" style={{ marginLeft: 6 }}>Has sheet</span>}</span>
                            <span className="small muted split-pages">{off ? "Absent" : row?.pages.length ? (row.pages.length === 1 ? `page ${pages.indexOf(row.pages[0]) + 1}` : `pages ${pages.indexOf(row.pages[0]) + 1}–${pages.indexOf(row.pages[row.pages.length - 1]) + 1}`) : <span style={{ color: "var(--red)" }}>no pages</span>}</span>
                            {thumbs.size > 0 && (first?.kind === "image" ? <img className="split-thumb" src={thumbs.get(first)} alt="" /> : <span className="split-thumb" />)}
                          </label>
                        );
                      })}
                    </div>
                    {busyNow > 0 && <div className="error-box">{plural(busyNow, "sheet")} in this class {busyNow === 1 ? "is" : "are"} being marked right now. Untick {busyNow === 1 ? "it" : "them"} or wait a minute.</div>}
                  </>
                )}
                <ErrorBox error={error} />
                {progress && (
                  <div>
                    <div className="row between small"><span>Uploading…</span><span>{progress.done} / {progress.total} students</span></div>
                    <div className="bar" style={{ marginTop: 6 }}><i style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
                  </div>
                )}
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  <button className="btn btn-ghost" disabled={!!progress} onClick={onClose}>Cancel</button>
                  <button className="btn btn-primary" disabled={!pages || !!progress || empty > 0 || busyNow > 0 || !present.length} onClick={start}>
                    {progress ? "Uploading…" : `Upload for ${plural(present.length, "student")}`}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
