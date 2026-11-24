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
    <div className="site">
      <header className={`nav2 ${scrolled ? "scrolled" : ""} ${open ? "open" : ""}`}>
        <div className="nav2-inner">
          <Logo />
          <nav className="nav2-links">
            <a href="/#how">How it works</a>
            <a href="/#features">Features</a>
            <NavLink to="/about">About</NavLink>
            <NavLink to="/contact">Contact</NavLink>
          </nav>
          <div className="nav2-cta">
            {user
              ? <Link to="/app" className="btn btn-primary btn-sm">Open dashboard</Link>
              : <>
                  <Link to="/login" className="nav2-login">Log in</Link>
                  <Link to="/contact" className="btn btn-primary btn-sm">Book a demo</Link>
                </>}
            <button className="nav2-toggle" onClick={() => setOpen(!open)} aria-label="Menu" aria-expanded={open}><span /><span /></button>
          </div>
        </div>
      </header>
      <Outlet />
      <footer className="footer2">
        <div className="wrap">
          <div className="footer2-grid">
            <div className="footer2-brand">
              <Logo />
              <p>AI evaluation, question papers and student analytics for schools and coaching institutes.</p>
              <span className="mail">hello@vedavidya.co</span>
            </div>
            <div><h5>Product</h5><a href="/#how">How it works</a><a href="/#features">Features</a><Link to="/login">Live demo</Link></div>
            <div><h5>Get started</h5><Link to="/contact">Book a demo</Link><Link to="/login?mode=register">Create institute</Link><Link to="/login">Sign in</Link></div>
            <div><h5>Company</h5><Link to="/about">About</Link><Link to="/contact">Contact</Link></div>
          </div>
          <div className="footer2-base">
            <span>© {new Date().getFullYear()} Veda Vidya</span>
            <span>Made for teachers in India</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
