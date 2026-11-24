import { Link } from "react-router-dom";
import { CountUp, Typewriter, useScrollProgress } from "../../lib/motion";

/* ---------- Hero: a product window that tilts flat as you scroll ---------- */
const RUBRIC = [
  { q: "Q1", topic: "Quadratic equations", got: 3, max: 3 },
  { q: "Q2", topic: "Arithmetic progressions", got: 2, max: 2 },
  { q: "Q3", topic: "Trigonometry", got: 2.5, max: 3 },
  { q: "Q4", topic: "Real numbers - proof", got: 4.5, max: 5 },
  { q: "Q5", topic: "Heights & distances", got: 4, max: 5 },
];

function HeroWindow() {
  return (
    <div className="pw" aria-label="Veda Vidya evaluating a handwritten answer sheet">
      <div className="pw-bar">
        <span className="pw-dots"><i /><i /><i /></span>
        <span className="pw-title">Maths Unit Test 2 · Reyansh Singh · Roll 7</span>
        <span className="pw-live"><i />Evaluating</span>
      </div>
      <div className="pw-body">
        <div className="pw-sheet">
          <div className="scanbeam" aria-hidden />
          <div className="hw l1">Q1. 2x² − 7x + 3 = 0</div>
          <div className="hw l2">(2x − 1)(x − 3) = 0 <b className="tick t1">✓</b></div>
          <div className="hw l3">x = ½ , x = 3 <b className="tick t2">✓</b></div>
          <div className="hw l4">Q2. a₁₅ = 7 + 14 × 4 = 63 <b className="tick t3">✓</b></div>
          <div className="hw l5">प्र.4 मान लो √2 = p/q <b className="tick t4">✓</b></div>
          <div className="hw l6">p² = 2q² ⇒ p सम <b className="tick t5">✓</b></div>
          <div className="hw l7 red">conclusion missing −½</div>
          <span className="ring" aria-hidden>4½</span>
        </div>
        <div className="pw-panel">
          <div className="pw-total">
            <span className="small muted">Total</span>
            <div><b><CountUp to={16} decimals={0} duration={2200} /></b><span className="muted">/18</span></div>
          </div>
          {RUBRIC.map((r, i) => (
            <div className="rrow" key={r.q} style={{ ["--d" as string]: `${0.9 + i * 0.35}s` }}>
              <div className="rrow-top"><b>{r.q}</b><span className="muted">{r.topic}</span><span className="rscore">{r.got}/{r.max}</span></div>
              <div className="rbar"><i style={{ ["--w" as string]: `${(r.got / r.max) * 100}%` }} /></div>
            </div>
          ))}
          <p className="pw-fb"><b>Feedback.</b> Strong algebra. In proofs, end by stating the contradiction explicitly.</p>
        </div>
      </div>
    </div>
  );
}

function Hero() {
  const [ref, p] = useScrollProgress<HTMLDivElement>();
  const k = Math.min(1, p * 2.2);
  return (
    <section className="hero2">
      <div className="wrap center">
        <p className="eyebrow2 rise" style={{ ["--i" as string]: 0 }}>AI evaluation for schools & coaching institutes</p>
        <h1 className="display rise" style={{ ["--i" as string]: 1 }}>
          Every answer sheet.<br /><span className="grad">Marked by morning.</span>
        </h1>
        <p className="lede rise" style={{ ["--i" as string]: 2 }}>
          Veda Vidya reads handwriting, marks every step against your rubric, and explains each mark - so your teachers can get back to teaching.
        </p>
        <div className="cta-row rise" style={{ ["--i" as string]: 3 }}>
          <Link to="/contact" className="btn btn-primary btn-lg">Book a demo</Link>
          <Link to="/login" className="btn-text">Try the live demo <span aria-hidden>›</span></Link>
        </div>
      </div>
      <div className="wrap hero-stage" ref={ref}>
        <div className="tilt" style={{ transform: `perspective(1600px) rotateX(${(1 - k) * 14}deg) scale(${0.92 + k * 0.08})`, opacity: 0.55 + k * 0.45 }}>
          <HeroWindow />
        </div>
        <div className="glow" aria-hidden />
      </div>
      <div className="wrap boards" data-reveal>
        <span>CBSE</span><span>ICSE</span><span>State Boards</span><span>JEE</span><span>NEET</span><span>UPSC</span><span>CA</span>
      </div>
    </section>
  );
}

