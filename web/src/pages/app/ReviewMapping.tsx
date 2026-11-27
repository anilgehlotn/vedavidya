// Review pages: after a class scan is uploaded, the AI groups its pages by student (from the name / roll number on
// each first page). The teacher checks the groups, moves pages that went to the wrong student, then approves.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, blobUrl } from "../../lib/api";
import { Empty, ErrorState, PageSkeleton, PageTitle, useApi } from "../../components/ui";
import { Icon } from "../../components/icons";
import { useRun, useToast } from "../../components/toast";
import { CreditLine } from "./Credits";

interface MapPage { n: number; width: number | null; height: number | null; attempt_id: string | null; first_page: boolean; name_written: string | null; roll_written: string | null; confidence: string | null; method: string | null; approved: boolean }
interface MapStudent { attempt_id: string; name: string; roll_no: string | null; status: string; score: number | null; files: number }
interface Mapping { document: { id: string; title: string; status: string; error: string | null; identify: boolean }; identifying: boolean; pages: MapPage[]; students: MapStudent[] }
interface Group { key: string; attempt_id: string | null; student?: MapStudent; pages: MapPage[]; problem: string | null; approved: boolean }

/** Groups pages by student, in page order. Unassigned pages are grouped by runs. */
function groupsOf(m: Mapping): Group[] {
  const byId = new Map(m.students.map((s) => [s.attempt_id, s]));
  const groups: Group[] = [];
  const seen = new Map<string, Group>();
  for (const p of [...m.pages].sort((a, b) => a.n - b.n)) {
    if (p.attempt_id) {
      let g = seen.get(p.attempt_id);
      if (!g) { g = { key: p.attempt_id, attempt_id: p.attempt_id, student: byId.get(p.attempt_id), pages: [], problem: null, approved: false }; seen.set(p.attempt_id, g); groups.push(g); }
      g.pages.push(p);
    } else {
      const last = groups[groups.length - 1];
      if (last && !last.attempt_id && !p.first_page) last.pages.push(p);
      else groups.push({ key: `none-${p.n}`, attempt_id: null, pages: [p], problem: null, approved: false });
    }
  }
  for (const g of groups) {
    g.approved = g.pages.every((p) => p.approved);
    const low = g.pages.some((p) => p.confidence === "low" && p.method === "ai");
    const gaps = g.pages.some((p, i) => i > 0 && p.n !== g.pages[i - 1].n + 1);
    g.problem = !g.attempt_id ? "Whose pages are these?" : gaps ? "Pages are not next to each other" : low ? "The AI wasn't sure" : null;
  }
  return groups;
}

