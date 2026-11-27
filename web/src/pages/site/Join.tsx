// A student joins their batch from an invite link: name, roll number, phone, and a password of their choice.
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { ErrorBox, Loading, Logo } from "../../components/ui";
import { useToast } from "../../components/toast";

export default function Join() {
  const { token } = useParams();
  const [info, setInfo] = useState<{ institute: string; batch: string } | null>(null);
  const [bad, setBad] = useState<string | null>(null);
  const [f, setF] = useState({ name: "", roll_no: "", phone: "", email: "", parent_phone: "", password: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { login } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  useEffect(() => { api<{ institute: string; batch: string }>(`/public/invite/${token}`).then(setInfo).catch((e) => setBad((e as Error).message)); }, [token]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const r = await api<{ token: string; username: string }>(`/public/invite/${token}/join`, { body: f });
      await login(r.token);
      toast.success(`Welcome! Your username is ${r.username}. Use it (or your email) with your password to sign in next time.`);
      nav("/app/my");
    } catch (x) { setErr((x as Error).message); setBusy(false); }
  };
  return (
    <div className="auth-wrap join-wrap">
      <div className="auth-form">
        <div className="card">
          <Logo />
          {!info && !bad ? <Loading label="Checking the link…" /> : bad ? (
            <div className="stack" style={{ marginTop: 18 }}><h1 style={{ fontSize: 26 }}>Link not working</h1><ErrorBox error={bad} /><Link to="/login" className="btn btn-ghost">Go to sign in</Link></div>
          ) : (
            <>
              <h1 style={{ fontSize: 28, marginTop: 18 }}>Join {info!.batch}</h1>
              <p className="muted" style={{ margin: "6px 0 22px" }}>at {info!.institute}. Fill in your details and choose a password.</p>
              <form className="stack" onSubmit={submit}>
                <label className="field"><span>Your full name *</span><input className="input" required minLength={2} autoComplete="name" value={f.name} onChange={set("name")} /></label>
                <div className="grid g2">
                  <label className="field"><span>Roll no</span><input className="input" value={f.roll_no} onChange={set("roll_no")} /></label>
                  <label className="field"><span>Phone</span><input className="input" inputMode="tel" autoComplete="tel" value={f.phone} onChange={set("phone")} /></label>
                  <label className="field"><span>Email (optional)</span><input className="input" type="email" autoComplete="email" value={f.email} onChange={set("email")} /></label>
                  <label className="field"><span>Parent's phone</span><input className="input" inputMode="tel" value={f.parent_phone} onChange={set("parent_phone")} /></label>
                </div>
                <label className="field"><span>Choose a password (8+ characters) *</span><input className="input" type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={set("password")} /></label>
                <ErrorBox error={err} />
                <button className="btn btn-primary" disabled={busy}>{busy ? "Joining…" : "Join and sign in"}</button>
                <p className="small muted" style={{ margin: 0 }}>Already have an account? <Link to="/login" className="btn-link">Sign in</Link></p>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
