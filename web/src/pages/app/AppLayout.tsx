// The app shell: a narrow left sidebar (icons with labels), flyout menus for grouped pages, search, account,
// and the page area. On phones the sidebar slides in from the left.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { PageSkeleton } from "../../components/ui";
import { Icon, type IconName } from "../../components/icons";
import { useAuth } from "../../lib/auth";
import { api } from "../../lib/api";
import type { Org, User } from "../../lib/types";

interface Leaf { to: string; label: string; icon: IconName; end?: boolean; also?: string[] }
interface Group { id: string; label: string; icon: IconName; children: Leaf[] }
type Item = Leaf | Group;
const isGroup = (i: Item): i is Group => "children" in i;

function menuFor(user: User): Item[] {
  if (user.role === "student") return [
    { to: "/app/my", label: "My tests", icon: "tests", end: true },
    { to: "/app/my/report", label: "Report card", icon: "report" },
    { to: "/app/notices", label: "Notices", icon: "notices" },
    { to: "/app/settings", label: "Settings", icon: "settings" },
  ];
  const institute: Leaf[] = [
    { to: "/app/batches", label: "Batches", icon: "batches" },
    { to: "/app/notices", label: "Notices", icon: "notices" },
    { to: "/app/analytics", label: "Analytics", icon: "chart" },
  ];
  if (user.is_super_admin) institute.push({ to: "/app/platform", label: "Platform", icon: "shield" });
  return [
    { to: "/app", label: "Home", icon: "home", end: true },
    { id: "assess", label: "Assessments", icon: "assess", children: [
      { to: "/app/tests", label: "Tests", icon: "tests", also: ["/app/attempts"] },
      { to: "/app/papers", label: "Question Papers", icon: "paper" },
      { to: "/app/practice", label: "Practice Questions", icon: "practice" },
    ] },
    { id: "people", label: "People", icon: "people", children: [
      { to: "/app/students", label: "Students", icon: "student" },
      { to: "/app/teachers", label: "Staff", icon: "staff" },
    ] },
    { id: "inst", label: "Institute", icon: "institute", children: institute },
    { to: "/app/settings", label: "Settings", icon: "settings" },
  ];
}

const leafActive = (l: Leaf, path: string) =>
  l.end ? path === l.to : [l.to, ...(l.also ?? [])].some((p) => path === p || path.startsWith(p + "/"));
const initials = (name: string) => name.split(" ").filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
const PLAN: Record<NonNullable<Org["plan"]>, string> = { credits: "Credits", own_key: "Own key", demo: "Demo" };
const readCollapsed = () => { try { return localStorage.getItem("vv_side_collapsed") === "1"; } catch { return false; } };

