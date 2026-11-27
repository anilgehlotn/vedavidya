// Platform owner (super-admin) page: every institute's credits, free monthly credits, prices and backups.
import { useState } from "react";
import { api, fmtDate } from "../../lib/api";
import { Empty, ErrorState, Loading, PageTitle, SkeletonTable, useApi } from "../../components/ui";
import { useToast } from "../../components/toast";

interface OrgRow { id: string; name: string; city: string | null; created_at: string; is_demo: number; own_key: boolean; students: number; used_this_month: number; monthly_free_credits: number | null;
  balance: { free: number; paid: number; total: number; monthly_free: number } | null }
type Mode = "mixed" | "sonnet" | "opus";
interface PlatformSettings { prices: Record<string, number>; default_prices: Record<string, number>; monthly_free: number; platform_key: boolean;
  mode_multipliers: Record<Mode, number>; default_mode_multipliers: Record<Mode, number> }
const MODE_LABEL: Record<Mode, string> = { mixed: "Mixed", sonnet: "Sonnet for everything", opus: "Opus for everything" };
interface Backup { file: string; size: number; created_at: string }

const LABEL: Record<string, string> = { paper_import: "Read a question paper", paper_generate: "Generate a paper", mark_sheet: "Mark one answer sheet", practice_set: "Fix-it practice (per student)", reteach_brief: "Re-teach brief", question_assist: "AI help on one question" };
const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-IN");

