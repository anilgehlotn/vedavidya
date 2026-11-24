import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";

export default function Contact() {
  const [form, setForm] = useState({ first_name: "", last_name: "", phone: "", institute: "", students: "", email: "", message: "" });
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState("sending"); setError(null);
    try { await api("/contact", { body: form }); setState("done"); }
    catch (err) { setError((err as Error).message); setState("idle"); }
  };

  return (
    <main className="page2"><div className="wrap">
      <header className="page2-head">
        <p className="eyebrow2 rise" style={{ ["--i" as string]: 0 }}>Book a demo</p>
        <h1 className="display rise" style={{ ["--i" as string]: 1, fontSize: "clamp(40px, 6vw, 72px)" }}>Let's mark <span className="grad">your</span> answer sheets.</h1>
        <p className="lede rise" style={{ ["--i" as string]: 2 }}>Tell us about your institute and we'll get back within one working day.</p>
      </header>
      <div className="form-card rise" style={{ ["--i" as string]: 3 }}>
        {state === "done" ? (
          <div className="stack" style={{ textAlign: "center", padding: 20 }}>
            <div style={{ fontSize: 40 }}>✅</div>
            <h3>Thanks, {form.first_name}!</h3>
            <p className="muted">We've received your details and will reach out on {form.phone} shortly.</p>
            <Link to="/" className="btn btn-ghost" style={{ alignSelf: "center" }}>Back to home</Link>
          </div>
        ) : (
          <form className="stack" onSubmit={submit}>
            <div className="grid g2">
              <label className="field"><span>First name *</span><input className="input" required value={form.first_name} onChange={set("first_name")} /></label>
              <label className="field"><span>Last name *</span><input className="input" required value={form.last_name} onChange={set("last_name")} /></label>
              <label className="field"><span>Phone number *</span><input className="input" required type="tel" value={form.phone} onChange={set("phone")} placeholder="+91" /></label>
              <label className="field"><span>Institute name *</span><input className="input" required value={form.institute} onChange={set("institute")} /></label>
              <label className="field"><span>Number of students *</span>
                <select className="input" required value={form.students} onChange={set("students")}>
                  <option value="">Select…</option>{["Under 100", "100–500", "500–2,000", "2,000–10,000", "10,000+"].map((o) => <option key={o}>{o}</option>)}
                </select>
              </label>
              <label className="field"><span>Work email</span><input className="input" type="email" value={form.email} onChange={set("email")} /></label>
            </div>
            <label className="field"><span>Anything else? (optional)</span><textarea className="input" value={form.message} onChange={set("message")} /></label>
            {error && <div className="error-box">{error}</div>}
            <button className="btn btn-primary btn-lg" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Request a demo"}</button>
          </form>
        )}
      </div>
    </div></main>
  );
}
