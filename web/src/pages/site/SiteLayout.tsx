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
      <header className={`nav3 ${scrolled ? "scrolled" : ""} ${open ? "open" : ""}`}>
        <div className="wrap nav3-inner">
          <Logo />
          <nav className="nav3-links">
            <a href="/#evaluate">Evaluation</a>
            <a href="/#papers">Question papers</a>
            <a href="/#how">How it works</a>
            <NavLink to="/about">About</NavLink>
            <NavLink to="/contact">Contact</NavLink>
          </nav>
          <div className="nav3-cta">
            {user
              ? <Link to="/app" className="btn btn-primary btn-sm">Open dashboard</Link>
              : <>
                  <Link to="/login">Log in</Link>
                  <Link to="/contact" className="btn btn-primary btn-sm">Book a demo</Link>
                </>}
            <button className="nav3-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Close" : "Menu"}</button>
          </div>
        </div>
      </header>
      <Outlet />
      <footer className="footer3">
        <div className="wrap">
          <div className="footer3-grid">
            <div>
              <Logo light />
              <p style={{ margin: "16px 0 10px", maxWidth: 320 }}>Answer-sheet evaluation, question papers and student insight for schools and coaching institutes.</p>
              <span className="mail">hello@vedavidya.co</span>
            </div>
            <div><h5>Product</h5><a href="/#evaluate">Evaluation</a><a href="/#papers">Question papers</a><a href="/#insight">Insight</a><a href="/#how">How it works</a></div>
            <div><h5>Get started</h5><Link to="/contact">Book a demo</Link><Link to="/login">Live demo</Link><Link to="/login?mode=register">Create institute</Link></div>
            <div><h5>Company</h5><Link to="/about">About</Link><Link to="/contact">Contact</Link></div>
          </div>
          <div className="footer3-word" aria-hidden>Veda Vidya</div>
          <div className="footer3-base"><span>© {new Date().getFullYear()} Veda Vidya</span><span>Made for teachers in India</span></div>
        </div>
      </footer>
    </div>
  );
}
