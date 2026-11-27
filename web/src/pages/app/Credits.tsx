// The institute's AI credits: balance (monthly free + granted), what each action costs, and the history.
import { ErrorBox, Loading, useApi } from "../../components/ui";
import { fmtDateTime } from "../../lib/api";

export interface CreditInfo {
  balance: { free: number; paid: number; total: number; monthly_free: number; resets_on: string; own_key: boolean };
  prices: Record<string, number>; labels: Record<string, string>;
  /** Credits to mark one sheet (up to 8 pages) in each marking-quality mode. */
  mark_by_mode: Record<"mixed" | "sonnet" | "opus", number>;
  history: { id: number; kind: string; bucket: string; amount: number; action: string | null; note: string | null; created_at: string }[];
}

const KIND: Record<string, string> = { monthly_free: "Monthly free credits", grant: "Credits added", charge: "Used", refund: "Refund", expire: "Expired (unused free credits)", adjust: "Adjustment" };
const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-IN");

export function useCredits() { return useApi<CreditInfo>("/credits"); }

/** Small balance line, e.g. for upload windows: "Credits: 240 · this uses about 15". The cost comes from the server's prices. */
export function CreditLine({ action, units = 1 }: { action?: string; units?: number }) {
  const c = useCredits();
  if (!c.data) return null;
  const cost = action && c.data.prices[action] != null ? Math.round(c.data.prices[action] * units * 100) / 100 : undefined;
  if (c.data.balance.own_key) return <span className="small muted">Using your own Claude key: no credits needed</span>;
  const short = cost != null && c.data.balance.total < cost;
  return <span className="small" style={{ color: short ? "var(--red)" : "var(--ink-2)" }}>Credits: <b>{fmt(c.data.balance.total)}</b>{cost != null && ` · this uses about ${cost}`}{short && " (not enough)"}</span>;
}

export function CreditsPanel() {
  const c = useCredits();
  if (c.loading) return <Loading />;
  if (!c.data) return <ErrorBox error={c.error} />;
  const { balance: b, prices, labels, history } = c.data;
  if (b.own_key) return <p className="small muted" style={{ margin: 0 }}>Your institute uses its own Claude key, so AI usage is billed to your Anthropic account and no credits are used.</p>;
  const resets = new Date(b.resets_on + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "long" });
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row wrap" style={{ gap: 24 }}>
        <div><div className="small muted">Credits available</div><b style={{ fontSize: 28, color: b.total <= 0 ? "var(--red)" : undefined }}>{fmt(b.total)}</b></div>
        <div><div className="small muted">Free this month</div><b style={{ fontSize: 20 }}>{fmt(b.free)}</b><span className="small muted"> of {fmt(b.monthly_free)}</span></div>
        <div><div className="small muted">Added by Veda Vidya</div><b style={{ fontSize: 20 }}>{fmt(b.paid)}</b></div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Free credits are used first and are topped up to {fmt(b.monthly_free)} on {resets} (unused ones don't carry over). Credits added by the Veda Vidya team never expire. Failed actions are refunded automatically.</p>
      {b.total <= 0 && <div className="error-box">No credits left: AI marking and paper reading are paused until {resets}. Ask the Veda Vidya team to add credits, or add your own Claude key below.</div>}
      <details>
        <summary className="small" style={{ cursor: "pointer", fontWeight: 600 }}>What things cost</summary>
        <div className="table-wrap" style={{ marginTop: 8 }}><table className="t">
          <tbody>{Object.entries(prices).map(([k, v]) => <tr key={k}><td className="small">{labels[k] ?? k}</td><td className="small" style={{ textAlign: "right" }}>{fmt(v)} credit{v === 1 ? "" : "s"}{k === "mark_sheet" ? " per sheet of up to 8 pages (longer sheets cost more; depends on Marking quality below)" : ""}</td></tr>)}</tbody>
        </table></div>
      </details>
      <div>
        <b className="small">Recent activity</b>
        {!history.length ? <p className="small muted" style={{ margin: "6px 0 0" }}>Nothing yet.</p> : (
          <div className="table-wrap" style={{ marginTop: 6 }}><table className="t">
            <thead><tr><th>When</th><th>What</th><th style={{ textAlign: "right" }}>Credits</th></tr></thead>
            <tbody>{history.slice(0, 20).map((h) => (
              <tr key={h.id}>
                <td className="small">{fmtDateTime(h.created_at.replace(" ", "T") + "Z")}</td>
                <td className="small">{h.kind === "charge" ? (h.note ?? labels[h.action ?? ""] ?? "Used") : KIND[h.kind] ?? h.kind}{h.kind === "refund" && h.note ? ` · ${h.note.replace(/^Refund: /, "")}` : ""}{(h.kind === "grant" || h.kind === "adjust") && h.note ? ` · ${h.note}` : ""}</td>
                <td className="small" style={{ textAlign: "right", fontWeight: 700, color: h.amount < 0 ? "var(--ink)" : "var(--green)" }}>{h.amount > 0 ? "+" : ""}{fmt(h.amount)}</td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
