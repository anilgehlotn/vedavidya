import { Link } from "react-router-dom";

const VALUES = [
  ["Every student gets a record.", "Small gaps compound. Topic-level history for every student makes them visible early, while they're still easy to fix."],
  ["Fair, consistent marking.", "The same scheme is applied to every copy, so a student's marks don't depend on who checked the paper."],
  ["Teaching over paperwork.", "Hours spent totalling marks are hours not spent preparing lessons. We want those hours back in the classroom."],
  ["For every institute.", "A student's opportunities shouldn't depend on the size of their institute or the city they live in."],
];

export default function About() {
  return (
    <main className="page2">
      <div className="wrap">
        <header className="page2-head">
          <p className="label mono fade" style={{ ["--i" as string]: 0 }}>About</p>
          <h1 className="h-xl">
            <span className="mline"><span style={{ ["--i" as string]: 1 }}>Built for the teachers</span></span>
            <span className="mline"><span style={{ ["--i" as string]: 2 }}>who check <span className="hl is-in">every copy.</span></span></span>
          </h1>
        </header>
        <div className="prose2" data-reveal>
          <p>In most Indian schools and coaching institutes, a single test creates days of work: setting the paper, checking hundreds of handwritten copies, totalling marks, entering them into a spreadsheet and sending them to parents. The people doing that work are the same teachers students rely on in class.</p>
          <p>Large chains can afford in-house technology teams to automate this. Most institutes can't. Veda Vidya brings the same tools to every institute, whatever its size: evaluation of handwritten answers, question papers on demand, and a clear view of how every student is doing.</p>
          <p>The software does the repetitive work and teachers keep the judgement. Every mark comes with its reason, and every mark can be changed before results go out.</p>
        </div>
        <div className="values" data-reveal>
          {VALUES.map(([h, t]) => <div key={h}><h3>{h}</h3><p>{t}</p></div>)}
        </div>
        <div className="actions"><Link to="/contact" className="btn btn-primary btn-lg">Talk to us</Link></div>
      </div>
    </main>
  );
}
