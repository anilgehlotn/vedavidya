import { useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CountUp, Typewriter } from "../../lib/motion";

const v = (vars: Record<string, string | number>) => vars as CSSProperties;

/* ---------- Hero ---------- */
const STUDENTS = [
  { n: "Aarav Sharma", s: 92 },
  { n: "Isha Patel", s: 88 },
  { n: "Kabir Singh", s: 74 },
  { n: "Diya Mehta", s: 81 },
];

function HeroVisual() {
  return (
    <div className="hv" aria-label="A class's answer sheets being marked">
      <div className="hv-card glide" style={v({ "--i": 3 })}>
        <div className="hv-head">
          <div><b>Unit Test 2</b><span>Class 10 · Mathematics</span></div>
          <span className="muted small"><CountUp to={18} duration={2400} /> of 24 marked</span>
        </div>
        <ul>
          {STUDENTS.map((s, k) => (
            <li key={s.n} style={v({ "--d": `${0.8 + k * 0.15}s` })}>
              <span>{s.n}</span>
              <span className="bar5"><i style={v({ "--w": `${s.s}%` })} /></span>
              <b>{s.s}%</b>
            </li>
          ))}
        </ul>
      </div>
      <div className="hv-note hand glide" style={v({ "--i": 5 })}>
        <p>tan θ = 3/4 <span className="tick">✓</span></p>
        <p>a₁₅ = 7 + 14 × 4 = 63 <span className="tick">✓</span></p>
        <p className="red">show the last step, −½</p>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="hero5">
      <div className="wrap hero5-grid">
        <div>
          <h1 className="h-hero glide" style={v({ "--i": 0 })}>Marking made easy, so teachers can teach.</h1>
          <p className="lead glide" style={v({ "--i": 1 })}>
            Take photos of your students' answer sheets. Veda Vidya marks every step, writes short feedback, and your teachers approve the results the same day.
          </p>
          <div className="actions glide" style={v({ "--i": 2 })}>
            <Link to="/contact" className="btn btn-primary btn-lg">Book a free demo</Link>
            <Link to="/login" className="text-link">Try the demo →</Link>
          </div>
          <p className="fine glide" style={v({ "--i": 3 })}>Works with CBSE, ICSE, state boards, JEE and NEET papers, in English and Hindi.</p>
        </div>
        <HeroVisual />
      </div>
    </section>
  );
}

