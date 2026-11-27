// Batches: cards (or a list) with search and filters, plus centres and courses, and moving students between batches.
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, fmtDate } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { Empty, ErrorBox, ErrorState, Loading, Modal, PageTitle, SkeletonCards, SkeletonTable, useApi } from "../../components/ui";
import { Icon } from "../../components/icons";
import { useRun, useToast } from "../../components/toast";
import { CoursesCard, type Course } from "./Courses";

interface Centre { id: string; name: string; city: string | null; batch_count: number }
export interface Batch { id: string; name: string; course: string | null; course_id: string | null; course_name: string | null; start_date: string | null; centre_id: string | null; centre_name: string | null;
  teacher_id: string | null; teacher_name: string | null; student_count: number; test_count: number; avg_pct: number | null }
interface Staff { id: string; name: string }
type Tab = "batches" | "centres" | "courses";
const readView = (): "grid" | "list" => { try { return localStorage.getItem("vv_batch_view") === "list" ? "list" : "grid"; } catch { return "grid"; } };

export function Batches() {
  const { user } = useAuth();
  const isAdmin = user!.role === "admin";
  const centres = useApi<Centre[]>("/centres");
  const batches = useApi<Batch[]>("/batches");
  const staff = useApi<Staff[]>("/teachers");
  const courses = useApi<Course[]>("/courses");
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "batches";
  const [q, setQ] = useState("");
  const centreF = params.get("centre") ?? "", courseF = params.get("course") ?? "";
  const [view, setView] = useState(readView);
  useEffect(() => { try { localStorage.setItem("vv_batch_view", view); } catch { /* ignore */ } }, [view]);
  const [modal, setModal] = useState<null | "centre" | { batch?: Batch } | { transfer: Batch }>(null);
  const run = useRun();
  const setParam = (k: string, v: string) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); };
  const reloadAll = () => { batches.reload(true); centres.reload(true); courses.reload(true); };

  const list = useMemo(() => (batches.data ?? []).filter((b) =>
    (!centreF || (centreF === "none" ? !b.centre_id : b.centre_id === centreF)) && (!courseF || b.course_id === courseF) &&
    (!q || `${b.name} ${b.course_name ?? ""} ${b.teacher_name ?? ""} ${b.centre_name ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [batches.data, q, centreF, courseF]);
  const del = async (b: Batch) => {
    if (!confirm(`Delete the batch "${b.name}"?${b.student_count ? ` Its ${b.student_count} students stay in your institute but leave this batch.` : ""} This can't be undone.`)) return;
    if (await run(() => api(`/batches/${b.id}`, { method: "DELETE" }), `Batch "${b.name}" deleted.`)) reloadAll();
  };

  return (
    <>
      <PageTitle title="Batches" sub="Your classes, where they meet, and who teaches them">
        {isAdmin && <><button className="btn btn-ghost" onClick={() => setModal("centre")}>+ Centre</button><button className="btn btn-primary" onClick={() => setModal({})}>+ Batch</button></>}
      </PageTitle>
      <div className="tabs" role="tablist" style={{ marginBottom: 16 }}>
        {(["batches", "centres", "courses"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setParam("tab", t === "batches" ? "" : t)}>
            {t === "batches" ? `Batches${batches.data ? ` (${batches.data.length})` : ""}` : t === "centres" ? `Centres${centres.data ? ` (${centres.data.length})` : ""}` : "Courses & subjects"}
          </button>
        ))}
      </div>

      {tab === "courses" && <CoursesCard isAdmin={isAdmin} />}

      {tab === "centres" && (
        <div className="card">
          {centres.loading ? <div className="card-pad"><SkeletonTable rows={2} cols={3} /></div> : !centres.data ? <ErrorState error={centres.error} onRetry={() => centres.reload()} />
            : !centres.data.length ? <Empty title="No centres yet" icon="institute" action={isAdmin ? <button className="btn btn-primary btn-sm" onClick={() => setModal("centre")}>+ Centre</button> : undefined}>A centre is a branch or campus. Batches can belong to a centre.</Empty> : (
              <div className="table-wrap"><table className="t">
                <thead><tr><th>Centre</th><th>City</th><th>Batches</th><th></th></tr></thead>
                <tbody>{centres.data.map((c) => (
                  <tr key={c.id}><td><b>{c.name}</b></td><td>{c.city ?? "—"}</td>
                    <td><button className="btn-link" onClick={() => setParams({ centre: c.id })}>{c.batch_count} batch{c.batch_count === 1 ? "" : "es"}</button></td>
                    <td style={{ textAlign: "right" }}>{isAdmin && <button className="btn btn-danger btn-sm" onClick={async () => {
                      if (!confirm(`Delete the centre "${c.name}"? Its batches stay, without a centre.`)) return;
                      if (await run(() => api(`/centres/${c.id}`, { method: "DELETE" }), `Centre "${c.name}" deleted.`)) reloadAll();
                    }}>Delete</button>}</td></tr>))}
                </tbody>
              </table></div>
            )}
        </div>
      )}

      {tab === "batches" && (
        <>
          <div className="filters">
            <div className="search-field"><Icon name="search" size={16} /><input className="input" placeholder="Search batches, teachers…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search batches" /></div>
            <select className="input" value={centreF} onChange={(e) => setParam("centre", e.target.value)} aria-label="Centre">
              <option value="">All centres</option>{centres.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}<option value="none">No centre</option>
            </select>
            <select className="input" value={courseF} onChange={(e) => setParam("course", e.target.value)} aria-label="Course">
              <option value="">All courses</option>{courses.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="seg" role="group" aria-label="View">
              <button className={view === "grid" ? "on" : ""} aria-pressed={view === "grid"} onClick={() => setView("grid")} title="Cards"><Icon name="batches" size={16} /><span className="sr-only">Cards</span></button>
              <button className={view === "list" ? "on" : ""} aria-pressed={view === "list"} onClick={() => setView("list")} title="List"><Icon name="menu" size={16} /><span className="sr-only">List</span></button>
            </div>
          </div>
          {batches.loading ? <SkeletonCards count={6} /> : !batches.data ? <div className="card"><ErrorState error={batches.error} onRetry={() => batches.reload()} /></div>
            : !batches.data.length ? <div className="card"><Empty title="No batches yet" icon="batches" action={isAdmin ? <button className="btn btn-primary btn-sm" onClick={() => setModal({})}>+ Batch</button> : undefined}>A batch is a class of students, e.g. "NEET 2027 Morning". Tests are given to batches.</Empty></div>
            : !list.length ? <div className="card"><Empty title="No batches match" icon="search" action={<button className="btn btn-ghost btn-sm" onClick={() => { setQ(""); setParams({}); }}>Clear search and filters</button>}>Try another name, centre or course.</Empty></div>
            : view === "grid" ? (
              <div className="grid g3 batch-grid">
                {list.map((b) => (
                  <div key={b.id} className="card card-pad batch-card">
                    <div className="row between" style={{ alignItems: "flex-start" }}>
                      <div style={{ minWidth: 0 }}><b className="batch-name">{b.name}</b>
                        <div className="small muted">{[b.centre_name, b.start_date && `Started ${fmtDate(b.start_date)}`].filter(Boolean).join(" · ") || "No centre"}</div></div>
                      {b.course_name && <span className="badge violet">{b.course_name}</span>}
                    </div>
                    <div className="batch-stats">
                      <Link to={`/app/students?batch=${b.id}`}><b>{b.student_count}</b><span>Students</span></Link>
                      <div><b>{b.test_count}</b><span>Tests</span></div>
                      <div><b>{b.avg_pct == null ? "—" : `${b.avg_pct}%`}</b><span>Average</span></div>
                    </div>
                    <div className="small muted row" style={{ gap: 6 }}><Icon name="staff" size={15} />{b.teacher_name ?? "No lead teacher"}</div>
                    <BatchActions b={b} isAdmin={isAdmin} onEdit={() => setModal({ batch: b })} onTransfer={() => setModal({ transfer: b })} onDelete={() => del(b)} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="card"><div className="table-wrap"><table className="t">
                <thead><tr><th>Batch</th><th>Course</th><th>Centre</th><th>Lead teacher</th><th>Students</th><th>Avg</th><th></th></tr></thead>
                <tbody>{list.map((b) => (
                  <tr key={b.id}>
                    <td><b>{b.name}</b>{b.start_date && <div className="small muted">Started {fmtDate(b.start_date)}</div>}</td>
                    <td>{b.course_name ?? "—"}</td><td>{b.centre_name ?? "—"}</td><td>{b.teacher_name ?? "—"}</td>
                    <td><Link to={`/app/students?batch=${b.id}`} className="btn-link">{b.student_count}</Link></td>
                    <td>{b.avg_pct == null ? "—" : `${b.avg_pct}%`}</td>
                    <td><BatchActions b={b} isAdmin={isAdmin} onEdit={() => setModal({ batch: b })} onTransfer={() => setModal({ transfer: b })} onDelete={() => del(b)} /></td>
                  </tr>))}
                </tbody>
              </table></div></div>
            )}
        </>
      )}

      {modal === "centre" && <CentreModal onClose={() => setModal(null)} onSaved={reloadAll} />}
      {modal && typeof modal === "object" && !("transfer" in modal) && (
        <BatchModal batch={modal.batch} centres={centres.data ?? []} staff={staff.data ?? []} courses={courses.data ?? []} onClose={() => setModal(null)} onSaved={reloadAll} />
      )}
      {modal && typeof modal === "object" && "transfer" in modal && (
        <TransferModal from={modal.transfer} batches={batches.data ?? []} onClose={() => setModal(null)} onDone={reloadAll} />
      )}
    </>
  );
}

function BatchActions({ b, isAdmin, onEdit, onTransfer, onDelete }: { b: Batch; isAdmin: boolean; onEdit: () => void; onTransfer: () => void; onDelete: () => void }) {
  return (
    <div className="row wrap batch-actions">
      <Link to={`/app/analytics?batch=${b.id}`} className="btn btn-ghost btn-sm">Analytics</Link>
      {b.student_count > 0 && <button className="btn btn-ghost btn-sm" onClick={onTransfer}>Move students</button>}
      {isAdmin && <button className="btn btn-ghost btn-sm" onClick={onEdit}>Edit</button>}
      {isAdmin && <button className="btn btn-danger btn-sm btn-icon" onClick={onDelete} aria-label={`Delete ${b.name}`} title="Delete batch"><Icon name="trash" size={15} /></button>}
    </div>
  );
}

function CentreModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: "", city: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api("/centres", { body: f }); toast.success(`Centre "${f.name}" created.`); onSaved(); onClose(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal title="New centre" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <label className="field"><span>Name</span><input className="input" required autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Kota Main Campus" /></label>
        <label className="field"><span>City</span><input className="input" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></label>
        <ErrorBox error={err} /><button className="btn btn-primary" disabled={busy}>{busy ? "Creating…" : "Create centre"}</button>
      </form>
    </Modal>
  );
}

function BatchModal({ batch, centres, staff, courses, onClose, onSaved }: { batch?: Batch; centres: Centre[]; staff: Staff[]; courses: Course[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: batch?.name ?? "", course: batch?.course_name ?? batch?.course ?? "", centre_id: batch?.centre_id ?? centres[0]?.id ?? "", teacher_id: batch?.teacher_id ?? "", start_date: batch?.start_date ?? "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await api(batch ? `/batches/${batch.id}` : "/batches", { method: batch ? "PUT" : "POST", body: { ...f, start_date: f.start_date || null } });
      toast.success(batch ? "Batch saved." : `Batch "${f.name}" created.`); onSaved(); onClose();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal title={batch ? "Edit batch" : "New batch"} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <label className="field"><span>Batch name</span><input className="input" required autoFocus value={f.name} onChange={set("name")} placeholder="e.g. NEET 2027 - Morning" /></label>
        <div className="grid g2">
          <label className="field"><span>Course</span><input className="input" list="course-list" value={f.course} onChange={set("course")} placeholder="e.g. 10th CBSE" />
            <datalist id="course-list">{courses.map((x) => <option key={x.id} value={x.name} />)}</datalist></label>
          <label className="field"><span>Start date</span><input className="input" type="date" value={f.start_date} onChange={set("start_date")} /></label>
          <label className="field"><span>Centre</span><select className="input" value={f.centre_id} onChange={set("centre_id")}><option value="">None</option>{centres.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label className="field"><span>Lead teacher</span><select className="input" value={f.teacher_id} onChange={set("teacher_id")}><option value="">None</option>{staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        </div>
        <p className="small muted" style={{ margin: 0 }}>Typing a new course name creates the course.</p>
        <ErrorBox error={err} /><button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : batch ? "Save" : "Create batch"}</button>
      </form>
    </Modal>
  );
}

interface StudentRow { id: string; name: string; roll_no: string | null }
function TransferModal({ from, batches, onClose, onDone }: { from: Batch; batches: Batch[]; onClose: () => void; onDone: () => void }) {
  const students = useApi<StudentRow[]>(`/students?batch_id=${from.id}`);
  const others = batches.filter((b) => b.id !== from.id);
  const [to, setTo] = useState(others[0]?.id ?? "");
  const [picked, setPicked] = useState<Set<string> | null>(null); // null = everyone
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const all = students.data ?? [];
  const chosen = picked ?? new Set(all.map((s) => s.id));
  const toggle = (id: string) => { const n = new Set(chosen); if (n.has(id)) n.delete(id); else n.add(id); setPicked(n); };
  const move = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ moved: number; roll_cleared: string[] }>(`/batches/${from.id}/transfer`, { body: { to_batch_id: to, student_ids: [...chosen] } });
      const target = others.find((b) => b.id === to)?.name;
      toast.success(`Moved ${r.moved} student${r.moved === 1 ? "" : "s"} to ${target}.`);
      if (r.roll_cleared.length) toast.info(`Roll numbers already used in ${target}, so cleared for: ${r.roll_cleared.join(", ")}. Set new ones in Students.`);
      onDone(); onClose();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Move students from ${from.name}`} onClose={onClose}>
      {!others.length ? <Empty title="No other batch" icon="batches">Create another batch first, then move students into it.</Empty> : (
        <div className="stack">
          <label className="field"><span>Move to</span><select className="input" value={to} onChange={(e) => setTo(e.target.value)}>{others.map((b) => <option key={b.id} value={b.id}>{b.name}{b.course_name ? ` (${b.course_name})` : ""}</option>)}</select></label>
          {students.loading ? <Loading /> : !students.data ? <ErrorState error={students.error} onRetry={() => students.reload()} /> : (
            <div>
              <div className="row between small" style={{ marginBottom: 6 }}>
                <b>{chosen.size} of {all.length} selected</b>
                <span className="row"><button type="button" className="btn-link" onClick={() => setPicked(null)}>All</button><button type="button" className="btn-link" onClick={() => setPicked(new Set())}>None</button></span>
              </div>
              <div className="check-list">
                {all.map((s) => (
                  <label key={s.id}><input type="checkbox" checked={chosen.has(s.id)} onChange={() => toggle(s.id)} /> <span className="grow">{s.name}</span><span className="small muted">{s.roll_no ? `Roll ${s.roll_no}` : ""}</span></label>
                ))}
              </div>
            </div>
          )}
          <p className="small muted" style={{ margin: 0 }}>Past results stay with each student. Their old batch's analytics will no longer include them.</p>
          <ErrorBox error={err} />
          <button className="btn btn-primary" disabled={busy || !to || !chosen.size} onClick={move}>{busy ? "Moving…" : `Move ${chosen.size} student${chosen.size === 1 ? "" : "s"}`}</button>
        </div>
      )}
    </Modal>
  );
}