export default function ReviewMapping() {
  const { id, docId } = useParams();
  const m = useApi<Mapping>(`/documents/${docId}/mapping`);
  const test = useApi<{ title: string; paper_problem: string | null }>(`/tests/${id}`);
  const [viewer, setViewer] = useState<number | null>(null);
  const [skipApproved, setSkipApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [perStudent, setPerStudent] = useState(2);
  const run = useRun();
  const toast = useToast();
  const nav = useNavigate();
  const working = Boolean(m.data && (m.data.identifying || m.data.document.status === "queued" || m.data.document.status === "processing"));
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => m.reload(true), 2000);
    return () => clearInterval(t);
  }, [working]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => (m.data ? groupsOf(m.data) : []), [m.data]);
  const missing = useMemo(() => (m.data ? m.data.students.filter((s) => !groups.some((g) => g.attempt_id === s.attempt_id) && !s.files) : []), [m.data, groups]);
  const shown = groups.filter((g) => !skipApproved || !g.approved).sort((a, b) => Number(Boolean(b.problem)) - Number(Boolean(a.problem)));
  const crumbs = [{ label: "Assessments" }, { label: "Tests", to: "/app/tests" }, { label: test.data?.title ?? "Test", to: `/app/tests/${id}` }];

  if (m.loading) return <PageSkeleton />;
  if (!m.data) return <><PageTitle title="Review pages" crumbs={crumbs} /><div className="card"><ErrorState error={m.error} onRetry={() => m.reload()} /></div></>;
  const d = m.data;
  const unassigned = d.pages.filter((p) => !p.attempt_id).length;
  const toApprove = groups.filter((g) => g.attempt_id && !g.approved);
  const problems = groups.filter((g) => g.problem && !g.approved).length;

  const move = async (pages: number[], attempt_id: string | null, first_page?: boolean) => {
    if (await run(() => api(`/documents/${docId}/mapping`, { method: "PUT", body: { pages: pages.map((n, i) => ({ n, attempt_id, ...(first_page != null && i === 0 ? { first_page } : {}) })) } }))) m.reload(true);
  };
  const approve = async (ids?: string[], mark = false) => {
    setBusy(true);
    const r = await run(() => api<{ students: number; pages: number; marking: boolean }>(`/documents/${docId}/approve`, { body: { attempt_ids: ids, mark } }),
      (x) => `${x.students} student${x.students === 1 ? "" : "s"} approved (${x.pages} pages).${x.marking ? " Marking has started." : ""}`);
    setBusy(false);
    if (r) { m.reload(true); if (mark) nav(`/app/tests/${id}`); }
  };
  const byOrder = async () => {
    if (!confirm(`Give pages in roll-number order, ${perStudent} per student? This replaces the current grouping (approved students keep their pages until you approve again).`)) return;
    if (await run(() => api(`/documents/${docId}/map-by-order`, { body: { pages_per_student: perStudent } }), "Pages grouped by roll-number order.")) m.reload(true);
  };

  return (
    <>
      <PageTitle title="Review pages" crumbs={crumbs} sub={`${d.document.title} · ${d.pages.length} pages`}>
        <button className="btn btn-ghost" disabled={busy || !toApprove.length || working} onClick={() => approve()}>Approve all</button>
        <button className="btn btn-primary" disabled={busy || !toApprove.length || working || Boolean(test.data?.paper_problem)} title={test.data?.paper_problem ?? undefined} onClick={() => approve(undefined, true)}>✓ Approve all & mark</button>
      </PageTitle>

      {working ? (
        <div className="next-banner" role="status"><span className="spinner" /><span className="grow">{d.document.status !== "completed" ? "Preparing the pages…" : "The AI is reading names and roll numbers on each page…"} This takes about a minute for a class.</span></div>
      ) : d.document.error ? (
        <div className="error-box" style={{ marginBottom: 14 }}>{d.document.error}</div>
      ) : (
        <div className="review-stats">
          <span className="badge green">{groups.filter((g) => g.attempt_id).length} students found</span>
          {unassigned > 0 && <span className="badge amber">{unassigned} page{unassigned === 1 ? "" : "s"} without a student</span>}
          {problems > 0 && <span className="badge red">{problems} to check</span>}
          {missing.length > 0 && <span className="badge">{missing.length} student{missing.length === 1 ? "" : "s"} with no pages (absent?)</span>}
          <label className="row small" style={{ marginLeft: "auto", gap: 6 }}><input type="checkbox" checked={skipApproved} onChange={(e) => setSkipApproved(e.target.checked)} /> Skip approved</label>
        </div>
      )}

      {!working && (
        <details className="card card-pad" style={{ marginBottom: 16 }} open={Boolean(d.document.error) || (!d.document.identify && !d.pages.some((p) => p.attempt_id))}>
          <summary className="small" style={{ cursor: "pointer", fontWeight: 600 }}>Group by roll-number order instead</summary>
          <div className="row wrap" style={{ marginTop: 10, alignItems: "flex-end" }}>
            <label className="field" style={{ width: 160 }}><span>Pages per student</span><input className="input" type="number" min={1} max={40} value={perStudent} onChange={(e) => setPerStudent(Math.max(1, Math.min(40, Number(e.target.value) || 1)))} /></label>
            <button className="btn btn-ghost" onClick={byOrder}>Group by order</button>
            <span className="small muted">Use this when the sheets were scanned in roll-number order with the same number of pages each.</span>
          </div>
        </details>
      )}

      {!working && !shown.length ? (
        <div className="card"><Empty title={skipApproved ? "Everything is approved" : "No pages yet"} icon="check" action={<Link className="btn btn-primary btn-sm" to={`/app/tests/${id}`}>Back to the test</Link>}>
          {skipApproved ? "All students have their pages. Mark them from the test page." : "Pages appear here once the upload is processed."}</Empty></div>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          {shown.map((g) => (
            <section key={g.key} className={`card map-group ${g.problem && !g.approved ? "warn" : ""} ${g.approved ? "ok" : ""}`} aria-label={g.student?.name ?? "Pages without a student"}>
              <div className="map-head">
                <div className="grow" style={{ minWidth: 0 }}>
                  {g.student ? <b>{g.student.name}</b> : <b style={{ color: "var(--amber)" }}>No student yet</b>}
                  {g.student?.roll_no && <span className="small muted"> · Roll {g.student.roll_no}</span>}
                  <span className="small muted"> · {g.pages.length} page{g.pages.length === 1 ? "" : "s"} ({g.pages.map((p) => p.n).join(", ")})</span>
                  <div className="small muted">{readText(g.pages[0])}</div>
                </div>
                {g.approved ? <span className="badge green">✓ Approved</span> : g.problem && <span className="badge amber">{g.problem}</span>}
                <select className="input input-sm map-assign" aria-label={`Give pages ${g.pages.map((p) => p.n).join(", ")} to`} value={g.attempt_id ?? ""} onChange={(e) => move(g.pages.map((p) => p.n), e.target.value || null)}>
                  <option value="">— No student —</option>
                  {d.students.map((s) => <option key={s.attempt_id} value={s.attempt_id}>{s.roll_no ? `${s.roll_no}. ` : ""}{s.name}</option>)}
                </select>
                {g.attempt_id && !g.approved && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => approve([g.attempt_id!])}>Approve</button>}
              </div>
              <div className="map-thumbs">
                {g.pages.map((p) => (
                  <button key={p.n} type="button" className={`map-thumb ${p.first_page ? "first" : ""}`} onClick={() => setViewer(p.n)} aria-label={`Open page ${p.n}`}>
                    <Thumb docId={docId!} n={p.n} />
                    <span className="map-n">{p.n}{p.first_page ? " · first" : ""}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {!working && toApprove.length > 0 && <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}><CreditLine action="mark_sheet" units={toApprove.length} /></div>}

      {viewer != null && (
        <PageViewer docId={docId!} pages={d.pages} students={d.students} n={viewer} onNav={setViewer} onClose={() => setViewer(null)}
          onMove={async (n, attempt) => { await move([n], attempt); toast.info(`Page ${n} moved.`); }}
          onMoveFrom={async (n, attempt) => {
            // This page and every later page of its current group go to the chosen student (a missed new sheet).
            const cur = d.pages.find((p) => p.n === n)?.attempt_id ?? null;
            const run = d.pages.filter((p) => p.n >= n && p.attempt_id === cur).map((p) => p.n).sort((a, b) => a - b);
            const contiguous = run.filter((x, i) => x === n + i);
            await move(contiguous, attempt, true);
            toast.info(`Pages ${contiguous[0]}–${contiguous[contiguous.length - 1]} moved.`);
          }} />
      )}
    </>
  );
}

const readText = (p: MapPage) => (p.method === "order" ? "Grouped by roll-number order" : p.method === "teacher" ? "Set by you"
  : p.name_written || p.roll_written ? `AI read: ${[p.name_written && `"${p.name_written}"`, p.roll_written && `roll ${p.roll_written}`].filter(Boolean).join(", ")}${p.confidence ? ` (${p.confidence} confidence)` : ""}`
  : p.method === "ai" ? "No name or roll number found" : "");

function Thumb({ docId, n, big }: { docId: string; n: number; big?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let made = "";
    blobUrl(`/documents/${docId}/pages/${n}`).then((f) => { made = f.url; setUrl(f.url); }).catch(() => setErr(true));
    return () => { if (made) URL.revokeObjectURL(made); };
  }, [docId, n]);
  if (err) return <span className="small muted">Page unavailable</span>;
  return url ? <img src={url} alt={`Page ${n}`} className={big ? "viewer-img" : undefined} loading="lazy" /> : <span className="sk" style={{ display: "block", width: "100%", height: "100%" }} />;
}

function PageViewer({ docId, pages, students, n, onNav, onClose, onMove, onMoveFrom }: {
  docId: string; pages: MapPage[]; students: MapStudent[]; n: number; onNav: (n: number) => void; onClose: () => void;
  onMove: (n: number, attempt: string | null) => void; onMoveFrom: (n: number, attempt: string | null) => void;
}) {
  const order = [...pages].sort((a, b) => a.n - b.n);
  const i = order.findIndex((p) => p.n === n);
  const p = order[i];
  const [to, setTo] = useState(p?.attempt_id ?? "");
  useEffect(() => setTo(p?.attempt_id ?? ""), [p?.n, p?.attempt_id]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && i < order.length - 1) onNav(order[i + 1].n);
      if (e.key === "ArrowLeft" && i > 0) onNav(order[i - 1].n);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [i, order, onNav, onClose]);
  if (!p) return null;
  const owner = students.find((s) => s.attempt_id === p.attempt_id);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="viewer" role="dialog" aria-label={`Page ${p.n}`}>
        <div className="viewer-head">
          <b>Page {p.n} of {order.length}</b><span className="small muted grow"> · {owner ? owner.name : "No student"} · {readText(p)}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <div className="viewer-body">
          <button className="icon-btn viewer-nav" disabled={i === 0} onClick={() => onNav(order[i - 1].n)} aria-label="Previous page">‹</button>
          <div className="viewer-page"><Thumb docId={docId} n={p.n} big /></div>
          <button className="icon-btn viewer-nav" disabled={i === order.length - 1} onClick={() => onNav(order[i + 1].n)} aria-label="Next page">›</button>
        </div>
        <div className="viewer-foot">
          <label className="field grow"><span>This page belongs to</span>
            <select className="input" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Student for this page">
              <option value="">— No student —</option>{students.map((s) => <option key={s.attempt_id} value={s.attempt_id}>{s.roll_no ? `${s.roll_no}. ` : ""}{s.name}</option>)}
            </select></label>
          <button className="btn btn-ghost" disabled={to === (p.attempt_id ?? "")} onClick={() => onMove(p.n, to || null)}>Move this page</button>
          <button className="btn btn-primary" disabled={to === (p.attempt_id ?? "")} onClick={() => onMoveFrom(p.n, to || null)} title="This page starts a new student's sheet: move it and the pages after it">Move this and the next pages</button>
        </div>
      </div>
    </div>
  );
}