export default function Platform() {
  const orgs = useApi<OrgRow[]>("/admin/orgs");
  const settings = useApi<PlatformSettings>("/admin/settings");
  const backups = useApi<{ backups: Backup[] }>("/admin/backups");
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); orgs.reload(true); settings.reload(true); backups.reload(true); } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  const addCredits = (o: OrgRow) => {
    const a = prompt(`Credits to add for ${o.name} (use a minus sign to remove):`, "500");
    if (!a || !Number(a)) return;
    const note = prompt("Note (shown to the institute):", "Credits added by Veda Vidya") ?? "";
    if (!note.trim()) return;
    void act(() => api(`/admin/orgs/${o.id}/credits`, { body: { amount: Number(a), note: note.trim() } }), `${Number(a) > 0 ? "Added" : "Removed"} ${Math.abs(Number(a))} credits for ${o.name}.`);
  };
  const setQuota = (o: OrgRow) => {
    const v = prompt(`Free credits per month for ${o.name}. Leave empty to use the platform default (${settings.data?.monthly_free ?? ""}).`, o.monthly_free_credits == null ? "" : String(o.monthly_free_credits));
    if (v === null) return;
    void act(() => api(`/admin/orgs/${o.id}/quota`, { method: "PUT", body: { monthly_free_credits: v.trim() === "" ? null : Number(v) } }), `Monthly free credits updated for ${o.name} (from next month).`);
  };

  return (
    <>
      <PageTitle title="Platform" sub="Institutes, credits and backups (only you can see this)">
        <button className="btn btn-ghost" disabled={busy} onClick={() => act(() => api("/admin/backup", { body: {} }), "Backup saved.")}>Back up now</button>
      </PageTitle>
      {settings.data && !settings.data.platform_key && <div className="error-box" style={{ marginBottom: 14 }}>The platform Claude key isn't set (PLATFORM_CLAUDE_KEY). Until it is, only institutes with their own key can use AI.</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-pad" style={{ paddingBottom: 0 }}><b>Institutes</b></div>
        {orgs.loading ? <div className="card-pad"><SkeletonTable rows={3} cols={5} /></div> : orgs.error && !orgs.data ? <ErrorState error={orgs.error} onRetry={() => orgs.reload()} /> : !orgs.data?.length ? <Empty title="No institutes yet" /> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Institute</th><th>Students</th><th>Credits left</th><th>Used this month</th><th>Free / month</th><th></th></tr></thead>
            <tbody>{orgs.data.map((o) => (
              <tr key={o.id}>
                <td><b>{o.name}</b><div className="small muted">{[o.city, `since ${fmtDate(o.created_at)}`].filter(Boolean).join(" · ")}</div></td>
                <td className="small">{o.students}</td>
                <td className="small">{o.is_demo ? "Demo" : o.own_key ? <span className="badge">Own key</span> : o.balance ? <><b style={{ color: o.balance.total <= 0 ? "var(--red)" : undefined }}>{fmt(o.balance.total)}</b><span className="muted"> ({fmt(o.balance.free)} free + {fmt(o.balance.paid)} added)</span></> : "—"}</td>
                <td className="small">{fmt(o.used_this_month)}</td>
                <td className="small">{o.monthly_free_credits ?? <span className="muted">{settings.data?.monthly_free} (default)</span>}</td>
                <td><div className="row" style={{ justifyContent: "flex-end" }}>{!o.is_demo && <>
                  <button className="btn btn-ghost btn-sm" onClick={() => addCredits(o)}>Add credits</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setQuota(o)}>Free / month</button></>}</div></td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </div>

      <div className="grid g2">
        <div className="card card-pad stack">
          <b>Prices and free credits</b>
          {settings.loading ? <Loading lines={6} /> : !settings.data ? <ErrorState error={settings.error} onRetry={() => settings.reload()} /> : (
            <form className="stack" onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const prices = Object.fromEntries(Object.keys(settings.data!.prices).map((k) => [k, Number(f.get(k))]));
              const mode_multipliers = Object.fromEntries((Object.keys(MODE_LABEL) as Mode[]).map((m) => [m, Number(f.get(`mult_${m}`))]));
              void act(() => api("/admin/settings", { method: "PUT", body: { prices, monthly_free: Number(f.get("monthly_free")), mode_multipliers } }), "Prices saved.");
            }}>
              <label className="field"><span>Default free credits per institute per month</span><input className="input" name="monthly_free" type="number" min={0} defaultValue={settings.data.monthly_free} /></label>
              {Object.entries(settings.data.prices).map(([k, v]) => (
                <label key={k} className="field"><span>{LABEL[k] ?? k} <span className="muted">(default {settings.data!.default_prices[k]})</span></span><input className="input" name={k} type="number" min={0} step={0.5} defaultValue={v} /></label>
              ))}
              <div className="stack" style={{ gap: 8, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
                <b className="small">Marking price × marking quality</b>
                <p className="small muted" style={{ margin: 0 }}>Stronger models cost more to run, so marking a sheet costs the price above times this number.</p>
                <div className="grid g3">
                  {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
                    <label key={m} className="field"><span>{MODE_LABEL[m]} <span className="muted">(default ×{settings.data!.default_mode_multipliers[m]})</span></span>
                      <input className="input" name={`mult_${m}`} type="number" min={0} max={100} step={0.5} defaultValue={settings.data!.mode_multipliers[m]} /></label>
                  ))}
                </div>
              </div>
              <button className="btn btn-primary">Save</button>
            </form>
          )}
        </div>
        <div className="card card-pad stack">
          <b>Backups</b>
          <p className="small muted" style={{ margin: 0 }}>A copy of the database is made every day; the newest 14 are kept.</p>
          {backups.loading ? <Loading /> : backups.error && !backups.data ? <ErrorState error={backups.error} onRetry={() => backups.reload()} /> : !backups.data?.backups.length ? <p className="small muted">No backups yet. The first daily copy is made shortly after the server starts.</p> : (
            <div className="table-wrap"><table className="t"><tbody>
              {backups.data.backups.map((b) => <tr key={b.file}><td className="small">{b.file}</td><td className="small" style={{ textAlign: "right" }}>{Math.round(b.size / 1024)} KB</td></tr>)}
            </tbody></table></div>
          )}
        </div>
      </div>
    </>
  );
}
