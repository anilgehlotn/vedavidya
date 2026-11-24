import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import { useScrollProgress } from "../../lib/motion";

const v = (vars: Record<string, string | number>) => vars as CSSProperties;

/* Red-pen marks drawn as strokes, so they can "write themselves". */
const Tick = ({ d = 0, size = 26 }: { d?: number; size?: number }) => (
  <svg className="pen tick" width={size} height={size * 0.85} viewBox="0 0 26 22" aria-hidden style={v({ "--d": `${d}s` })}>
    <path d="M2 12.5 L9.5 19.5 L24 2.5" pathLength={1} />
  </svg>
);
const Ring = ({ d = 0, children, w = 64 }: { d?: number; children: ReactNode; w?: number }) => (
  <span className="ring" style={v({ "--d": `${d}s`, width: `${w}px` })}>
    <svg viewBox="0 0 64 48" aria-hidden className="pen"><path d="M50 6 C30 -2 4 6 4 24 C4 42 34 48 52 40 C64 34 64 12 44 5" pathLength={1} /></svg>
    <b>{children}</b>
  </span>
);
const Strike = ({ d = 0, children }: { d?: number; children: ReactNode }) => (
  <span className="strike" style={v({ "--d": `${d}s` })}>{children}<svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden className="pen"><path d="M1 7 C30 3 60 8 99 3" pathLength={1} /></svg></span>
);

function Line({ i, children }: { i: number; children: ReactNode }) {
  return <span className="mline"><span style={v({ "--i": i })}>{children}</span></span>;
}

/* ---------- Hero ---------- */
function AnswerSheet() {
  return (
    <figure className="sheet is-in" aria-label="A handwritten maths answer sheet being marked">
      <div className="sheet-head mono">
        <span>Roll No. <u>07</u></span><span>Subject <u>Mathematics</u></span><span>Date <u>18/11</u></span>
      </div>
      <div className="sheet-total"><Ring d={3.1} w={92}>16<small>/18</small></Ring></div>
      <div className="sheet-body hand">
        <p><span className="qn">1.</span> 2x² − 7x + 3 = 0</p>
        <p>(2x − 1)(x − 3) = 0 <Tick d={1.1} /></p>
        <p>x = ½ , 3 <Tick d={1.35} /></p>
        <p><span className="qn">2.</span> a₁₅ = 7 + 14 × 4 = 63 <Tick d={1.6} /><Tick d={1.75} /></p>
        <p><span className="qn">3.</span> मान लो √2 = p/q, जहाँ p, q सहअभाज्य</p>
        <p>p² = 2q² ⇒ p सम है <Tick d={1.95} /></p>
        <p>q² = 2k² ⇒ q भी <Strike d={2.3}>विषम</Strike> सम <Tick d={2.6} /></p>
        <p className="pen-note">conclusion? −½ <Ring d={2.8} w={58}>4½</Ring></p>
      </div>
    </figure>
  );
}

function Hero() {
  return (
    <section className="hero3">
      <div className="wrap hero3-grid">
        <div className="hero3-copy">
          <h1 className="h-xl">
            <Line i={0}>Your teachers</Line>
            <Line i={1}>check copies</Line>
            <Line i={2}>till midnight.</Line>
            <Line i={3}><span className="hl">They don't have to.</span></Line>
          </h1>
          <p className="lead fade" style={v({ "--i": 5 })}>
            Veda Vidya reads handwritten answer sheets in English, Hindi and Sanskrit, marks every step against your marking scheme, and tells each student what to fix. Your teachers review and sign off.
          </p>
          <div className="actions fade" style={v({ "--i": 6 })}>
            <Link to="/contact" className="btn btn-primary btn-lg">Book a demo</Link>
            <Link to="/login" className="link-arrow">Open the live demo</Link>
          </div>
        </div>
        <AnswerSheet />
      </div>
    </section>
  );
}

/* ---------- A normal week, as arithmetic ---------- */
function Week() {
  return (
    <section className="week">
      <div className="wrap">
        <p className="label mono" data-reveal>A normal week at a coaching centre</p>
        <div className="sum" data-reveal>
          <div><b>40</b><span>students in a batch</span></div>
          <i>×</i>
          <div><b>5</b><span>subjects</span></div>
          <i>×</i>
          <div><b>1</b><span>weekly test each</span></div>
          <i>=</i>
          <div className="res"><b>200</b><span>copies on one desk</span></div>
        </div>
        <p className="week-note" data-reveal>Each copy takes a careful teacher four to six minutes. That's most of a weekend, every weekend, before anyone has looked at what students got wrong.</p>
      </div>
    </section>
  );
}

