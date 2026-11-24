import { Link } from "react-router-dom";

export default function About() {
  return (
    <main className="site-wrap">
      <section className="page-hero">
        <span className="chip">About</span>
        <h1>Built for the teachers who <span className="serif" style={{ color: "var(--accent)" }}>check every copy</span>.</h1>
      </section>
      <section className="prose">
        <p>In most Indian schools and coaching institutes, a single test creates days of work: setting the paper, checking hundreds of handwritten copies, totalling marks, entering them into a spreadsheet and sending them to parents. The people doing that work are the same teachers students rely on in class.</p>
        <p>Large chains can afford in-house technology teams to automate this. Most institutes can't. Markwise brings the same capabilities - AI evaluation of handwritten answers, on-demand question papers and real student analytics - to every institute, whatever its size.</p>
        <p>We believe AI should do the repetitive work and teachers should keep the judgement. That's why every mark Markwise gives comes with its reasoning, and every mark can be reviewed and changed before results go out.</p>
      </section>
      <section className="section">
        <div className="grid g2">
          {[["Every student gets a record", "Small gaps compound. Topic-level history for every student makes them visible early, while they're still easy to fix."],
            ["Fair, consistent assessment", "The same rubric is applied to every copy, so a student's marks don't depend on who checked the paper."],
            ["Teaching over paperwork", "Hours spent totalling marks are hours not spent preparing lessons. We want those hours back in the classroom."],
            ["AI for every institute", "A student's opportunities shouldn't depend on the size of their institute or the city they live in."]].map(([h, t], i) => (
            <div key={h} className="card pain-card">
              <span className="num" style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 22, color: "var(--muted)" }}>0{i + 1}</span>
              <h4 style={{ fontSize: 19, margin: "6px 0" }}>{h}</h4><p className="muted">{t}</p>
            </div>
          ))}
        </div>
        <div style={{ textAlign: "center", marginTop: 48 }}><Link to="/contact" className="btn btn-primary">Talk to us →</Link></div>
      </section>
    </main>
  );
}
