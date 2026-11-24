import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { AttemptStatus } from "../lib/types";

export function Logo({ light, to = "/" }: { light?: boolean; to?: string }) {
  return (
    <Link to={to} className="logo" style={light ? { color: "#fff" } : undefined}>
      <svg className="logo-mark" viewBox="0 0 64 64" aria-hidden>
        <rect width="64" height="64" rx="16" fill="#5B34F2" />
        <path d="M17 21l15 24 15-24" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Veda Vidya
    </Link>
  );
}

// Fetch helper hook: returns data, error, loading and a reload function.
export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = async (quiet = false) => {
    if (!path) return;
    if (!quiet) setLoading(true);
    try { setData(await api<T>(path)); setError(null); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [path, ...deps]);
  return { data, error, loading, reload: load, setData };
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { width: "min(820px, 100%)" } : undefined} role="dialog" aria-label={title}>
        <div className="row between" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button className="btn-link" onClick={onClose} aria-label="Close" style={{ color: "var(--muted)", fontSize: 22 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const Loading = ({ label = "Loading…" }: { label?: string }) => (
  <div className="empty"><span className="spinner" /> <span style={{ marginLeft: 8 }}>{label}</span></div>
);
export const ErrorBox = ({ error }: { error: string | null }) => (error ? <div className="error-box">{error}</div> : null);
export const Empty = ({ title, children }: { title: string; children?: ReactNode }) => <div className="empty"><b>{title}</b>{children}</div>;

export function PageTitle({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-title">
      <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      {children && <div className="row wrap">{children}</div>}
    </div>
  );
}

const STATUS: Record<AttemptStatus, [string, string]> = {
  pending: ["Awaiting sheet", ""], in_progress: ["In progress", "blue"], uploaded: ["Uploaded", "violet"],
  evaluating: ["Evaluating", "amber"], evaluated: ["Evaluated", "green"], failed: ["Failed", "red"],
};
export function StatusBadge({ status }: { status: AttemptStatus }) {
  const [label, tone] = STATUS[status];
  return <span className={`badge ${tone}`}>{status === "evaluating" && <span className="dot pulse" />}{label}</span>;
}

export function ScoreBadge({ value }: { value: number | null }) {
  if (value == null) return <span className="muted">—</span>;
  const tone = value >= 75 ? "green" : value >= 50 ? "amber" : "red";
  return <span className={`badge ${tone}`}>{value}%</span>;
}

// ---- Lightweight SVG charts ----
export function LineChart({ series, labels, height = 180, max = 100 }: {
  series: { name: string; color: string; values: (number | null)[]; dashed?: boolean }[]; labels: string[]; height?: number; max?: number;
}) {
  const W = 600, H = height, P = 28;
  const n = Math.max(labels.length, 2);
  const x = (i: number) => P + (i * (W - P * 2)) / (n - 1);
  const y = (v: number) => H - P - (v / max) * (H - P * 2);
  if (!labels.length) return <Empty title="No data yet" />;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Trend chart">
      {[0, 25, 50, 75, 100].map((g) => (
        <g key={g}><line x1={P} x2={W - P} y1={y(g)} y2={y(g)} stroke="#ece7df" /><text x={4} y={y(g) + 4} fontSize="10" fill="#9a96a5">{g}</text></g>
      ))}
      {series.map((s) => {
        const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v)] as const)).filter(Boolean) as (readonly [number, number])[];
        return (
          <g key={s.name}>
            <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={s.color} strokeWidth="2.5" strokeDasharray={s.dashed ? "5 5" : undefined} strokeLinejoin="round" />
            {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="3.5" fill="#fff" stroke={s.color} strokeWidth="2" />)}
          </g>
        );
      })}
      {labels.map((l, i) => (
        <text key={i} x={x(i)} y={H - 6} fontSize="10" fill="#9a96a5" textAnchor={labels.length > 1 && i === 0 ? "start" : i === labels.length - 1 && labels.length > 1 ? "end" : "middle"}>
          {labels.length > 6 ? `${i + 1}` : l.length > 18 ? l.slice(0, 17) + "…" : l}
        </text>))}
    </svg>
  );
}

export function BarList({ items }: { items: { label: string; value: number; sub?: string }[] }) {
  if (!items.length) return <Empty title="No data yet" />;
  return (
    <div className="stack" style={{ gap: 12 }}>
      {items.map((it) => (
        <div key={it.label}>
          <div className="row between small" style={{ marginBottom: 4 }}>
            <span style={{ fontWeight: 600 }}>{it.label}</span>
            <span className="muted">{it.sub ?? `${it.value}%`}</span>
          </div>
          <div className="bar"><i style={{ width: `${Math.max(2, it.value)}%`, background: it.value >= 75 ? "var(--green)" : it.value >= 50 ? "var(--amber)" : "var(--red)" }} /></div>
        </div>
      ))}
    </div>
  );
}

export function Columns({ items, height = 160 }: { items: { label: string; value: number }[]; height?: number }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height }}>
      {items.map((it) => (
        <div key={it.label} style={{ flex: 1, textAlign: "center" }}>
          <div className="small" style={{ fontWeight: 700 }}>{it.value}</div>
          <div style={{ height: (it.value / max) * (height - 44), background: "var(--accent-2)", borderRadius: 8, minHeight: 4 }} />
          <div className="small muted" style={{ marginTop: 6 }}>{it.label}</div>
        </div>
      ))}
    </div>
  );
}