/* ---------- How it works ---------- */
const STEPS = [
  ["Take photos", "Snap each answer sheet with a phone, or upload a scanned PDF. Any handwriting is fine."],
  ["We mark them", "Each answer is read and marked step by step, using your own marking scheme."],
  ["You approve", "Teachers check the marks, change anything they want, and share reports with students and parents."],
];
function HowItWorks() {
  return (
    <section className="sec5" id="how">
      <div className="wrap">
        <h2 className="h-sec" data-reveal>How it works</h2>
        <ol className="steps5">
          {STEPS.map(([h, t], i) => (
            <li key={h} data-reveal style={v({ transitionDelay: `${i * 0.1}s` })}>
              <span className="n">{i + 1}</span>
              <h3>{h}</h3>
              <p>{t}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---------- Features ---------- */
function Feature({ title, text, points, flip, id, children }: { title: string; text: string; points: string[]; flip?: boolean; id?: string; children: ReactNode }) {
  return (
    <div className={`feat5 ${flip ? "flip" : ""}`} id={id}>
      <div data-reveal>
        <h3 className="h-feat">{title}</h3>
        <p className="lead">{text}</p>
        <ul className="dots">{points.map((x) => <li key={x}>{x}</li>)}</ul>
      </div>
      <div className="panel5" data-reveal>{children}</div>
    </div>
  );
}

function Features() {
  return (
    <section className="sec5 soft" id="features">
      <div className="wrap">
        <h2 className="h-sec" data-reveal>What you can do with it</h2>

        <Feature id="evaluate" title="Mark handwritten answers, step by step"
          text="Students get partial marks for every correct step, just like with a good teacher, and a short note on what they missed."
          points={["Reads English, Hindi and Sanskrit", "Follows your marking scheme", "Unclear writing is flagged for a teacher"]}>
          <div className="ui5">
            <div className="ui5-head"><b>Q4. Prove √2 is irrational</b><span className="chip5">4.5 / 5</span></div>
            {[["Assumes √2 = p/q in lowest terms", "1 / 1"], ["Shows p² = 2q², so p is even", "1.5 / 1.5"], ["Shows q is also even", "1.5 / 1.5"], ["States the contradiction", "0.5 / 1"]].map(([s, m], i) => (
              <div key={s} className="row5" style={v({ "--d": `${0.2 + i * 0.12}s` })}><span>{s}</span><b>{m}</b></div>
            ))}
            <p className="note5">Good proof. End by clearly stating the contradiction.</p>
          </div>
        </Feature>

        <Feature id="papers" flip title="Make a question paper in minutes"
          text="Choose the board, class, chapters and pattern. You get a new paper with answers, solutions and a marking scheme, ready to edit and print."
          points={["CBSE, ICSE, JEE, NEET and more", "Set difficulty, marks and sections", "Edit any question before printing"]}>
          <div className="ui5">
            <div className="ui5-head"><b>Physics · Class 11</b><span className="chip5 grey">JEE pattern</span></div>
            <p className="q5"><b>Q14.</b> <Typewriter lines={[
              "A uniform disc rotates freely. If its angular velocity is doubled, its kinetic energy becomes…",
              "Two resistors of 4 Ω and 12 Ω are joined in parallel. The equivalent resistance is…",
            ]} /></p>
            <div className="opts5"><span>Half</span><span>Double</span><span className="ok">Four times</span><span>Same</span></div>
          </div>
        </Feature>

        <Feature id="insight" title="See who needs help, chapter by chapter"
          text="Every marked sheet updates each student's progress, so teachers know where to spend revision time before the exam."
          points={["Reports for each student, batch and centre", "Weak chapters are easy to spot", "Share a report link with parents"]}>
          <div className="ui5">
            <div className="ui5-head"><b>Class 10-A · chapters</b><span className="muted small">last 4 tests</span></div>
            {([["Trigonometry", 46], ["Heights & distances", 58], ["Quadratic equations", 74], ["Real numbers", 88]] as [string, number][]).map(([t, p], i) => (
              <div key={t} className={`hbar ${p < 50 ? "low" : ""}`} style={v({ "--w": `${p}%`, "--d": `${0.2 + i * 0.1}s` })}>
                <span>{t}</span><span className="bar5"><i /></span><b>{p}%</b>
              </div>
            ))}
          </div>
        </Feature>

        <Feature flip title="Run online tests on any phone"
          text="Timed mock tests with a question palette and mark-for-review, like the real exam. Scores and ranks are ready as soon as time is up."
          points={["Works on phones and computers", "Negative marking supported", "Instant scores and rank lists"]}>
          <div className="ui5">
            <div className="ui5-head"><b>JEE Mock · Physics</b><span className="muted small">01:42:04 left</span></div>
            <div className="pal5">{Array.from({ length: 30 }, (_, i) => <i key={i} className={i < 17 ? "a" : i === 19 || i === 8 ? "r" : ""} style={v({ "--d": `${i * 0.025}s` })}>{i + 1}</i>)}</div>
            <p className="muted small">17 answered · 2 marked for review · 11 left</p>
          </div>
        </Feature>
      </div>
    </section>
  );
}

/* ---------- Numbers ---------- */
function Numbers() {
  return (
    <section className="sec5 tight">
      <div className="wrap nums5" data-reveal>
        <div><b>Same day</b><span>results, instead of weeks</span></div>
        <div><b><CountUp to={4} /></b><span>question types: MCQ, numerical, short and long answers</span></div>
        <div><b><CountUp to={3} /></b><span>ways to test: on paper, OMR and online</span></div>
        <div><b><CountUp to={100} suffix="%" /></b><span>of marks checked by your teachers</span></div>
      </div>
    </section>
  );
}

/* ---------- Audience ---------- */
const AUDIENCE = [
  { k: "Teachers", h: "Get your evenings back.", pts: ["Upload a class's sheets in a few minutes", "Review and change any mark", "Make the next test paper in minutes"] },
  { k: "Owners", h: "See every batch and centre in one place.", pts: ["Results across batches and branches", "Know which topics need more teaching", "Clear reports to share with parents"] },
  { k: "Students", h: "Know exactly what to fix.", pts: ["Feedback on every answer", "Practice tests on their phone", "Progress they can see"] },
  { k: "Parents", h: "Stay informed without chasing anyone.", pts: ["A report link you can open on WhatsApp", "Marks, rank and what to revise", "No app or login needed"] },
];
function Audience() {
  const [tab, setTab] = useState(0);
  const a = AUDIENCE[tab];
  return (
    <section className="sec5">
      <div className="wrap">
        <h2 className="h-sec" data-reveal>Useful for everyone at your institute</h2>
        <div className="tabs5" role="tablist" data-reveal>
          {AUDIENCE.map((x, i) => <button key={x.k} role="tab" aria-selected={tab === i} className={tab === i ? "on" : ""} onClick={() => setTab(i)}>{x.k}</button>)}
        </div>
        <div className="aud5" key={a.k}>
          <h3 className="h-feat">{a.h}</h3>
          <ul className="dots">{a.pts.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      </div>
    </section>
  );
}

/* ---------- FAQ ---------- */
const FAQ = [
  ["Can it really read handwriting?", "Yes, including Hindi and Sanskrit. If a word is hard to read, it is flagged so a teacher can check it before marks are final."],
  ["Will it replace our teachers?", "No. It does the slow, repetitive checking. Teachers review every mark, change anything they disagree with, and approve results before students see them."],
  ["Which boards and exams does it support?", "CBSE, ICSE and state boards, plus JEE, NEET, UPSC and CA. You can also use your own marking scheme."],
  ["Do students need to install an app?", "No. Online tests open in any phone browser, and parents get a simple report link."],
  ["Who can see our answer sheets and results?", "Only your institute's staff. Each student and parent sees only their own report."],
];
function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="sec5 soft">
      <div className="wrap faq5">
        <div data-reveal>
          <h2 className="h-sec">Questions</h2>
          <p className="lead">Something else? <Link to="/contact" className="text-link">Ask us</Link>.</p>
        </div>
        <div data-reveal>
          {FAQ.map(([q, ans], i) => (
            <div key={q} className={`qa5 ${open === i ? "on" : ""}`}>
              <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>{q}<span aria-hidden>{open === i ? "−" : "+"}</span></button>
              <div className="ans5"><div><p>{ans}</p></div></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Cta() {
  return (
    <section className="sec5">
      <div className="wrap">
        <div className="cta5" data-reveal>
          <div>
            <h2 className="h-sec">Try it with your own answer sheets.</h2>
            <p>Book a free 20-minute demo. Bring a few copies and watch them get marked.</p>
          </div>
          <div className="actions">
            <Link to="/contact" className="btn btn-white btn-lg">Book a free demo</Link>
            <Link to="/login?mode=register" className="text-link light">Create your institute →</Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <main className="home5">
      <Hero />
      <HowItWorks />
      <Features />
      <Numbers />
      <Audience />
      <Faq />
      <Cta />
    </main>
  );
}
