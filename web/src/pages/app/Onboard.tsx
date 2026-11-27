// Onboard Students: upload a spreadsheet (CSV / Excel) with a checked preview, share an invite link, or add one student.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, fmtDateTime } from "../../lib/api";
import { parseCsv, readXlsx, SAMPLE_CSV, toStudents, type StudentRow } from "../../lib/sheet";
import { Empty, ErrorBox, ErrorState, Loading, Modal, useApi } from "../../components/ui";
import { Icon } from "../../components/icons";
import { useRun, useToast } from "../../components/toast";

export interface Login { name: string; username: string; password: string; roll_no?: string | null }
interface BatchOpt { id: string; name: string }
type Tab = "file" | "invite" | "single";

export function OnboardModal({ batches, defaultBatch, onClose, onCreated }: { batches: BatchOpt[]; defaultBatch?: string; onClose: () => void; onCreated: (logins: Login[], skipped?: { line: number; reason: string }[]) => void }) {
  const [tab, setTab] = useState<Tab>("file");
  const [batch, setBatch] = useState(defaultBatch || batches[0]?.id || "");
  return (
    <Modal title="Onboard students" onClose={onClose} wide>
      {!batches.length ? <Empty title="Create a batch first" icon="batches">Students join a batch. Add one on the Batches page, then come back.</Empty> : (
        <div className="stack">
          <div className="tabs" role="tablist" style={{ marginBottom: 0 }}>
            {([["file", "Upload a file"], ["invite", "Invite link"], ["single", "Add one student"]] as [Tab, string][]).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
          <label className="field"><span>Batch</span>
            <select className="input" value={batch} onChange={(e) => setBatch(e.target.value)} aria-label="Batch">{batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          </label>
          {tab === "file" && <FileTab batch={batch} onCreated={(l, s) => { onCreated(l, s); onClose(); }} />}
          {tab === "invite" && <InviteTab batch={batch} batchName={batches.find((b) => b.id === batch)?.name ?? ""} />}
          {tab === "single" && <SingleTab batch={batch} onCreated={(l) => { onCreated(l); onClose(); }} />}
        </div>
      )}
    </Modal>
  );
}

// ---------------- Upload a file ----------------
interface Checked { line: number; errors: string[] }
function FileTab({ batch, onCreated }: { batch: string; onCreated: (l: Login[], skipped: { line: number; reason: string }[]) => void }) {
  const [rows, setRows] = useState<StudentRow[] | null>(null);
  const [meta, setMeta] = useState<{ file: string; columns: string[]; headerFound: boolean } | null>(null);
  const [checked, setChecked] = useState<Checked[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "read" | "check" | "add">(null);
  const [drag, setDrag] = useState(false);
  const [paste, setPaste] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const load = async (file: File) => {
    setErr(null); setChecked(null); setRows(null);
    if (/\.xls$/i.test(file.name)) return setErr("Old Excel files (.xls) can't be read. In Excel choose File → Save As → Excel Workbook (.xlsx) or CSV, then upload that.");
    if (!/\.(csv|tsv|txt|xlsx)$/i.test(file.name)) return setErr("Upload a .csv or .xlsx file.");
    if (file.size > 5 * 1024 * 1024) return setErr("That file is over 5 MB. A list of students is usually much smaller; check it's the right file.");
    setBusy("read");
    try {
      const table = /\.xlsx$/i.test(file.name) ? await readXlsx(file) : parseCsv(await file.text());
      use(table, file.name);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const use = (table: string[][], name: string) => {
    const r = toStudents(table);
    if (!r.rows.length) return setErr("No students found in that file. The first column should be the student's name.");
    if (r.rows.length > 1000) return setErr(`That file has ${r.rows.length} students. Add at most 1,000 at a time.`);
    setRows(r.rows); setMeta({ file: name, columns: r.columns, headerFound: r.headerFound });
  };
  // Check every row with the server (same rules as adding) whenever the rows or the batch change.
  useEffect(() => {
    if (!rows) return;
    let live = true;
    setBusy("check");
    api<{ rows: Checked[] }>("/students/import", { body: { batch_id: batch, rows, dry_run: true } })
      .then((r) => live && setChecked(r.rows)).catch((e) => live && setErr((e as Error).message)).finally(() => live && setBusy(null));
    return () => { live = false; };
  }, [rows, batch]);
  const valid = checked?.filter((c) => !c.errors.length).length ?? 0;
  const bad = checked ? checked.length - valid : 0;
  const add = async () => {
    setBusy("add"); setErr(null);
    try {
      const r = await api<{ created: Login[]; skipped: { line: number; reason: string }[] }>("/students/import", { body: { batch_id: batch, rows } });
      toast.success(`${r.created.length} student${r.created.length === 1 ? "" : "s"} added.`);
      if (r.skipped.length) toast.error(`${r.skipped.length} row${r.skipped.length === 1 ? " was" : "s were"} not added.`);
      onCreated(r.created, r.skipped);
    } catch (e) { setErr((e as Error).message); setBusy(null); }
  };
  const sample = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([SAMPLE_CSV], { type: "text/csv" })); a.download = "students-sample.csv"; a.click();
  };

  if (!rows) return (
    <div className="stack">
      <div className={`dropzone ${drag ? "over" : ""}`} role="button" tabIndex={0} aria-label="Choose a CSV or Excel file"
        onClick={() => input.current?.click()} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), input.current?.click())}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) void load(f); }}>
        <Icon name="inbox" size={28} />
        <b>{busy === "read" ? "Reading the file…" : "Drop a CSV or Excel file here, or click to choose"}</b>
        <span className="small muted">.csv or .xlsx · up to 1,000 students · first row can be column names</span>
        <input ref={input} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ""; }} />
      </div>
      <div className="row between wrap small">
        <span className="muted">Columns: Name, Roll no, Phone, Email, Parent name, Parent phone, Parent email. Only Name is required.</span>
        <button type="button" className="btn-link" onClick={sample}>⤓ Download a sample file</button>
      </div>
      <details>
        <summary className="small" style={{ cursor: "pointer", fontWeight: 600 }}>Or paste from a spreadsheet</summary>
        <div className="stack" style={{ marginTop: 8 }}>
          <textarea className="input" rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} aria-label="Pasted rows" placeholder={"Name\tRoll no\tPhone\nAarav Sharma\t1\t9876543210"} />
          <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} disabled={!paste.trim()} onClick={() => { setErr(null); use(parseCsv(paste), "pasted rows"); }}>Preview</button>
        </div>
      </details>
      <ErrorBox error={err} />
    </div>
  );

  return (
    <div className="stack">
      <div className="file-card">
        <Icon name="paper" size={20} />
        <span className="grow"><b>{meta?.file}</b><span className="small muted"> · {rows.length} row{rows.length === 1 ? "" : "s"} · columns found: {meta?.columns.join(", ")}</span>
          {!meta?.headerFound && <span className="small muted" style={{ display: "block" }}>No column names found, so the order Name, Roll no, Phone, Email, Parent phone was used.</span>}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => { setRows(null); setChecked(null); setErr(null); }}>Choose another file</button>
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        {busy === "check" || !checked ? <span className="badge"><span className="spinner" style={{ width: 12, height: 12 }} /> Checking rows…</span> : <>
          <span className="badge green">{valid} ready to add</span>
          {bad > 0 && <span className="badge red">{bad} with problems (they will be skipped)</span>}
        </>}
      </div>
      <div className="table-wrap preview-table"><table className="t">
        <thead><tr><th>#</th><th>Name</th><th>Roll</th><th>Phone</th><th>Email</th><th>Parent</th><th>Check</th></tr></thead>
        <tbody>{rows.map((r, i) => {
          const c = checked?.[i];
          return (
            <tr key={i} className={c?.errors.length ? "row-bad" : ""}>
              <td className="small muted">{i + 1}</td><td>{r.name || <span className="muted">—</span>}</td><td>{r.roll_no}</td><td className="small">{r.phone}</td>
              <td className="small">{r.email}</td><td className="small">{[r.parent_name, r.parent_phone].filter(Boolean).join(" · ")}</td>
              <td className="small">{!c ? "…" : c.errors.length ? <span style={{ color: "var(--red)" }}>{c.errors.join("; ")}</span> : <span style={{ color: "var(--green)" }}>✓ OK</span>}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
      <ErrorBox error={err} />
      <button className="btn btn-primary" disabled={!checked || !valid || !!busy} onClick={add}>{busy === "add" ? "Adding…" : `Add ${valid} student${valid === 1 ? "" : "s"} and create logins`}</button>
    </div>
  );
}

// ---------------- Invite link ----------------
interface Invite { id: string; token: string; batch_id: string; batch_name: string; expires_at: string; max_uses: number | null; uses: number; revoked: number }
export const inviteUrl = (token: string) => `${location.origin}/join/${token}`;
function InviteTab({ batch, batchName }: { batch: string; batchName: string }) {
  const invites = useApi<Invite[]>("/invites");
  const [days, setDays] = useState(7);
  const [max, setMax] = useState("");
  const [busy, setBusy] = useState(false);
  const run = useRun();
  const toast = useToast();
  const live = (invites.data ?? []).filter((i) => !i.revoked && Date.parse(i.expires_at) > Date.now() && (i.max_uses == null || i.uses < i.max_uses));
  const create = async () => {
    setBusy(true);
    const r = await run(() => api<{ token: string }>("/invites", { body: { batch_id: batch, days, max_uses: max ? Number(max) : null } }), `Invite link for ${batchName} created.`);
    setBusy(false);
    if (r) { invites.reload(true); void copy(r.token); }
  };
  const copy = async (token: string) => {
    try { await navigator.clipboard.writeText(inviteUrl(token)); toast.success("Link copied. Share it with the students."); }
    catch { toast.info("Select the link and copy it."); }
  };
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>Students open the link, type their name, roll number and phone, and choose a password. They join <b>{batchName}</b> and can sign in straight away.</p>
      <div className="row wrap" style={{ alignItems: "flex-end" }}>
        <label className="field"><span>Link works for</span><select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>{[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} day{d > 1 ? "s" : ""}</option>)}</select></label>
        <label className="field"><span>Most students (optional)</span><input className="input" type="number" min={1} max={2000} value={max} onChange={(e) => setMax(e.target.value)} placeholder="No limit" style={{ width: 140 }} /></label>
        <button className="btn btn-primary" disabled={busy || !batch} onClick={create}>{busy ? "Creating…" : "Create link"}</button>
      </div>
      <div>
        <b className="small">Active links</b>
        {invites.loading ? <Loading lines={2} /> : !invites.data ? <ErrorState error={invites.error} onRetry={() => invites.reload()} /> : !live.length ? <p className="small muted" style={{ margin: "6px 0 0" }}>No active links.</p> : (
          <div className="stack" style={{ gap: 8, marginTop: 8 }}>
            {live.map((i) => (
              <div key={i.id} className="invite-row">
                <div className="grow" style={{ minWidth: 0 }}>
                  <code className="invite-url">{inviteUrl(i.token)}</code>
                  <div className="small muted">{i.batch_name} · {i.uses}{i.max_uses ? ` of ${i.max_uses}` : ""} joined · until {fmtDateTime(i.expires_at)}</div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => copy(i.token)}>Copy</button>
                  <a className="btn btn-ghost btn-sm" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`Join ${i.batch_name} on Veda Vidya: ${inviteUrl(i.token)}`)}`}>WhatsApp</a>
                  <button className="btn btn-danger btn-sm" onClick={async () => { if (await run(() => api(`/invites/${i.id}`, { method: "DELETE" }), "Link switched off. It no longer works.")) invites.reload(true); }}>Switch off</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- Add one student ----------------
function SingleTab({ batch, onCreated }: { batch: string; onCreated: (l: Login[]) => void }) {
  const [f, setF] = useState({ name: "", roll_no: "", phone: "", email: "", parent_name: "", parent_phone: "", parent_email: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const r = await api<Login>("/students", { body: { ...f, batch_id: batch } });
      toast.success(`${f.name} added. Their login is shown on the page.`);
      onCreated([{ ...r, roll_no: f.roll_no || null }]);
    } catch (x) { setErr((x as Error).message); setBusy(false); }
  };
  return (
    <form className="stack" onSubmit={save}>
      <div className="grid g2">
        <label className="field"><span>Full name *</span><input className="input" required autoFocus value={f.name} onChange={set("name")} /></label>
        <label className="field"><span>Roll no</span><input className="input" value={f.roll_no} onChange={set("roll_no")} /></label>
        <label className="field"><span>Phone</span><input className="input" inputMode="tel" value={f.phone} onChange={set("phone")} /></label>
        <label className="field"><span>Email</span><input className="input" type="email" value={f.email} onChange={set("email")} /></label>
        <label className="field"><span>Parent name</span><input className="input" value={f.parent_name} onChange={set("parent_name")} /></label>
        <label className="field"><span>Parent phone</span><input className="input" inputMode="tel" value={f.parent_phone} onChange={set("parent_phone")} /></label>
      </div>
      <ErrorBox error={err} />
      <button className="btn btn-primary" disabled={busy}>{busy ? "Adding…" : "Add & create login"}</button>
    </form>
  );
}
