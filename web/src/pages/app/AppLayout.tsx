import { useEffect, useState } from "react";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Logo, Loading } from "../../components/ui";
import { useAuth } from "../../lib/auth";

const STAFF_NAV = [
  ["/app", "Dashboard"], ["/app/tests", "Tests"], ["/app/papers", "Papers"], ["/app/analytics", "Analytics"],
  ["/app/batches", "Batches"], ["/app/students", "Students"], ["/app/teachers", "Staff"], ["/app/notices", "Notices"],
] as const;
const STUDENT_NAV = [["/app/my", "My tests"], ["/app/my/report", "Report card"], ["/app/notices", "Notices"]] as const;

const initials = (name: string) => name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

export default function AppLayout() {
  const { user, org, loading, logout } = useAuth();
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => setMenu(false), [loc.pathname]);
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "student" && loc.pathname === "/app") return <Navigate to="/app/my" replace />;
  const items = user.role === "student" ? STUDENT_NAV : user.is_super_admin ? [...STAFF_NAV, ["/app/platform", "Platform"] as [string, string]] : STAFF_NAV;

  return (
    <div className="app6">
      <div className="bg6" aria-hidden><i /><i /><i /></div>
      <div className="app6-frame">
        <header className="app6-bar">
          <Logo to="/app" />
          <nav className="app6-pills">
            {items.map(([to, label]) => <NavLink key={to} to={to} end={to === "/app" || to === "/app/my"}>{label}</NavLink>)}
          </nav>
          <div className="app6-right">
            <NavLink to="/app/settings" className="round" aria-label="Settings">
              <svg viewBox="0 0 24 24" className="ic" aria-hidden><path d="M12 15a3 3 0 1 0 0-6a3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 14H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1A2 2 0 1 1 7 4.2l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1A2 2 0 1 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
            </NavLink>
            <div className="app6-me">
              <button className="ava t-sun" onClick={() => setMenu(!menu)} aria-label="Account menu" aria-expanded={menu}>{initials(user.name)}</button>
              {menu && (
                <div className="app6-menu">
                  <b>{user.name}</b>
                  <span>{user.role} · {org?.name}</span>
                  <button onClick={() => { logout(); nav("/login"); }}>Sign out</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="main6"><Outlet /></main>
      </div>
    </div>
  );
}