export default function AppLayout() {
  const { user, org, loading, logout } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawer, setDrawer] = useState(false);
  const [fly, setFly] = useState<{ id: string; top: number } | null>(null);
  const [account, setAccount] = useState(false);
  const [search, setSearch] = useState(false);
  const flyRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setDrawer(false); setFly(null); setAccount(false); }, [loc.pathname]);
  useEffect(() => { try { localStorage.setItem("vv_side_collapsed", collapsed ? "1" : "0"); } catch { /* private mode */ } }, [collapsed]);
  // Ctrl/⌘ K opens search; Escape closes menus.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearch(true); }
      if (e.key === "Escape") { setFly(null); setAccount(false); setDrawer(false); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  // Clicking elsewhere closes the flyout and the account menu.
  useEffect(() => {
    if (!fly && !account) return;
    const c = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest(".flyout, .side-group-btn, .sub-inline, .acct-pop, .acct-btn")) { setFly(null); setAccount(false); }
    };
    document.addEventListener("mousedown", c);
    return () => document.removeEventListener("mousedown", c);
  }, [fly, account]);
  // When a flyout opens from the keyboard, move focus into it.
  useEffect(() => { if (fly) flyRef.current?.querySelector<HTMLElement>("a")?.focus({ preventScroll: true }); }, [fly?.id]);

  if (loading) return <div className="shell"><aside className="side" /><main className="shell-main"><PageSkeleton /></main></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "student" && loc.pathname === "/app") return <Navigate to="/app/my" replace />;

  const items = menuFor(user);
  const openGroup = items.find((i): i is Group => isGroup(i) && i.id === fly?.id);
  const signOut = () => { logout(); nav("/login"); };
  const mobile = () => window.matchMedia("(max-width: 900px)").matches;

  return (
    <div className={`shell ${collapsed ? "collapsed" : ""} ${drawer ? "drawer-open" : ""}`}>
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="mobile-top">
        <button className="icon-btn" onClick={() => setDrawer(true)} aria-label="Open menu" aria-expanded={drawer}><Icon name="menu" /></button>
        <Link to="/app" className="side-logo" aria-label="Veda Vidya home"><LogoMark /><span>Veda Vidya</span></Link>
        <button className="icon-btn" onClick={() => setSearch(true)} aria-label="Search"><Icon name="search" /></button>
      </header>
      {drawer && <div className="drawer-bg" onClick={() => setDrawer(false)} aria-hidden />}

      <aside className="side" aria-label="Main menu">
        <div className="side-top">
          <Link to="/app" className="side-logo" aria-label="Veda Vidya home" title="Veda Vidya"><LogoMark /><span className="side-wordmark">Veda Vidya</span></Link>
          <button className="side-tool desktop-only" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "Expand menu" : "Collapse menu"} title={collapsed ? "Expand menu" : "Collapse menu"}>
            <Icon name={collapsed ? "expand" : "collapse"} size={18} /></button>
          <button className="side-tool" onClick={() => setSearch(true)} aria-label="Search (Ctrl K)" title="Search (Ctrl K)"><Icon name="search" size={18} /></button>
          <button className="side-tool mobile-only" onClick={() => setDrawer(false)} aria-label="Close menu"><Icon name="close" size={18} /></button>
        </div>

        <nav className="side-nav" aria-label="Pages">
          <ul>
            {items.map((it) => isGroup(it) ? (
              <li key={it.id}>
                <button type="button" className={`side-item side-group-btn ${it.children.some((c) => leafActive(c, loc.pathname)) ? "active" : ""} ${fly?.id === it.id ? "open" : ""}`}
                  aria-haspopup="true" aria-expanded={fly?.id === it.id} title={collapsed ? it.label : undefined}
                  onClick={(e) => {
                    if (fly?.id === it.id) return setFly(null);
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setFly({ id: it.id, top: mobile() ? -1 : Math.min(r.top, window.innerHeight - 60 - it.children.length * 48) });
                  }}>
                  <Icon name={it.icon} /><span className="side-label">{it.label}</span>
                </button>
                {fly?.id === it.id && mobile() && <SubMenu group={it} path={loc.pathname} inline />}
              </li>
            ) : (
              <li key={it.to}>
                <NavLink to={it.to} end={it.end} className={() => `side-item ${leafActive(it, loc.pathname) ? "active" : ""}`} title={collapsed ? it.label : undefined}>
                  <Icon name={it.icon} /><span className="side-label">{it.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="side-bottom">
          <button type="button" className="side-item danger" onClick={signOut} title={collapsed ? "Logout" : undefined}><Icon name="logout" /><span className="side-label">Logout</span></button>
          <button type="button" className="acct-btn" onClick={() => setAccount(!account)} aria-expanded={account} aria-label={`Account: ${user.name}`}>
            <span className="ava">{initials(user.name)}</span>
            <span className="plan-badge">{user.role === "student" ? "Student" : PLAN[org?.plan ?? "credits"]}</span>
          </button>
          {account && (
            <div className="acct-pop" role="dialog" aria-label="Account">
              <b>{user.name}</b>
              <span className="small muted">{user.email ?? ""}</span>
              <span className="small" style={{ textTransform: "capitalize" }}>{user.role} · {org?.name}</span>
              {user.role !== "student" && <span className="small muted">{org?.plan === "own_key" ? "AI on your own Claude key" : org?.plan === "demo" ? "Public demo (read-only)" : "AI paid with Veda Vidya credits"}</span>}
              <Link to="/app/settings" className="btn btn-ghost btn-sm" onClick={() => setAccount(false)}>Settings</Link>
            </div>
          )}
        </div>
      </aside>

      {openGroup && fly && fly.top >= 0 && (
        <div className="flyout" ref={flyRef} style={{ top: Math.max(12, fly.top) }} role="menu" aria-label={openGroup.label}
          onKeyDown={(e) => {
            const links = [...(flyRef.current?.querySelectorAll<HTMLElement>("a") ?? [])];
            const i = links.indexOf(document.activeElement as HTMLElement);
            if (e.key === "ArrowDown") { e.preventDefault(); links[(i + 1) % links.length]?.focus(); }
            if (e.key === "ArrowUp") { e.preventDefault(); links[(i - 1 + links.length) % links.length]?.focus(); }
          }}>
          <div className="flyout-title">{openGroup.label}</div>
          <SubMenu group={openGroup} path={loc.pathname} />
        </div>
      )}

      <main className="shell-main" id="main" tabIndex={-1}><Outlet /></main>
      {search && <SearchDialog user={user} items={items} onClose={() => setSearch(false)} />}
    </div>
  );
}

function SubMenu({ group, path, inline }: { group: Group; path: string; inline?: boolean }) {
  return (
    <ul className={inline ? "sub-inline" : "sub"}>
      {group.children.map((c) => (
        <li key={c.to}><Link to={c.to} role="menuitem" className={leafActive(c, path) ? "active" : ""} aria-current={leafActive(c, path) ? "page" : undefined}>
          <Icon name={c.icon} size={18} />{c.label}</Link></li>
      ))}
    </ul>
  );
}

function LogoMark() {
  return (
    <svg className="logo-mark" viewBox="0 0 64 64" aria-hidden width={32} height={32}>
      <circle cx="32" cy="32" r="32" fill="#FF6A4C" />
      <path d="M18 33 L28 43 L46 22" fill="none" stroke="#FFFFFF" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---- Search: pages, and for staff also tests, papers and students ----
interface Hit { label: string; sub: string; to: string; icon: IconName }
function SearchDialog({ user, items, onClose }: { user: User; items: Item[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [data, setData] = useState<Hit[] | null>(null);
  const [failed, setFailed] = useState(false);
  const nav = useNavigate();
  const pages = useMemo<Hit[]>(() => items.flatMap((i) => isGroup(i)
    ? i.children.map((c) => ({ label: c.label, sub: i.label, to: c.to, icon: c.icon }))
    : [{ label: i.label, sub: "Page", to: i.to, icon: i.icon }]), [items]);
  useEffect(() => {
    if (user.role === "student") return setData([]);
    let live = true;
    Promise.all([
      api<{ id: string; title: string; subject: string | null; batch_names: string | null }[]>("/tests"),
      api<{ id: string; title: string; subject: string | null }[]>("/papers"),
      api<{ id: string; name: string; roll_no: string | null; batch_name: string | null }[]>("/students"),
    ]).then(([t, p, s]) => {
      if (!live) return;
      setData([
        ...t.map((x) => ({ label: x.title, sub: ["Test", x.subject, x.batch_names].filter(Boolean).join(" · "), to: `/app/tests/${x.id}`, icon: "tests" as const })),
        ...p.map((x) => ({ label: x.title, sub: ["Question paper", x.subject].filter(Boolean).join(" · "), to: `/app/papers/${x.id}`, icon: "paper" as const })),
        ...s.map((x) => ({ label: x.name, sub: ["Student", x.batch_name, x.roll_no && `Roll ${x.roll_no}`].filter(Boolean).join(" · "), to: `/app/students/${x.id}`, icon: "student" as const })),
      ]);
    }).catch(() => live && (setFailed(true), setData([])));
    return () => { live = false; };
  }, [user.role]);
  const term = q.trim().toLowerCase();
  const hits = useMemo(() => {
    const all = [...pages, ...(data ?? [])];
    return (term ? all.filter((h) => `${h.label} ${h.sub}`.toLowerCase().includes(term)) : pages).slice(0, 12);
  }, [term, pages, data]);
  useEffect(() => setSel(0), [term]);
  const go = useCallback((h: Hit) => { onClose(); nav(h.to); }, [nav, onClose]);

  return (
    <div className="modal-bg search-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="search-box" role="dialog" aria-label="Search">
        <div className="search-input"><Icon name="search" />
          <input autoFocus placeholder={user.role === "student" ? "Search pages" : "Search tests, papers, students, pages"} value={q} onChange={(e) => setQ(e.target.value)}
            aria-label="Search" aria-controls="search-results" aria-activedescendant={hits[sel] ? `hit-${sel}` : undefined}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((sel + 1) % Math.max(1, hits.length)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel((sel - 1 + hits.length) % Math.max(1, hits.length)); }
              if (e.key === "Enter" && hits[sel]) go(hits[sel]);
              if (e.key === "Escape") onClose();
            }} />
          <kbd>Esc</kbd>
        </div>
        <ul id="search-results" role="listbox" className="search-results">
          {hits.map((h, i) => (
            <li key={h.to + i} id={`hit-${i}`} role="option" aria-selected={i === sel} className={i === sel ? "on" : ""} onMouseEnter={() => setSel(i)} onMouseDown={(e) => { e.preventDefault(); go(h); }}>
              <Icon name={h.icon} size={18} /><span className="grow"><b>{h.label}</b><span className="small muted">{h.sub}</span></span>
            </li>
          ))}
          {!hits.length && <li className="search-none">{data === null ? "Searching…" : `Nothing matches "${q}".`}</li>}
        </ul>
        {term && data === null && <div className="small muted search-foot">Loading tests, papers and students…</div>}
        {failed && <div className="small search-foot" style={{ color: "var(--red)" }}>Only pages can be searched right now (the lists couldn't be loaded).</div>}
      </div>
    </div>
  );
}