/* ---------- Section A: evaluation ---------- */
const SCHEME = [
  ["Uses sin²θ + cos²θ = 1, or draws a right triangle", "1", "1"],
  ["Finds cos θ = 4/5", "1", "1"],
  ["Finds tan θ = 3/4", "1", "½"],
];
function Evaluate() {
  return (
    <section className="chapter" id="evaluate">
      <div className="wrap chapter-grid">
        <header className="chapter-head" data-reveal>
          <p className="label mono">Section A · Evaluation</p>
          <h2 className="h-lg">Marked the way your best teacher marks.</h2>
          <p className="body">Not just right or wrong. Each answer is read line by line and checked against the marking scheme you already use, with partial credit for every step a student gets right and a short note on the step they missed.</p>
        </header>
        <div className="eval" data-reveal>
          <div className="eval-sheet hand">
            <p><span className="qn">4.</span> sin θ = 3/5</p>
            <p>cos θ = √(1 − 9/25) = 4/5 <Tick d={0.5} /></p>
            <p>tan θ = 3/5 ÷ 4/5 = <Strike d={0.9}>4/3</Strike> 3/4 <Tick d={1.2} /></p>
            <p className="pen-note">correct, but show the cancel step <Ring d={1.4} w={54}>2½</Ring></p>
          </div>
          <table className="scheme mono">
            <thead><tr><th>Marking scheme · Q4</th><th>Max</th><th>Given</th></tr></thead>
            <tbody>{SCHEME.map(([s, m, g], i) => (
              <tr key={s} style={v({ "--d": `${0.3 + i * 0.25}s` })}><td>{s}</td><td>{m}</td><td className="given">{g}</td></tr>
            ))}</tbody>
            <tfoot><tr><td>Total</td><td>3</td><td className="given">2½</td></tr></tfoot>
          </table>
        </div>
      </div>
    </section>
  );
}

/* ---------- Section B: question papers ---------- */
function Generate() {
  return (
    <section className="chapter alt" id="papers">
      <div className="wrap chapter-grid flip">
        <header className="chapter-head" data-reveal>
          <p className="label mono">Section B · Question papers</p>
          <h2 className="h-lg">A fresh paper for every batch, in the format they'll face.</h2>
          <p className="body">Choose the board, class, chapters and pattern. You get an original paper with answer key, worked solutions and a step-wise marking scheme, laid out like the real exam. Edit anything before you print.</p>
        </header>
        <article className="qpaper" data-reveal aria-label="Sample question paper">
          <div className="qp-top">
            <b>SUNRISE ACADEMY, JAIPUR</b>
            <span>Unit Test II · Class X · Mathematics</span>
            <div className="qp-meta"><span>Time: 1 hr</span><span>M.M.: 20</span></div>
          </div>
          <p className="qp-gi"><b>General Instructions:</b> All questions are compulsory. Section A carries 1 mark each, Section B carries 3 marks each. Draw neat figures wherever required.</p>
          <p className="qp-sec">SECTION A</p>
          <ol className="qp-qs">
            <li>The 15th term of the A.P. 7, 11, 15, … is <span className="qp-m">[1]</span></li>
            <li>If sin θ = 3/5 and θ is acute, then tan θ equals<br /><span className="qp-opts">(a) 3/4 &nbsp; (b) 4/3 &nbsp; (c) 4/5 &nbsp; (d) 5/4</span><span className="qp-m">[1]</span></li>
          </ol>
          <p className="qp-sec">SECTION B</p>
          <ol className="qp-qs" start={3}>
            <li>Prove that √2 is irrational. <span className="qp-m">[3]</span></li>
          </ol>
          <div className="qp-stamp mono">Generated in 1 min 48 s · answer key attached</div>
        </article>
      </div>
    </section>
  );
}

