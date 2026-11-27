// Centres & batches, students, staff, notices and settings.
import { CreditsPanel, useCredits } from "./Credits";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, csvCell, fmtDate, setToken } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { Empty, ErrorBox, ErrorState, Loading, Modal, PageTitle, SkeletonCards, SkeletonTable, useApi } from "../../components/ui";
import { useRun, useToast } from "../../components/toast";
import { OnboardModal } from "./Onboard";

interface Centre { id: string; name: string; city: string | null; batch_count: number }
interface Batch { id: string; name: string; course: string | null; start_date: string | null; centre_id: string | null; centre_name: string | null; teacher_id: string | null; teacher_name: string | null; student_count: number }
interface Staff { id: string; name: string; email: string; phone: string | null; subject: string | null; role: string }

function useForm<T extends Record<string, string>>(init: T) {
  const [f, setF] = useState(init);
  const set = (k: keyof T) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return { f, set, setF };
}

interface Student { id: string; name: string; email: string | null; phone: string | null; username: string; batch_id: string; batch_name: string; roll_no: string | null; parent_name: string | null; parent_phone: string | null; parent_email: string | null }

export function Students() {
  const { user } = useAuth();
  const isAdmin = user!.role === "admin";
  const [params, setParams] = useSearchParams();
  const batchId = params.get("batch") ?? "";
  const batches = useApi<Batch[]>("/batches");
  const students = useApi<Student[]>(`/students${batchId ? `?batch_id=${batchId}` : ""}`);
  const [q, setQ] = useState("");
  const [modal, setModal] = useState<null | "onboard" | { edit: Student }>(null);
  const [creds, setCreds] = useState<{ name: string; username: string; password: string; roll_no?: string | null }[] | null>(null);
  const [skipped, setSkipped] = useState<{ line: number; reason: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const s = useForm({ name: "", roll_no: "", phone: "", email: "", batch_id: "", parent_name: "", parent_phone: "", parent_email: "" });
  const run = useRun();
  const toast = useToast();

  const open = (st?: Student) => {
    setError(null);
    s.setF({ name: st?.name ?? "", roll_no: st?.roll_no ?? "", phone: st?.phone ?? "", email: st?.email ?? "", batch_id: st?.batch_id ?? batchId ?? batches.data?.[0]?.id ?? "",
      parent_name: st?.parent_name ?? "", parent_phone: st?.parent_phone ?? "", parent_email: st?.parent_email ?? "" });
    if (st) setModal({ edit: st }); else setModal("onboard");
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (typeof modal === "object" && modal) { await api(`/students/${modal.edit.id}`, { method: "PUT", body: s.f }); toast.success(`${s.f.name} saved.`); }
      else { const r = await api<{ name: string; username: string; password: string }>("/students", { body: s.f }); setCreds([r]); toast.success(`${s.f.name} added. Their login is shown below.`); }
      setModal(null); students.reload();
    } catch (err) { setError((err as Error).message); }
  };
  const batchLogins = async () => {
    const b = batches.data?.find((x) => x.id === batchId);
    if (!confirm(`Create new passwords for every student in ${b?.name ?? "this batch"}? Their old passwords will stop working.`)) return;
    const r = await run(() => api<{ created: { name: string; username: string; password: string; roll_no: string | null }[] }>("/students/reset-logins", { body: { batch_id: batchId } }),
      (x) => `New passwords made for ${x.created.length} students.`);
    if (r) setCreds(r.created);
  };
  const reset = async (st: Student) => {
    if (!confirm(`Generate a new password for ${st.name}?`)) return;
    const r = await run(() => api<{ username: string; password: string }>(`/students/${st.id}/reset-password`, { body: {} }), `New password made for ${st.name}.`);
    if (r) setCreds([{ name: st.name, ...r }]);
  };
  const remove = async (st: Student) => {
    if (!confirm(`Remove ${st.name}? Their results will be deleted too.`)) return;
    if (await run(() => api(`/students/${st.id}`, { method: "DELETE" }), `${st.name} was removed.`)) students.reload();
  };
  const list = (students.data ?? []).filter((x) => !q || `${x.name} ${x.username} ${x.phone ?? ""} ${x.roll_no ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const downloadCreds = () => {
    const csv = ["Roll,Name,Username,Password,Login at", ...creds!.map((c) => [c.roll_no, c.name, c.username, c.password, `${location.origin}/login`].map(csvCell).join(","))].join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "student-logins.csv"; a.click();
  };

  return (
    <>
      <PageTitle title="Students" sub={`${students.data?.length ?? 0} students${batchId ? " in this batch" : ""}`}>
        {batchId && isAdmin && <button className="btn btn-ghost" onClick={batchLogins}>Logins for this batch</button>}
        <button className="btn btn-primary" onClick={() => setModal("onboard")}>+ Onboard students</button>
      </PageTitle>
      <div className="row wrap" style={{ marginBottom: 14 }}>
        <input className="input" style={{ maxWidth: 280 }} placeholder="Search name, roll no, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ maxWidth: 240 }} value={batchId} onChange={(e) => setParams(e.target.value ? { batch: e.target.value } : {})}>
          <option value="">All batches</option>{batches.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>
      {skipped.length > 0 && (
        <div className="error-box" style={{ marginBottom: 14 }}>
          <div className="row between"><b>Not added</b><button className="btn-link" onClick={() => setSkipped([])}>Dismiss</button></div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{skipped.map((x) => <li key={x.line}>Line {x.line}: {x.reason}</li>)}</ul>
        </div>
      )}
      {creds && (
        <div className="card card-pad" style={{ marginBottom: 14, borderColor: "#bfe6d1" }}>
          <div className="row between"><b>Login details - share these with students (shown once). Students sign in at {location.host}/login</b><div className="row"><button className="btn btn-ghost btn-sm" onClick={downloadCreds}>Download CSV</button><button className="btn-link" onClick={() => setCreds(null)}>Dismiss</button></div></div>
          <div className="table-wrap" style={{ marginTop: 10 }}><table className="t"><tbody>{creds.map((c) => <tr key={c.username}><td>{c.name}</td><td><code>{c.username}</code></td><td><code>{c.password}</code></td></tr>)}</tbody></table></div>
        </div>
      )}
      <div className="card">
        {students.loading ? <div className="card-pad"><SkeletonTable rows={6} cols={5} /></div>
          : students.error && !students.data ? <ErrorState error={students.error} onRetry={() => students.reload()} />
          : list.length ? (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Roll</th><th>Name</th><th>Batch</th><th>Username</th><th>Parent</th><th></th></tr></thead>
            <tbody>{list.map((st) => (
              <tr key={st.id}>
                <td>{st.roll_no ?? "—"}</td>
                <td><Link to={`/app/students/${st.id}`} className="btn-link" style={{ color: "var(--ink)" }}>{st.name}</Link><div className="small muted">{st.phone}</div></td>
                <td>{st.batch_name}</td><td><code className="small">{st.username}</code></td>
                <td className="small">{st.parent_name ?? "—"}<div className="muted">{st.parent_phone}</div></td>
                <td><div className="row" style={{ justifyContent: "flex-end" }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => open(st)}>Edit</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => reset(st)}>Reset login</button>
                  {isAdmin && <button className="btn btn-danger btn-sm" onClick={() => remove(st)}>Remove</button>}
                </div></td>
              </tr>))}
            </tbody>
          </table></div>
        ) : q ? <Empty title={`No students match "${q}"`} icon="search">Try a different name, roll number or phone.</Empty>
          : <Empty title="No students yet" icon="student" action={<button className="btn btn-primary btn-sm" onClick={() => open()}>+ Student</button>}>Add students one by one or paste a list with “Bulk add”.</Empty>}
      </div>

      {modal === "onboard" && (
        <OnboardModal batches={batches.data ?? []} defaultBatch={batchId} onClose={() => setModal(null)}
          onCreated={(logins, sk) => { if (logins.length) setCreds(logins); setSkipped(sk ?? []); students.reload(); batches.reload(true); }} />
      )}
      {modal && typeof modal === "object" && (
        <Modal title="Edit student" onClose={() => setModal(null)}>
          <form className="stack" onSubmit={save}>
            <div className="grid g2">
              <label className="field"><span>Full name *</span><input className="input" required value={s.f.name} onChange={s.set("name")} /></label>
              <label className="field"><span>Batch *</span><select className="input" required value={s.f.batch_id} onChange={s.set("batch_id")}><option value="">Select…</option>{batches.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
              <label className="field"><span>Roll no</span><input className="input" value={s.f.roll_no} onChange={s.set("roll_no")} /></label>
              <label className="field"><span>Phone</span><input className="input" value={s.f.phone} onChange={s.set("phone")} /></label>
              <label className="field"><span>Email</span><input className="input" type="email" value={s.f.email} onChange={s.set("email")} /></label>
              <label className="field"><span>Parent name</span><input className="input" value={s.f.parent_name} onChange={s.set("parent_name")} /></label>
              <label className="field"><span>Parent phone</span><input className="input" value={s.f.parent_phone} onChange={s.set("parent_phone")} /></label>
              <label className="field"><span>Parent email</span><input className="input" value={s.f.parent_email} onChange={s.set("parent_email")} /></label>
            </div>
            <ErrorBox error={error} /><button className="btn btn-primary">Save</button>
          </form>
        </Modal>
      )}
    </>
  );
}

export function StaffPage() {
  const staff = useApi<Staff[]>("/teachers");
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [creds, setCreds] = useState<{ email: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = useForm({ name: "", email: "", phone: "", subject: "", role: "teacher" });
  const run = useRun();
  const toast = useToast();
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try { setCreds(await api("/teachers", { body: t.f })); toast.success(`${t.f.name} added. Their login is shown above the list.`); setOpen(false); staff.reload(); } catch (err) { setError((err as Error).message); }
  };
  return (
    <>
      <PageTitle title="Staff" sub="Admins and teachers who can manage tests and papers">
        {user!.role === "admin" && <button className="btn btn-primary" onClick={() => { setError(null); t.setF({ name: "", email: "", phone: "", subject: "", role: "teacher" }); setOpen(true); }}>+ Add staff</button>}
      </PageTitle>
      {creds && <div className="ok-box" style={{ marginBottom: 14 }}>Login: <b>{creds.email}</b> · temporary password: <b>{creds.password}</b> (share it privately; they can change it in Settings) <button className="btn-link" onClick={() => setCreds(null)}>Dismiss</button></div>}
      <div className="card">
        {staff.loading ? <div className="card-pad"><SkeletonTable rows={3} cols={4} /></div>
          : !staff.data ? <ErrorState error={staff.error} onRetry={() => staff.reload()} /> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Name</th><th>Role</th><th>Subject</th><th>Email</th><th></th></tr></thead>
            <tbody>{staff.data?.map((s) => (
              <tr key={s.id}><td><b>{s.name}</b></td><td><span className={`badge ${s.role === "admin" ? "violet" : ""}`} style={{ textTransform: "capitalize" }}>{s.role}</span></td><td>{s.subject ?? "—"}</td><td>{s.email}</td>
                <td style={{ textAlign: "right" }}>{user!.role === "admin" && s.id !== user!.id && <div className="row" style={{ justifyContent: "flex-end" }}>
                  <button className="btn btn-ghost btn-sm" onClick={async () => { if (confirm(`Create a new password for ${s.name}? They will be signed out.`)) { const r = await run(() => api<{ email: string; password: string }>(`/teachers/${s.id}/reset-password`, { body: {} }), `New password made for ${s.name}.`); if (r) setCreds(r); } }}>Reset password</button>
                  <button className="btn btn-danger btn-sm" onClick={async () => { if (confirm(`Remove ${s.name}?`)) { if (await run(() => api(`/teachers/${s.id}`, { method: "DELETE" }), `${s.name} was removed.`)) staff.reload(); } }}>Remove</button>
                </div>}</td></tr>))}
            </tbody>
          </table></div>
        )}
      </div>
      {open && (
        <Modal title="Add staff member" onClose={() => setOpen(false)}>
          <form className="stack" onSubmit={save}>
            <div className="grid g2">
              <label className="field"><span>Name</span><input className="input" required value={t.f.name} onChange={t.set("name")} /></label>
              <label className="field"><span>Email</span><input className="input" type="email" required value={t.f.email} onChange={t.set("email")} /></label>
              <label className="field"><span>Subject</span><input className="input" value={t.f.subject} onChange={t.set("subject")} /></label>
              <label className="field"><span>Role</span><select className="input" value={t.f.role} onChange={t.set("role")}><option value="teacher">Teacher</option><option value="admin">Admin</option></select></label>
            </div>
            <ErrorBox error={error} /><button className="btn btn-primary">Create account</button>
          </form>
        </Modal>
      )}
    </>
  );
}

interface Notice { id: string; title: string; body: string; batch_name: string | null; created_at: string }
export function Notices() {
  const notices = useApi<Notice[]>("/notices");
  const { user } = useAuth();
  const isStaff = user!.role !== "student";
  const batches = useApi<Batch[]>(isStaff ? "/batches" : null);
  const n = useForm({ title: "", body: "", batch_id: "" });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useRun();
  const toast = useToast();
  const post = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try { await api("/notices", { body: n.f }); toast.success("Notice posted."); setOpen(false); n.setF({ title: "", body: "", batch_id: "" }); notices.reload(); }
    catch (err) { setError((err as Error).message); }
  };
  return (
    <>
      <PageTitle title="Notice board" sub="Announcements for students and staff">{isStaff && <button className="btn btn-primary" onClick={() => setOpen(true)}>+ Post notice</button>}</PageTitle>
      {notices.loading ? <SkeletonCards count={2} height={90} />
        : notices.error && !notices.data ? <div className="card"><ErrorState error={notices.error} onRetry={() => notices.reload()} /></div>
        : notices.data?.length ? (
        <div className="stack">{notices.data.map((x) => (
          <div key={x.id} className="card card-pad">
            <div className="row between"><b style={{ fontSize: 17 }}>{x.title}</b>
              <div className="row"><span className="badge">{x.batch_name ?? "Everyone"}</span><span className="small muted">{fmtDate(x.created_at)}</span>
                {isStaff && <button className="btn-link small" style={{ color: "var(--red)" }} onClick={async () => { if (!confirm(`Delete the notice "${x.title}"?`)) return; if (await run(() => api(`/notices/${x.id}`, { method: "DELETE" }), "Notice deleted.")) notices.reload(); }}>Delete</button>}</div>
            </div>
            <p style={{ marginTop: 8, color: "var(--ink-2)", whiteSpace: "pre-wrap" }}>{x.body}</p>
          </div>))}
        </div>
      ) : <div className="card"><Empty title="No notices yet" icon="notices" action={isStaff ? <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>+ Post notice</button> : undefined}>
          {isStaff ? "Post announcements for everyone or for one batch." : "Announcements from your institute will appear here."}</Empty></div>}
      {open && (
        <Modal title="Post a notice" onClose={() => setOpen(false)}>
          <form className="stack" onSubmit={post}>
            <label className="field"><span>Title</span><input className="input" required value={n.f.title} onChange={n.set("title")} /></label>
            <label className="field"><span>Audience</span><select className="input" value={n.f.batch_id} onChange={n.set("batch_id")}><option value="">Everyone</option>{batches.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
            <label className="field"><span>Message</span><textarea className="input" rows={5} required value={n.f.body} onChange={n.set("body")} /></label>
            <ErrorBox error={error} /><button className="btn btn-primary">Post</button>
          </form>
        </Modal>
      )}
    </>
  );
}

export function Settings() {
  const { user, org, refresh } = useAuth();
  const o = useForm({ name: org?.name ?? "", city: org?.city ?? "" });
  const p = useForm({ current: "", next: "" });
  const toast = useToast();
  return (
    <>
      <PageTitle title="Settings" />
      <div className="grid g2">
        {user!.role === "admin" && (
          <form className="card card-pad stack" onSubmit={async (e) => { e.preventDefault(); try { await api("/organisation", { method: "PUT", body: o.f }); await refresh(); toast.success("Institute details saved."); } catch (err) { toast.error((err as Error).message); } }}>
            <b>Institute</b>
            <label className="field"><span>Name</span><input className="input" value={o.f.name} onChange={o.set("name")} /></label>
            <label className="field"><span>City</span><input className="input" value={o.f.city} onChange={o.set("city")} /></label>
            <button className="btn btn-primary" style={{ alignSelf: "flex-start" }}>Save</button>
          </form>
        )}
        <form className="card card-pad stack" onSubmit={async (e) => { e.preventDefault(); try { const r = await api<{ token: string }>("/auth/change-password", { body: p.f }); setToken(r.token); p.setF({ current: "", next: "" }); toast.success("Password changed. Other devices have been signed out."); } catch (err) { toast.error((err as Error).message); } }}>
          <b>Change password</b>
          <label className="field"><span>Current password</span><input className="input" type="password" required value={p.f.current} onChange={p.set("current")} /></label>
          <label className="field"><span>New password (8+ characters)</span><input className="input" type="password" minLength={8} required value={p.f.next} onChange={p.set("next")} /></label>
          <button className="btn btn-primary" style={{ alignSelf: "flex-start" }}>Update password</button>
        </form>
        {user!.role !== "student" && <AiEngineCard isAdmin={user!.role === "admin"} />}
      </div>
    </>
  );
}

type AiMode = "mixed" | "sonnet" | "opus";
interface AiStatus { demo: boolean; configured: boolean; own_key: boolean; platform_available: boolean; hint: string | null; mode: AiMode; models: Record<string, string | null> }
interface AiUsage { month: string; total_usd: number; sheets_marked: number; usd_per_sheet: number | null; items: { task: string; label: string; model: string; calls: number; usd: number }[] }
const INR = 85; // approximate rupees per US dollar, for the estimate only
const inr = (usd: number) => `₹${(usd * INR).toLocaleString("en-IN", { maximumFractionDigits: usd * INR < 10 ? 2 : 0 })}`;
const MODEL_NAME = (id: string | null) => (!id ? "off" : /haiku/.test(id) ? "Haiku" : /sonnet/.test(id) ? "Sonnet" : /opus/.test(id) ? "Opus" : id);
const MODES: { id: AiMode; title: string; desc: string; cost: string }[] = [
  { id: "mixed", title: "Mixed (recommended)", desc: "Opus reads papers and writes answer keys, Haiku marks every sheet, Sonnet re-checks doubtful answers.", cost: "≈ ₹0.5–1 per sheet" },
  { id: "sonnet", title: "Sonnet for everything", desc: "Stronger marking on every answer. No second check.", cost: "≈ ₹5 per sheet" },
  { id: "opus", title: "Opus for everything", desc: "Most capable model everywhere. For board pre-tests and important exams.", cost: "≈ ₹11 per sheet" },
];

/** Which models the institute uses, and this month's estimated AI bill. */
function AiModeCard({ isAdmin, status, onChange }: { isAdmin: boolean; status: AiStatus; onChange: (s: AiStatus) => void }) {
  const usage = useApi<AiUsage>("/settings/ai/usage");
  const onCredits = !status.own_key && status.platform_available && !status.demo;
  const credits = useCredits();
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const pick = async (mode: AiMode) => {
    setErr(null);
    try { onChange(await api<AiStatus>("/settings/ai/mode", { method: "PUT", body: { mode } })); toast.success(`Marking quality: ${MODES.find((m) => m.id === mode)!.title.replace(" (recommended)", "")}.`); }
    catch (e) { setErr((e as Error).message); }
  };
  const u = usage.data;
  return (
    <div className="stack" style={{ borderTop: "1px solid var(--line)", paddingTop: 14, marginTop: 4 }}>
      <b>Marking quality and cost</b>
      <div className="stack" style={{ gap: 8 }}>
        {MODES.map((m) => (
          <label key={m.id} className={`mode-opt ${status.mode === m.id ? "on" : ""}`}>
            <input type="radio" name="ai-mode" checked={status.mode === m.id} disabled={!isAdmin || status.demo} onChange={() => pick(m.id)} />
            <span className="grow"><b>{m.title}</b><span className="small muted" style={{ display: "block" }}>{m.desc}</span></span>
            <span className="small" style={{ whiteSpace: "nowrap" }}>{onCredits
              ? (credits.data ? `${credits.data.mark_by_mode[m.id]} credit${credits.data.mark_by_mode[m.id] === 1 ? "" : "s"} per sheet` : "")
              : m.cost}</span>
          </label>
        ))}
      </div>
      <div className="small muted">Now: papers → {MODEL_NAME(status.models.paper)} · marking → {MODEL_NAME(status.models.marking)} · second check → {MODEL_NAME(status.models.recheck)}{!isAdmin && " · Only an admin can change this."}</div>
      <ErrorBox error={err} />
      <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
        <div className="row between"><b>This month's AI cost</b>{u && <span className="small muted">{new Date(u.month + "-01").toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</span>}</div>
        {usage.loading ? <Loading lines={2} /> : !u ? <ErrorState error={usage.error} onRetry={() => usage.reload()} /> : !u.items.length ? <p className="small muted">No AI used yet this month.</p> : (
          <>
            <div className="row wrap" style={{ gap: 24, margin: "10px 0" }}>
              <div><div className="small muted">Estimated total</div><b style={{ fontSize: 22 }}>{inr(u.total_usd)}</b> <span className="small muted">(${u.total_usd.toFixed(2)})</span></div>
              <div><div className="small muted">Sheets marked</div><b style={{ fontSize: 22 }}>{u.sheets_marked}</b></div>
              {u.usd_per_sheet != null && <div><div className="small muted">Per sheet (incl. second checks)</div><b style={{ fontSize: 22 }}>{inr(u.usd_per_sheet)}</b></div>}
            </div>
            <div className="table-wrap"><table className="t">
              <thead><tr><th>Job</th><th>Model</th><th>Requests</th><th>Cost</th></tr></thead>
              <tbody>{u.items.map((i) => <tr key={i.task + i.model}><td className="small">{i.label}</td><td className="small">{MODEL_NAME(i.model)}</td><td className="small">{i.calls}</td><td className="small">{inr(i.usd)}</td></tr>)}</tbody>
            </table></div>
          </>
        )}
        <p className="small muted" style={{ marginTop: 8 }}>An estimate from token counts at list prices (≈ ₹{INR} per $). Your exact bill is in the Anthropic Console.</p>
      </div>
    </div>
  );
}
function AiEngineCard({ isAdmin }: { isAdmin: boolean }) {
  const st = useApi<AiStatus>("/settings/ai");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<null | "save" | "test" | "remove">(null);
  const [msg, setMsg] = useState<{ err?: string }>({});
  const toast = useToast();
  const { refresh } = useAuth();
  const act = async (kind: "save" | "test" | "remove") => {
    setBusy(kind); setMsg({});
    try {
      if (kind === "save") { const r = await api<AiStatus & { model_name: string }>("/settings/ai", { method: "PUT", body: { key } }); st.setData(r); setKey(""); void refresh(); toast.success(`Connected to ${r.model_name}. AI marking and paper generation are ready.`); }
      if (kind === "test") { const r = await api<{ model_name: string }>("/settings/ai/test", { body: {} }); toast.success(`Working. Connected to ${r.model_name}.`); }
      if (kind === "remove") { st.setData(await api<AiStatus>("/settings/ai", { method: "DELETE" })); void refresh(); toast.success("API key removed."); }
    } catch (e) { setMsg({ err: (e as Error).message }); }
    finally { setBusy(null); }
  };
  const s = st.data;
  const keyForm = s && isAdmin && (
    <>
      <p className="small muted" style={{ margin: 0 }}>Paste a key from console.anthropic.com → API Keys. It is checked (it needs access to Claude Opus, Sonnet and Haiku), then stored encrypted and never shown again. With your own key, AI usage is billed to your Anthropic account and no credits are used.</p>
      <form className="row wrap" onSubmit={(e) => { e.preventDefault(); act("save"); }}>
        <input className="input grow" type="password" autoComplete="off" spellCheck={false} aria-label="Claude API key" placeholder={s.own_key ? "Paste a new key to replace the current one" : "sk-ant-..."} value={key} onChange={(e) => setKey(e.target.value)} style={{ minWidth: 220 }} />
        <button className="btn btn-primary" disabled={!key.trim() || !!busy}>{busy === "save" ? "Checking…" : "Save key"}</button>
      </form>
      {s.own_key && (
        <div className="row">
          <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => act("test")}>{busy === "test" ? "Testing…" : "Test connection"}</button>
          <button className="btn btn-danger btn-sm" disabled={!!busy} onClick={() => act("remove")}>{s.platform_available ? "Remove key (use credits instead)" : "Remove key"}</button>
        </div>
      )}
    </>
  );
  return (
    <div className="card card-pad stack">
      <div className="row between"><b>AI engine</b>
        {s && (s.demo ? <span className="badge">Off in the demo</span> : s.own_key ? <span className="badge green">● Your own Claude key {s.hint}</span>
          : s.platform_available ? <span className="badge green">● Veda Vidya AI · credits</span> : <span className="badge red">● Not set up</span>)}</div>
      {st.loading ? <Loading /> : !s ? <ErrorState error={st.error} onRetry={() => st.reload()} /> : s.demo ? (
        <p className="small muted">AI is switched off in the public demo institute. Create your own institute (Log in → Create an institute) to use it.</p>
      ) : (
        <>
          {!s.own_key && s.platform_available && <CreditsPanel key={s.mode} />}
          {!s.own_key && !s.platform_available && <p className="small muted" style={{ margin: 0 }}>{isAdmin ? "AI isn't switched on for your institute yet. Add your own Claude key below." : "Ask your institute admin to set up AI here."}</p>}
          {s.own_key && <p className="small muted" style={{ margin: 0 }}>{isAdmin ? "Your institute uses its own Claude key: no credits are used." : "AI marking is ready."}</p>}
          {isAdmin && (s.own_key || !s.platform_available ? keyForm : (
            <details><summary className="small" style={{ cursor: "pointer", fontWeight: 600 }}>Use your own Claude key instead (optional)</summary><div className="stack" style={{ marginTop: 10 }}>{keyForm}</div></details>
          ))}
        </>
      )}
      {msg.err && <div className="error-box" role="alert">{msg.err}</div>}
      {s && !s.demo && <AiModeCard isAdmin={isAdmin} status={s} onChange={(n) => st.setData(n)} />}
    </div>
  );
}
