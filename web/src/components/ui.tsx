import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../lib/api";
import type { AttemptStatus } from "../lib/types";
import { Icon, type IconName } from "./icons";

export function Logo({ light, to = "/" }: { light?: boolean; to?: string }) {
  return (
    <Link to={to} className="logo" style={light ? { color: "#fff" } : undefined}>
      <svg className="logo-mark" viewBox="0 0 64 64" aria-hidden>
        <circle cx="32" cy="32" r="32" fill="#FF6A4C" />
        <path d="M18 33 L28 43 L46 22" fill="none" stroke="#FFFFFF" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
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

// ---- Loading skeletons: grey placeholder shapes in the layout of what's coming ----
export const Skeleton = ({ w = "100%", h = 14, r = 6, style }: { w?: number | string; h?: number; r?: number; style?: CSSProperties }) =>
  <span className="sk" style={{ width: w, height: h, borderRadius: r, ...style }} aria-hidden />;

/** Generic loading placeholder (a few lines of text). Screen readers hear `label`. */
export const Loading = ({ label = "Loading…", lines = 3 }: { label?: string; lines?: number }) => (
  <div className="sk-block" role="status" aria-live="polite">
    <span className="sr-only">{label}</span>
    {Array.from({ length: lines }, (_, i) => <Skeleton key={i} w={i === lines - 1 ? "55%" : i % 2 ? "85%" : "100%"} />)}
  </div>
);
export const SkeletonTable = ({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) => (
  <div className="sk-table" role="status" aria-live="polite"><span className="sr-only">Loading…</span>
    {Array.from({ length: rows }, (_, r) => (
      <div key={r} className="sk-row">{Array.from({ length: cols }, (_, c) => <Skeleton key={c} w={c === 0 ? "70%" : "50%"} />)}</div>
    ))}
  </div>
);
export const SkeletonCards = ({ count = 3, height = 120 }: { count?: number; height?: number }) => (
  <div className="grid g3" role="status" aria-live="polite"><span className="sr-only">Loading…</span>
    {Array.from({ length: count }, (_, i) => (
      <div key={i} className="card card-pad stack" style={{ gap: 10, minHeight: height }}><Skeleton w="60%" h={16} /><Skeleton w="90%" /><Skeleton w="40%" /></div>
    ))}
  </div>
);
export const SkeletonStats = ({ count = 4 }: { count?: number }) => (
  <div className="grid g4" role="status" aria-live="polite"><span className="sr-only">Loading…</span>
    {Array.from({ length: count }, (_, i) => <div key={i} className="card stat stack" style={{ gap: 10 }}><Skeleton w="50%" /><Skeleton w="35%" h={28} /></div>)}
  </div>
);
/** Whole-page placeholder: header, stat row and a list. */
export const PageSkeleton = () => (
  <div className="stack" style={{ gap: 20 }}>
    <div className="stack" style={{ gap: 10 }}><Skeleton w={160} h={12} /><Skeleton w={280} h={30} /></div>
    <SkeletonStats />
    <div className="card card-pad"><SkeletonTable /></div>
  </div>
);

export const ErrorBox = ({ error }: { error: string | null }) => (error ? <div className="error-box" role="alert">{error}</div> : null);

/** A section or page that couldn't load: what went wrong and a Try again button. */
export function ErrorState({ error, onRetry, title = "This couldn't be loaded" }: { error: string | null; onRetry?: () => void; title?: string }) {
  return (
    <div className="state" role="alert">
      <span className="state-ic red"><Icon name="alert" size={22} /></span>
      <b>{title}</b>
      <p>{error || "Something went wrong. Please try again."}</p>
      {onRetry && <button className="btn btn-ghost btn-sm" onClick={onRetry}><Icon name="refresh" size={15} /> Try again</button>}
    </div>
  );
}

/** Nothing here yet: what this place is for and (optionally) the first thing to do. */
export const Empty = ({ title, children, icon = "inbox", action }: { title: string; children?: ReactNode; icon?: IconName; action?: ReactNode }) => (
  <div className="state">
    <span className="state-ic"><Icon name={icon} size={22} /></span>
    <b>{title}</b>
    {children && <p>{children}</p>}
    {action}
  </div>
);

// ---- Page header: breadcrumbs, large title, actions on the right ----
export interface Crumb { label: string; to?: string }
/** Where each part of the app lives in the menu, for breadcrumbs worked out from the address. */
const SECTIONS: Record<string, { group?: string; label: string; to: string }> = {
  tests: { group: "Assessments", label: "Tests", to: "/app/tests" },
  attempts: { group: "Assessments", label: "Tests", to: "/app/tests" },
  papers: { group: "Assessments", label: "Question Papers", to: "/app/papers" },
  practice: { group: "Assessments", label: "Practice Questions", to: "/app/practice" },
  students: { group: "People", label: "Students", to: "/app/students" },
  teachers: { group: "People", label: "Staff", to: "/app/teachers" },
  batches: { group: "Institute", label: "Batches", to: "/app/batches" },
  notices: { group: "Institute", label: "Notices", to: "/app/notices" },
  analytics: { group: "Institute", label: "Analytics", to: "/app/analytics" },
  platform: { group: "Institute", label: "Platform", to: "/app/platform" },
  settings: { label: "Settings", to: "/app/settings" },
  my: { label: "My tests", to: "/app/my" },
};
export function autoCrumbs(pathname: string): Crumb[] {
  const parts = pathname.replace(/^\/app\/?/, "").split("/").filter(Boolean);
  if (!parts.length) return [];
  const sec = SECTIONS[parts[0]];
  if (!sec) return [];
  const out: Crumb[] = sec.group ? [{ label: sec.group }] : [];
  if (parts.length > 1) out.push({ label: sec.label, to: sec.to });
  return out;
}

/** Page header. `crumbs` are the pages above this one (worked out from the address when left out). */
export function PageTitle({ title, sub, children, crumbs }: { title: string; sub?: ReactNode; children?: ReactNode; crumbs?: Crumb[] }) {
  const loc = useLocation();
  const trail = crumbs ?? autoCrumbs(loc.pathname);
  return (
    <div className="page-title">
      <div className="page-title-main">
        {trail.length > 0 && (
          <nav className="crumbs" aria-label="Breadcrumb"><ol>
            {trail.map((c, i) => <li key={i}>{c.to ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}<Icon name="chevron" size={13} /></li>)}
            <li aria-current="page"><span>{title}</span></li>
          </ol></nav>
        )}
        <h1>{title}</h1>{sub && <p>{sub}</p>}
      </div>
      {children && <div className="row wrap page-actions">{children}</div>}
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
