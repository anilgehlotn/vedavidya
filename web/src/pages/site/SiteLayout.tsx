import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Logo } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { useReveal } from "../../lib/motion";

export default function SiteLayout() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const loc = useLocation();
  useReveal(loc.pathname);
  useEffect(() => { setOpen(false); window.scrollTo(0, 0); }, [loc.pathname]);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <div className="site site6">
      <div className="bg6" aria-hidden><i /><i /><i /></div>
      <header className={`nav6 ${scrolled ? "scrolled" : ""} ${open ? "open" : ""}`}>
        <div className="nav6-bar">
          <Logo />
          <nav className="nav6-pills">
            <NavLink to="/" end>Home</NavLink>
            <a href="/#how">How it works</a>
            <a href="/#features">Features</a>
            <NavLink to="/about">About</NavLink>
            <NavLink to="/contact">Contact</NavLink>
          </nav>
          <div className="nav6-cta">
            {user
              ? <Link to="/app" className="btn6 dark sm">Open dashboard</Link>
              : <>
                  <Link to="/login" className="btn6 light sm hide-sm">Log in</Link>
                  <Link to="/contact" className="btn6 dark sm">Book a demo</Link>
                </>}
            <button className="nav6-toggle" onClick={() => setOpen(!open)} aria-label="Menu" aria-expanded={open}><span /><span /></button>
          </div>
        </div>
      </header>
      <Outlet />
      <footer className="footer6">
        <div className="wrap6">
          <div className="tile footer6-card">
            <div className="footer6-grid">
              <div>
                <Logo />
                <p>AI marking, question papers and progress reports for schools and coaching institutes.</p>
                <span className="mail">hello@vedavidya.co</span>
              </div>
              <div><h5>Product</h5><a href="/#how">How it works</a><a href="/#features">Features</a><Link to="/login">Live demo</Link></div>
              <div><h5>Get started</h5><Link to="/contact">Book a demo</Link><Link to="/login?mode=register">Create institute</Link><Link to="/login">Sign in</Link></div>
              <div><h5>Company</h5><Link to="/about">About</Link><Link to="/contact">Contact</Link></div>
            </div>
            <div className="footer6-base"><span>© {new Date().getFullYear()} Veda Vidya</span><span>Made for teachers in India</span></div>
          </div>
        </div>
      </footer>
    </div>
  );
}
