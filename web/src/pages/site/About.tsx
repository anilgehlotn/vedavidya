import { Link } from "react-router-dom";

const VALUES = [
  ["Every student gets a record.", "Small gaps compound. Topic-level history for every student makes them visible early, while they're still easy to fix."],
  ["Fair, consistent marking.", "The same rubric is applied to every copy, so a student's marks don't depend on who checked the paper."],
  ["Teaching over paperwork.", "Hours spent totalling marks are hours not spent preparing lessons. We want those hours back in the classroom."],
  ["AI for every institute.", "A student's opportunities shouldn't depend on the size of their institute or the city they live in."],
];

export default function About() {
  return (
    <main className="page2">
      <div className="wrap">
        <header className="page2-head">
          <p className="eyebrow2 rise" style={{ ["--i" as string]: 0 }}>About Veda Vidya</p>
          <h1 className="display rise" style={{ ["--i" as string]: 1, fontSize: "clamp(40px, 6vw, 72px)" }}>Built for the teachers who <span className="grad">check every copy.</span></h1>
        </header>
        <div className="prose2" data-reveal>
          <p>In most Indian schools and coaching institutes, a single test creates days of work: setting the paper, checking hundreds of handwritten copies, totalling marks, entering them into a spreadsheet and sending them to parents. The people doing that work are the same teachers students rely on in class.</p>
          <p>Large chains can afford in-house technology teams to automate this. Most institutes can't. Veda Vidya brings the same capabilities - AI evaluation of handwritten answers, on-demand question papers and real student analytics - to every institute, whatever its size.</p>
          <p>We believe AI should do the repetitive work and teachers should keep the judgement. Every mark Veda Vidya gives comes with its reasoning, and every mark can be reviewed and changed before results go out.</p>
        </div>
        <div className="values">
          {VALUES.map(([h, t]) => (
            <article key={h} className="tile" data-reveal><h3>{h}</h3><p>{t}</p></article>
          ))}
        </div>
        <div className="cta-row" style={{ marginTop: 72 }}><Link to="/contact" className="btn btn-primary btn-lg">Talk to us</Link></div>
      </div>
    </main>
  );
}
