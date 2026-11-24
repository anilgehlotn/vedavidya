import { useEffect, useState } from "react";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Logo, Loading } from "../../components/ui";
import { useAuth } from "../../lib/auth";

const STAFF_NAV = [
  ["Workspace", [["/app", "◉", "Overview"], ["/app/tests", "✎", "Tests & evaluation"], ["/app/papers", "▤", "Question papers"], ["/app/analytics", "◔", "Analytics"]]],
  ["Institute", [["/app/batches", "▦", "Centres & batches"], ["/app/students", "☺", "Students"], ["/app/teachers", "✦", "Staff"], ["/app/notices", "✉", "Notice board"]]],
  ["Account", [["/app/settings", "⚙", "Settings"]]],
] as const;
const STUDENT_NAV = [
  ["Me", [["/app/my", "◉", "My tests"], ["/app/my/report", "◔", "My report card"], ["/app/notices", "✉", "Notices"], ["/app/settings", "⚙", "Settings"]]],
] as const;

export default function AppLayout() {
  const { user, org, loading, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => setOpen(false), [loc.pathname]);
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  const groups = user.role === "student" ? STUDENT_NAV : STAFF_NAV;
  if (user.role === "student" && loc.pathname === "/app") return <Navigate to="/app/my" replace />;

  return (
    <div className="app">
      <div className="mobile-bar"><Logo light to="/app" /><button onClick={() => setOpen(!open)} aria-label="Menu">☰</button></div>
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <Logo light to="/app" />
        {groups.map(([g, items]) => (
          <div key={g}>
            <div className="grp">{g}</div>
            {items.map(([to, ico, label]) => (
              <NavLink key={to} to={to} end={to === "/app" || to === "/app/my"}><span className="ico">{ico}</span>{label}</NavLink>
            ))}
          </div>
        ))}
        <div className="me">
          <div style={{ color: "#fff", fontWeight: 600 }}>{user.name}</div>
          <div style={{ color: "#77718c", textTransform: "capitalize" }}>{user.role} · {org?.name}</div>
          <button className="btn-link" style={{ color: "#c9bbff", marginTop: 8, fontSize: 13 }} onClick={() => { logout(); nav("/login"); }}>Sign out</button>
        </div>
      </aside>
      <main className="main"><Outlet /></main>
    </div>
  );
}
