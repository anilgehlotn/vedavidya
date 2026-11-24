import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Logo } from "../../components/ui";
import { useAuth } from "../../lib/auth";

export default function SiteLayout() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const loc = useLocation();
  useEffect(() => { setOpen(false); window.scrollTo(0, 0); }, [loc.pathname]);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", on);
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <>
      <header className={`nav ${scrolled ? "scrolled" : ""}`}>
        <div className="site-wrap nav-inner">
          <Logo />
          <nav className={`nav-links ${open ? "open" : ""}`}>
            <NavLink to="/" end>Home</NavLink>
            <a href="/#product">Product</a>
            <a href="/#formats">Exam formats</a>
            <NavLink to="/about">About</NavLink>
            <NavLink to="/contact">Contact</NavLink>
          </nav>
          <div className="nav-cta">
            {user
              ? <Link to="/app" className="btn btn-primary btn-sm">Open dashboard →</Link>
              : <>
                  <Link to="/login" className="btn-link hide-sm" style={{ color: "var(--ink)" }}>Log in</Link>
                  <Link to="/contact" className="btn btn-primary btn-sm">Book a demo</Link>
                </>}
            <button className="nav-toggle" onClick={() => setOpen(!open)} aria-label="Menu">☰</button>
          </div>
        </div>
      </header>
      <Outlet />
      <footer className="footer">
        <div className="site-wrap">
          <div className="footer-grid">
            <div className="stack" style={{ gap: 12 }}>
              <Logo />
              <p className="muted small" style={{ maxWidth: 320 }}>
                AI evaluation, paper setting and student analytics for schools and coaching institutes - so teachers can get back to teaching.
              </p>
              <a href="mailto:hello@markwise.example">hello@markwise.example</a>
            </div>
            <div><h5>PRODUCT</h5><a href="/#product">Evaluation</a><a href="/#product">Paper generator</a><a href="/#product">Analytics</a><a href="/#formats">Online tests</a></div>
            <div><h5>RESOURCES</h5><Link to="/login">Sign in</Link><Link to="/login?mode=register">Create institute</Link><Link to="/contact">Book a demo</Link></div>
            <div><h5>COMPANY</h5><Link to="/about">About</Link><Link to="/contact">Contact</Link></div>
          </div>
          <div className="row between small muted" style={{ marginTop: 40, flexWrap: "wrap" }}>
            <span>© {new Date().getFullYear()} Markwise. All rights reserved.</span>
            <span>Made for teachers in India</span>
          </div>
        </div>
      </footer>
    </>
  );
}