/* ---------- Statement: words light up as you scroll ---------- */
const STATEMENT = "Every evening, teachers across India sit with a stack of copies and a red pen. Veda Vidya marks them overnight, step by step, in the language they were written in. Mornings start with answers, not paperwork.";
function Statement() {
  const [ref, p] = useScrollProgress<HTMLDivElement>();
  const words = STATEMENT.split(" ");
  const lit = Math.floor(Math.min(1, Math.max(0, (p - 0.18) / 0.5)) * words.length);
  return (
    <section className="statement" ref={ref}>
      <p className="wrap narrow">
        {words.map((w, i) => <span key={i} className={i < lit ? "on" : ""}>{w} </span>)}
      </p>
    </section>
  );
}

/* ---------- How it works: pinned, three steps ---------- */
const STEPS = [
  { k: "Upload", h: "Snap it or scan it.", t: "Phone photos or a single PDF per student. Any ink, any handwriting, any number of pages." },
  { k: "Read", h: "Read like a teacher.", t: "Handwriting, formulas, diagrams and Hindi are transcribed, then matched line by line to your marking scheme." },
  { k: "Mark", h: "Marked, explained, shared.", t: "Partial credit for every step, feedback for every student, and a report link for every parent." },
];

function StepVisual({ step }: { step: number }) {
  return (
    <div className="sv">
      <div className={`sv-layer ${step === 0 ? "on" : ""}`}>
        <div className="pages">
          {[0, 1, 2].map((i) => <div key={i} className="page" style={{ ["--n" as string]: i }}><span /><span /><span /><span /><span /></div>)}
          <div className="upl"><b>3 pages</b> uploaded · Roll 7</div>
        </div>
      </div>
      <div className={`sv-layer ${step === 1 ? "on" : ""}`}>
        <div className="read">
          <div className="read-sheet">
            <div className="hw">sin θ = 3/5</div>
            <div className="hw">cos θ = √(1 − 9/25) = 4/5</div>
            <div className="hw">tan θ = 3/4</div>
            <i className="box b1" /><i className="box b2" />
          </div>
          <div className="chips">
            <span className="chip2">Uses sin²θ + cos²θ = 1 <b>1/1</b></span>
            <span className="chip2">cos θ = 4/5 <b>1/1</b></span>
            <span className="chip2 warn">tan θ = 3/4 <b>checking…</b></span>
          </div>
        </div>
      </div>
      <div className={`sv-layer ${step === 2 ? "on" : ""}`}>
        <div className="report">
          <div className="report-top"><div><span className="small muted">Unit Test 2</span><b>Reyansh Singh</b></div><div className="big">89<small>%</small></div></div>
          {[["Quadratic equations", 100], ["Trigonometry", 83], ["Real numbers", 90], ["Heights & distances", 80]].map(([t, v]) => (
            <div key={t as string} className="rep-row"><span>{t}</span><div className="rbar"><i style={{ ["--w" as string]: `${v}%` }} /></div><b>{v}%</b></div>
          ))}
          <div className="rep-share">Report link sent to parent · 07:42</div>
        </div>
      </div>
    </div>
  );
}

function HowItWorks() {
  const [ref, p] = useScrollProgress<HTMLElement>("pin");
  const step = Math.min(2, Math.floor(p * 3));
  return (
    <section className="how" id="how" ref={ref}>
      <div className="how-pin">
        <div className="wrap how-grid">
          <div>
            <p className="eyebrow2">How it works</p>
            <h2 className="h2">From a stack of copies to a class report.</h2>
            <ol className="how-steps">
              {STEPS.map((s, i) => (
                <li key={s.k} className={i === step ? "on" : ""}>
                  <span className="how-k">{s.k}</span>
                  <h3>{s.h}</h3>
                  <p>{s.t}</p>
                </li>
              ))}
            </ol>
            <div className="how-progress"><i style={{ transform: `scaleX(${p})` }} /></div>
          </div>
          <StepVisual step={step} />
        </div>
      </div>
    </section>
  );
}

