import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { Logo } from "../../components/ui";

export default function Login() {
  const [params] = useSearchParams();
  const [mode, setMode] = useState<"login" | "register">(params.get("mode") === "register" ? "register" : "login");
  const [f, setF] = useState({ identifier: "", password: "", institute: "", city: "", name: "", email: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { login } = useAuth();
  const nav = useNavigate();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const doLogin = async (identifier: string, password: string) => {
    const r = await api<{ token: string }>("/auth/login", { body: { identifier, password } });
    const u = await login(r.token);
    nav(u.role === "student" ? "/app/my" : "/app");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (mode === "login") await doLogin(f.identifier, f.password);
      else {
        const r = await api<{ token: string }>("/auth/register", { body: { institute: f.institute, city: f.city, name: f.name, email: f.email, password: f.password } });
        await login(r.token);
        nav("/app");
      }
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  const demo = async (who: "admin" | "teacher" | "student") => {
    setBusy(true); setError(null);
    try { await doLogin({ admin: "admin@demo.school", teacher: "teacher1@demo.school", student: "student" }[who], "demo1234"); }
    catch (err) { setError(`${(err as Error).message}. Run "npm run seed" to create the demo institute.`); }
    finally { setBusy(false); }
  };

  return (
    <div className="auth-wrap">
      <aside className="auth-art">
        <Logo light />
        <div>
          <div className="hand" style={{ fontSize: 34, color: "#7be3c6", lineHeight: 1.2 }}>“Checked 42 copies before my chai went cold.”</div>
          <p style={{ color: "#a8a3b8", marginTop: 16, maxWidth: 380 }}>Evaluate answer sheets, generate papers and track every student - from one dashboard.</p>
        </div>
        <div className="small" style={{ color: "#77718c" }}>Admins, teachers and students all sign in here.</div>
      </aside>
      <div className="auth-form">
        <div className="card">
          <h2 style={{ fontSize: 26 }}>{mode === "login" ? "Welcome back" : "Create your institute"}</h2>
          <p className="muted" style={{ margin: "6px 0 22px" }}>{mode === "login" ? "Sign in with your email or student username." : "You'll be the admin. Add teachers and students next."}</p>
          <form className="stack" onSubmit={submit}>
            {mode === "register" && <>
              <label className="field"><span>Institute name</span><input className="input" required value={f.institute} onChange={set("institute")} /></label>
              <div className="grid g2">
                <label className="field"><span>Your name</span><input className="input" required value={f.name} onChange={set("name")} /></label>
                <label className="field"><span>City</span><input className="input" value={f.city} onChange={set("city")} /></label>
              </div>
              <label className="field"><span>Work email</span><input className="input" type="email" required value={f.email} onChange={set("email")} /></label>
            </>}
            {mode === "login" && <label className="field"><span>Email, phone or username</span><input className="input" required autoComplete="username" value={f.identifier} onChange={set("identifier")} /></label>}
            <label className="field"><span>Password</span><input className="input" type="password" required minLength={mode === "register" ? 8 : 1} autoComplete={mode === "login" ? "current-password" : "new-password"} value={f.password} onChange={set("password")} /></label>
            {error && <div className="error-box">{error}</div>}
            <button className="btn btn-primary" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create institute"}</button>
          </form>
          <p className="small muted" style={{ marginTop: 16, textAlign: "center" }}>
            {mode === "login" ? "New to Veda Vidya? " : "Already have an account? "}
            <button className="btn-link" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}>{mode === "login" ? "Create an institute" : "Sign in"}</button>
          </p>
          {mode === "login" && (
            <div style={{ borderTop: "1px solid var(--line)", marginTop: 18, paddingTop: 16 }}>
              <div className="small muted" style={{ textAlign: "center", marginBottom: 10 }}>Explore the demo institute as</div>
              <div className="row" style={{ justifyContent: "center", flexWrap: "wrap" }}>
                {(["admin", "teacher", "student"] as const).map((r) => <button key={r} className="btn btn-ghost btn-sm" disabled={busy} onClick={() => demo(r)} style={{ textTransform: "capitalize" }}>{r}</button>)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
