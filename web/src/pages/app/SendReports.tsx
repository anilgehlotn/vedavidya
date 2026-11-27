// Send Reports: email each student's report card PDF to the parent and/or the student (via Resend), or share it
// on WhatsApp. Every send is logged, with its status, so nothing is sent twice by accident.
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { ErrorState, Loading, Modal, useApi } from "../../components/ui";
import { useRun, useToast } from "../../components/toast";

interface Send { id: string; channel: "email" | "whatsapp"; recipient: "parent" | "student"; to_address: string; status: "queued" | "sent" | "failed" | "opened"; error: string | null; created_at: string; sent_at: string | null }
interface Row { attempt_id: string; name: string; roll_no: string | null; score: number | null; max_score: number | null; student_email: string | null; parent_email: string | null; phone: string | null; parent_phone: string | null; share_token: string | null; sends: Send[] }
interface Data { configured: boolean; from: string; published: boolean; students: Row[]; counts: { sent: number; queued: number; failed: number; whatsapp: number } }
type Who = "parent" | "student" | "both";

const ago = (iso: string) => {
  const m = (Date.now() - Date.parse(iso.replace(" ", "T") + (/[zZ+]/.test(iso) ? "" : "Z"))) / 60000;
  return m < 1 ? "just now" : m < 60 ? `${Math.round(m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const waNumber = (p: string | null) => { const d = (p ?? "").replace(/\D/g, ""); return d.length === 10 ? `91${d}` : d; };

export function SendReportsModal({ test, onClose }: { test: { id: string; title: string }; onClose: () => void }) {
  const r = useApi<Data>(`/tests/${test.id}/report-sends`);
  const { org } = useAuth();
  const [who, setWho] = useState<Who>("parent");
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useRun();
  const toast = useToast();
  const queued = (r.data?.counts.queued ?? 0) > 0;
  useEffect(() => {
    if (!queued) return;
    const t = setInterval(() => r.reload(true), 2000);
    return () => clearInterval(t);
  }, [queued]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = r.data?.students.filter((s) => s.score != null) ?? [];
  const addr = (s: Row) => (who === "parent" ? [s.parent_email] : who === "student" ? [s.student_email] : [s.parent_email, s.student_email]).filter(Boolean) as string[];
  const reachable = rows.filter((s) => addr(s).length);
  // By default: everyone with an email whose report hasn't gone out yet.
  const chosen = picked ?? new Set(reachable.filter((s) => s.sends.find((x) => x.channel === "email")?.status !== "sent").map((s) => s.attempt_id));
  const toSend = reachable.filter((s) => chosen.has(s.attempt_id));
  const noEmail = rows.length - reachable.length;
  const lastEmail = (s: Row) => s.sends.find((x) => x.channel === "email");
  const summary = useMemo(() => {
    const st = rows.map(lastEmail);
    return { sent: st.filter((x) => x?.status === "sent").length, failed: st.filter((x) => x?.status === "failed").length };
  }, [r.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (resend = false) => {
    setBusy(true);
    const res = await run(() => api<{ queued: number; skipped: { name: string; reason: string }[] }>(`/tests/${test.id}/send-reports`, { body: { to: who, attempt_ids: toSend.map((s) => s.attempt_id), resend } }));
    setBusy(false);
    if (!res) return;
    setPicked(null); // back to "everyone not sent yet"
    if (res.queued) toast.success(`Sending ${res.queued} report${res.queued === 1 ? "" : "s"}. Each one shows as sent below when it goes out.`);
    const already = res.skipped.filter((x) => /already sent/.test(x.reason)).length;
    if (already) toast.info(`${already} already sent today, so skipped. Use "Send again" on a row to resend.`);
    if (!res.queued && !already) toast.info("Nothing to send.");
    r.reload(true);
  };
  const whatsapp = (s: Row) => {
    const phone = s.parent_phone || s.phone;
    void api(`/tests/${test.id}/report-sends/whatsapp`, { body: { attempt_id: s.attempt_id, to: phone ?? "", recipient: s.parent_phone ? "parent" : "student" } }).then(() => r.reload(true)).catch(() => {});
    const msg = `Hello! ${s.name}'s result for "${test.title}"${org?.name ? ` at ${org.name}` : ""}: ${s.score}/${s.max_score}. See the full report here: ${location.origin}/report/${s.share_token}`;
    window.open(`https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
  };

  return (
    <Modal title="Send reports" onClose={onClose} wide>
      {r.loading ? <Loading lines={5} /> : !r.data ? <ErrorState error={r.error} onRetry={() => r.reload()} /> : !r.data.published ? (
        <p className="muted">Publish the results first. Reports are sent for published results only.</p>
      ) : (
        <div className="stack">
          {!r.data.configured && <div className="tip-box small"><b>Email isn't switched on yet.</b> You can still send each report on WhatsApp below. (The Veda Vidya team turns email on for your institute.)</div>}
          {r.data.configured && (
            <>
              <div className="row wrap" style={{ alignItems: "flex-end", gap: 12 }}>
                <label className="field"><span>Send to</span>
                  <select className="input" value={who} onChange={(e) => { setWho(e.target.value as Who); setPicked(null); }} aria-label="Send to">
                    <option value="parent">Parents</option><option value="student">Students</option><option value="both">Parents and students</option>
                  </select></label>
                <div className="small muted grow">Each email has the report card PDF and a link to the online report. Sent from <b>{r.data.from}</b>; replies come to you.</div>
              </div>
              <div className="row wrap" style={{ gap: 6 }}>
                <span className="badge green">{summary.sent} sent</span>
                {summary.failed > 0 && <span className="badge red">{summary.failed} failed</span>}
                {queued && <span className="badge amber"><span className="dot pulse" />{r.data.counts.queued} sending</span>}
                {noEmail > 0 && <span className="badge">{noEmail} without {who === "student" ? "a student" : who === "parent" ? "a parent" : "an"} email</span>}
                {r.data.counts.whatsapp > 0 && <span className="badge">{r.data.counts.whatsapp} WhatsApp</span>}
              </div>
            </>
          )}
          <div className="table-wrap send-table"><table className="t">
            <thead><tr>{r.data.configured && <th style={{ width: 32 }}><input type="checkbox" aria-label="Select all" checked={toSend.length === reachable.length && reachable.length > 0} onChange={(e) => setPicked(new Set(e.target.checked ? reachable.map((x) => x.attempt_id) : []))} /></th>}
              <th>Student</th><th>Email</th><th>Last sent</th><th></th></tr></thead>
            <tbody>{rows.map((s) => {
              const a = addr(s), last = lastEmail(s), wa = s.sends.find((x) => x.channel === "whatsapp");
              return (
                <tr key={s.attempt_id}>
                  {r.data!.configured && <td><input type="checkbox" aria-label={`Send to ${s.name}`} disabled={!a.length} checked={chosen.has(s.attempt_id) && a.length > 0}
                    onChange={() => { const n = new Set(chosen); if (n.has(s.attempt_id)) n.delete(s.attempt_id); else n.add(s.attempt_id); setPicked(n); }} /></td>}
                  <td><b>{s.name}</b><div className="small muted">Roll {s.roll_no ?? "—"} · {s.score}/{s.max_score}</div></td>
                  <td className="small">{a.length ? a.join(", ") : <span className="muted">No {who === "both" ? "" : `${who} `}email</span>}</td>
                  <td className="small">
                    {last ? <span className={`badge ${last.status === "sent" ? "green" : last.status === "failed" ? "red" : "amber"}`} title={last.error ?? undefined}>
                      {last.status === "sent" ? `✓ Sent ${ago(last.sent_at ?? last.created_at)}` : last.status === "failed" ? "Failed" : "Sending…"}</span> : <span className="muted">Not sent</span>}
                    {last?.status === "failed" && last.error && <div className="small" style={{ color: "var(--red)", maxWidth: 260 }}>{last.error}</div>}
                    {wa && <div className="small muted">WhatsApp opened {ago(wa.created_at)}</div>}
                  </td>
                  <td><div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                    {r.data!.configured && last?.status === "sent" && a.length > 0 && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={async () => {
                      setBusy(true);
                      if (await run(() => api(`/tests/${test.id}/send-reports`, { body: { to: who, attempt_ids: [s.attempt_id], resend: true } }), `Sending ${s.name}'s report again.`)) r.reload(true);
                      setBusy(false);
                    }}>Send again</button>}
                    {s.share_token && <button className="btn btn-ghost btn-sm" onClick={() => whatsapp(s)} title={s.parent_phone || s.phone ? `WhatsApp ${s.parent_phone || s.phone}` : "Choose the contact in WhatsApp"}>WhatsApp</button>}
                  </div></td>
                </tr>
              );
            })}</tbody>
          </table></div>
          {r.data.configured && (
            <div className="row between wrap">
              <span className="small muted">{noEmail > 0 ? "Add missing emails on the Students page (Edit), then come back." : "Already-sent reports are skipped unless you choose Send again."}</span>
              <button className="btn btn-primary" disabled={busy || !toSend.length} onClick={() => send()}>{busy ? "Sending…" : `✉ Email ${toSend.length} report${toSend.length === 1 ? "" : "s"}`}</button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