/* ---------- Bento ---------- */
function Bento() {
  return (
    <section className="section2" id="features">
      <div className="wrap">
        <div className="head2" data-reveal>
          <p className="eyebrow2">Everything in one place</p>
          <h2 className="h2">Built for how Indian institutes actually run.</h2>
        </div>
        <div className="bento">
          <article className="tile t-paper" data-reveal>
            <div className="tile-copy"><h3>Question papers in minutes.</h3><p>Pick the board, chapters and pattern. Get original questions with answers, solutions and marking schemes.</p></div>
            <div className="paper-mock">
              <div className="pm-meta"><span className="pill">Physics · Class 11</span><span className="pill">JEE pattern</span><span className="pill ac">+4 / −1</span></div>
              <div className="pm-q"><b>Q14.</b> <Typewriter lines={[
                "A uniform disc rotates freely. If its angular velocity is doubled, its rotational kinetic energy becomes…",
                "Two resistors of 4 Ω and 12 Ω are connected in parallel. The equivalent resistance is…",
                "A projectile is launched at 45°. At the highest point its velocity is…",
              ]} /></div>
              <div className="pm-opts"><span>A. Half</span><span>B. Double</span><span className="ok">C. Four times</span><span>D. Unchanged</span></div>
            </div>
          </article>
          <article className="tile t-lang" data-reveal>
            <div className="tile-copy"><h3>Reads the way students write.</h3><p>English, Hindi, Sanskrit and other Indian scripts.</p></div>
            <div className="scripts" aria-hidden><span>हिन्दी</span><span>English</span><span>संस्कृतम्</span><span>मराठी</span><span>ગુજરાતી</span><span>தமிழ்</span></div>
          </article>
          <article className="tile t-analytics" data-reveal>
            <div className="tile-copy"><h3>See gaps before the exam.</h3><p>Topic mastery for every student, batch and centre.</p></div>
            <div className="bars" aria-hidden>{[48, 63, 77, 88, 71].map((v, i) => <i key={i} style={{ ["--h" as string]: `${v}%`, ["--d" as string]: `${i * 0.08}s` }} />)}</div>
          </article>
          <article className="tile t-cbt dark" data-reveal>
            <div className="tile-copy"><h3>Online tests, scored instantly.</h3><p>Timer, question palette, mark for review.</p></div>
            <div className="palette2" aria-hidden>{Array.from({ length: 24 }, (_, i) => <i key={i} className={i < 15 ? "a" : i === 17 || i === 9 ? "r" : ""} style={{ ["--d" as string]: `${i * 0.04}s` }} />)}</div>
          </article>
          <article className="tile t-review" data-reveal>
            <div className="tile-copy"><h3>Teachers stay in charge.</h3><p>Every mark comes with its reason, and every mark can be changed.</p></div>
            <div className="stepper" aria-hidden><span>Q4 · Proof</span><b className="flip"><em>4</em><em>4.5</em></b><span className="muted">/ 5</span></div>
          </article>
          <article className="tile t-parent" data-reveal>
            <div className="tile-copy"><h3>Parents get the report, not a rumour.</h3><p>A private link per student with marks, rank and what to revise next. No app or login needed.</p></div>
            <div className="phone" aria-hidden>
              <div className="phone-notch" />
              <div className="msg in">Unit Test 2 results for Isha are ready.</div>
              <div className="msg card"><b>Isha Patel · 94%</b><span>Rank 2 of 12 · Revise: Trigonometry</span></div>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

/* ---------- Same-day results ---------- */
function Speed() {
  return (
    <section className="speed dark">
      <div className="wrap">
        <div className="head2" data-reveal>
          <p className="eyebrow2">Feedback while it still matters</p>
          <h2 className="h2">Results the same day.<br /><span className="dim">Not two chapters later.</span></h2>
        </div>
        <div className="race" data-reveal>
          <div className="lane"><span>Checking by hand</span><div className="track"><i className="slow" /></div><b>2–3 weeks</b></div>
          <div className="lane"><span>With Veda Vidya</span><div className="track"><i className="fast" /></div><b>Same day</b></div>
        </div>
        <div className="facts" data-reveal>
          <div><b><CountUp to={4} /></b><span>question types marked: MCQ, numerical, short and long answer</span></div>
          <div><b><CountUp to={3} /></b><span>ways to test: on paper, OMR-style and online</span></div>
          <div><b><CountUp to={100} suffix="%" /></b><span>of marks reviewable and editable by your teachers</span></div>
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="section2">
      <div className="wrap">
        <div className="cta2" data-reveal>
          <div className="cta2-glow" aria-hidden />
          <h2 className="h2">Give your teachers their evenings back.</h2>
          <p>See Veda Vidya mark your own answer sheets in a 20-minute walkthrough.</p>
          <div className="cta-row">
            <Link to="/contact" className="btn btn-light btn-lg">Book a demo</Link>
            <Link to="/login?mode=register" className="btn-text light">Create your institute <span aria-hidden>›</span></Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <main className="home2">
      <Hero />
      <Statement />
      <HowItWorks />
      <Bento />
      <Speed />
      <FinalCta />
    </main>
  );
}