/* ---------- Section C: analysis ---------- */
const TOPICS: [string, number][] = [["Trigonometry", 46], ["Heights & distances", 58], ["Quadratic equations", 74], ["Arithmetic progressions", 81], ["Real numbers", 88]];
function Analyse() {
  return (
    <section className="chapter" id="insight">
      <div className="wrap chapter-grid">
        <header className="chapter-head" data-reveal>
          <p className="label mono">Section C · Insight</p>
          <h2 className="h-lg">Know which chapter is costing marks, before the boards.</h2>
          <p className="body">Every marked copy feeds a running picture of each student, batch and centre. Topic by topic, test after test.</p>
        </header>
        <figure className="topics" data-reveal>
          <figcaption className="mono">Class 10-A · marks earned by chapter, last 4 tests</figcaption>
          {TOPICS.map(([t, p], i) => (
            <div key={t} className={`topic ${p < 50 ? "weak" : ""}`} style={v({ "--w": `${p}%`, "--d": `${i * 0.1}s` })}>
              <span>{t}</span><div className="tbar"><i /></div><b className="mono">{p}%</b>
            </div>
          ))}
          <p className="topics-note"><span className="hl">Trigonometry</span> is where this batch loses the most marks. Revision drills go to the 14 students below 50%.</p>
        </figure>
      </div>
    </section>
  );
}

/* ---------- How it works: pinned while you scroll ---------- */
const STEPS = [
  ["Collect", "Teachers photograph each copy with a phone, or scan a bundle to PDF. Any handwriting, any ink."],
  ["Mark", "Every answer is read, matched to the marking scheme and given step-wise marks with a reason."],
  ["Review", "Teachers look over the marks, change any they disagree with, and approve the batch."],
  ["Share", "Students and parents get their report card the same day, with exactly what to revise."],
];
function Process() {
  const [ref, p] = useScrollProgress<HTMLElement>("pin");
  const step = Math.min(STEPS.length - 1, Math.floor(p * STEPS.length));
  return (
    <section className="process" ref={ref} id="how">
      <div className="process-pin">
        <div className="wrap">
          <p className="label mono light">From bundle to report card</p>
          <div className="process-grid">
            <div className="process-num" aria-hidden>
              {STEPS.map((_, i) => <span key={i} className={i === step ? "on" : i < step ? "past" : ""}>{i + 1}</span>)}
            </div>
            <div className="process-text">
              {STEPS.map(([h, t], i) => (
                <div key={h} className={`pstep ${i === step ? "on" : ""}`} aria-hidden={i !== step}>
                  <h3 className="h-lg">{h}.</h3><p>{t}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="process-bar"><i style={{ transform: `scaleX(${p})` }} /></div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Formats ---------- */
function Formats() {
  return (
    <section className="formats3">
      <div className="wrap">
        <h2 className="h-lg" data-reveal>Three ways to test.<br /><span className="dimtext">One set of results.</span></h2>
        <div className="f3" data-reveal>
          <div><p className="mono f3-k">01 · Paper</p><h3>Written tests and homework</h3><p>Long answers, derivations, diagrams and essays, marked step by step.</p></div>
          <div><p className="mono f3-k">02 · OMR</p><h3>Bubble sheets</h3><p>Objective papers checked against the key, negative marking included.</p></div>
          <div><p className="mono f3-k">03 · Screen</p><h3>Online tests</h3><p>Timed tests on a phone or computer, with question palette and instant scores.</p></div>
        </div>
      </div>
    </section>
  );
}

function Principle() {
  return (
    <section className="principle">
      <div className="wrap">
        <blockquote data-reveal>
          <p className="h-xl">The software suggests a mark. <span className="hl">A teacher decides it.</span></p>
          <footer className="body">Every mark comes with its reason. Nothing reaches a student or parent until a teacher approves it.</footer>
        </blockquote>
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section className="closing">
      <div className="wrap closing-grid">
        <h2 className="h-xl" data-reveal>Bring us one bundle of copies. We'll mark it in front of you.</h2>
        <div className="closing-cta" data-reveal>
          <p>A 20-minute call with your own answer sheets. No slides.</p>
          <Link to="/contact" className="btn btn-gold btn-lg">Book a demo</Link>
          <Link to="/login?mode=register" className="link-arrow light">Or set up your institute</Link>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <main className="home3">
      <Hero />
      <Week />
      <Evaluate />
      <Generate />
      <Analyse />
      <Process />
      <Formats />
      <Principle />
      <Closing />
    </main>
  );
}
