import { useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CountUp, Typewriter, useScrollProgress } from "../../lib/motion";

const v = (vars: Record<string, string | number>) => vars as CSSProperties;

const Check = () => (
  <svg viewBox="0 0 20 20" className="ico-check" aria-hidden><circle cx="10" cy="10" r="10" /><path d="M5.5 10.5 L8.5 13.5 L14.5 7" /></svg>
);
const Squiggle = () => (
  <svg className="squiggle" viewBox="0 0 300 20" preserveAspectRatio="none" aria-hidden><path d="M3 14 C 50 4, 90 4, 130 11 S 220 18, 297 6" pathLength={1} /></svg>
);

/* ---------- Hero ---------- */
const STUDENTS = [
  { n: "Aarav Sharma", i: "AS", c: "var(--sky)", s: 92 },
  { n: "Isha Patel", i: "IP", c: "var(--coral)", s: 88 },
  { n: "Kabir Singh", i: "KS", c: "var(--lilac)", s: 74 },
  { n: "Diya Mehta", i: "DM", c: "var(--gold)", s: 81 },
];

function HeroScene() {
  const [ref, p] = useScrollProgress<HTMLDivElement>();
  return (
    <div className="scene" ref={ref} style={v({ "--p": p.toFixed(3) })} aria-label="Veda Vidya marking a class's answer sheets">
      <span className="blob b1" aria-hidden />
      <span className="blob b2" aria-hidden />
      <span className="blob b3" aria-hidden />

      <div className="s-card main pop" style={v({ "--i": 0 })}>
        <div className="mc-head">
          <div><b>Unit Test 2</b><span>Class 10 · Mathematics</span></div>
          <span className="tag">Marking…</span>
        </div>
        <div className="mc-progress"><i /></div>
        <p className="mc-sub"><CountUp to={18} duration={2600} /> of 24 copies marked</p>
        <ul className="mc-list">
          {STUDENTS.map((s, k) => (
            <li key={s.n} style={v({ "--d": `${0.7 + k * 0.18}s` })}>
              <span className="av" style={{ background: s.c }}>{s.i}</span>
              <span className="nm">{s.n}</span>
              <span className="meter"><i style={v({ "--w": `${s.s}%` })} /></span>
              <b>{s.s}%</b>
            </li>
          ))}
        </ul>
      </div>

      <div className="float f-paper pop" style={v({ "--i": 2, "--depth": -60 })}>
        <div className="hand">
          <p>tan θ = 3/4 <span className="tick">✓</span></p>
          <p>a₁₅ = 63 <span className="tick">✓✓</span></p>
          <p>p² = 2q² ⇒ p सम <span className="tick">✓</span></p>
        </div>
      </div>
      <div className="float f-sticker pop" style={v({ "--i": 3, "--depth": 50 })}>
        <span>Q4 · Proof</span><b>4.5<small>/5</small></b><em>step-wise</em>
      </div>
      <div className="float f-toast pop" style={v({ "--i": 4, "--depth": 90 })}>
        <span className="dot-ok"><Check /></span>
        <div><b>Report sent</b><span>to Isha's parents · 7:42 am</span></div>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="hero4">
      <div className="wrap hero4-grid">
        <div className="hero4-copy">
          <span className="pill-badge glide" style={v({ "--i": 0 })}><span className="spark" />New: marking in हिंदी and English</span>
          <h1 className="h-hero glide" style={v({ "--i": 1 })}>
            Marking made <span className="u">easy<Squiggle /></span>, so teachers can teach.
          </h1>
          <p className="lead glide" style={v({ "--i": 2 })}>
            Snap photos of your students' answer sheets. Veda Vidya marks every step, writes helpful feedback, and shares results the same day.
          </p>
          <div className="actions glide" style={v({ "--i": 3 })}>
            <Link to="/contact" className="btn btn-primary btn-lg">Book a free demo</Link>
            <Link to="/login" className="btn btn-soft btn-lg">Try it now</Link>
          </div>
          <ul className="trust glide" style={v({ "--i": 4 })}>
            <li><Check />CBSE, ICSE, State boards, JEE, NEET</li>
            <li><Check />Teachers approve every mark</li>
          </ul>
        </div>
        <HeroScene />
      </div>
    </section>
  );
}

/* ---------- How it works ---------- */
const STEPS = [
  { t: "Snap or scan", d: "Take phone photos of each answer sheet, or upload a PDF. Any handwriting works.", c: "sky", art: "upload" },
  { t: "We mark it", d: "Every answer is read and marked step by step against your marking scheme.", c: "gold", art: "mark" },
  { t: "Everyone knows", d: "Teachers approve, then students and parents get their reports the same day.", c: "coral", art: "share" },
];

function StepArt({ kind }: { kind: string }) {
  if (kind === "upload") return (
    <div className="art art-upload" aria-hidden>
      <div className="phone-s"><div className="viewfinder"><i /><i /><i /><i /><span className="lines" /></div><b className="shutter" /></div>
    </div>
  );
  if (kind === "mark") return (
    <div className="art art-mark" aria-hidden>
      <div className="mini-sheet hand"><p>x = ½ , 3 <span className="tick">✓</span></p><p>cos θ = 4/5 <span className="tick">✓</span></p><p className="red">−½ show step</p></div>
    </div>
  );
  return (
    <div className="art art-share" aria-hidden>
      <div className="report-s"><b>94%</b><span>Isha · Unit Test 2</span><div className="rs-bars"><i /><i /><i /></div></div>
    </div>
  );
}

function HowItWorks() {
  const [ref, p] = useScrollProgress<HTMLDivElement>();
  return (
    <section className="section4" id="how">
      <div className="wrap">
        <div className="head4" data-reveal>
          <span className="kicker">How it works</span>
          <h2 className="h-sec">Three steps. That's it.</h2>
          <p className="lead center">No new hardware, no training days. If your teachers can take a photo, they can use Veda Vidya.</p>
        </div>
        <div className="steps4" ref={ref}>
          <svg className="path4" viewBox="0 0 1000 60" preserveAspectRatio="none" aria-hidden>
            <path d="M80 30 C 260 -10, 330 70, 500 30 S 760 -10, 920 30" pathLength={1} style={{ strokeDashoffset: Math.max(0, 1 - Math.min(1, (p - 0.15) * 2.4)) }} />
          </svg>
          {STEPS.map((s, i) => (
            <article key={s.t} className={`step4 c-${s.c}`} data-reveal style={v({ transitionDelay: `${i * 0.12}s` })}>
              <span className="num">{i + 1}</span>
              <StepArt kind={s.art} />
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- Feature rows ---------- */
function Feature({ kicker, title, text, points, tone, flip, children, id }: { kicker: string; title: string; text: string; points: string[]; tone: string; flip?: boolean; children: ReactNode; id?: string }) {
  return (
    <div className={`feat ${flip ? "flip" : ""}`} id={id}>
      <div className="feat-copy" data-reveal>
        <span className="kicker">{kicker}</span>
        <h3 className="h-feat">{title}</h3>
        <p className="lead">{text}</p>
        <ul className="ticks">{points.map((x) => <li key={x}><Check />{x}</li>)}</ul>
      </div>
      <div className={`feat-visual tone-${tone}`} data-reveal>
        <span className="fv-blob" aria-hidden />
        {children}
      </div>
    </div>
  );
}

function Features() {
  return (
    <section className="section4 tinted" id="features">
      <div className="wrap">
        <div className="head4" data-reveal>
          <span className="kicker">Everything in one place</span>
          <h2 className="h-sec">One app for marking, papers and progress.</h2>
        </div>

        <Feature id="evaluate" kicker="Smart marking" tone="mint" title="Marks every step, not just the answer."
          text="Partial credit works just like it does with your best teacher. Each mark comes with a short reason, so students know exactly what to fix."
          points={["Reads English, Hindi and Sanskrit handwriting", "Follows your own marking scheme", "Flags unclear writing for a teacher to check"]}>
          <div className="ui-card rubric">
            <div className="ui-head"><b>Q4 · Prove √2 is irrational</b><span className="score-chip">4.5 / 5</span></div>
            {[["Assumes √2 = p/q in lowest terms", "1/1"], ["Shows p² = 2q², so p is even", "1.5/1.5"], ["Shows q is also even", "1.5/1.5"], ["States the contradiction", "0.5/1"]].map(([s, m], i) => (
              <div key={s} className="rub-row" style={v({ "--d": `${0.2 + i * 0.15}s` })}><span className={`rdot ${m.startsWith("0.5") ? "half" : ""}`} />{s}<b>{m}</b></div>
            ))}
            <p className="fb">Great proof! Finish by clearly stating the contradiction.</p>
          </div>
        </Feature>

        <Feature id="papers" kicker="Question papers" tone="sun" flip title="A fresh question paper in minutes."
          text="Pick the board, class, chapters and pattern. Get an original paper with answers, solutions and a marking scheme, ready to print or use online."
          points={["CBSE, ICSE, JEE, NEET and more", "Choose difficulty, marks and sections", "Edit anything before you print"]}>
          <div className="ui-card paper4">
            <div className="ui-head"><b>Physics · Class 11</b><span className="score-chip soft">JEE pattern</span></div>
            <p className="q"><b>Q14.</b> <Typewriter lines={[
              "A uniform disc rotates freely. If its angular velocity is doubled, its kinetic energy becomes…",
              "Two resistors of 4 Ω and 12 Ω are joined in parallel. The equivalent resistance is…",
            ]} /></p>
            <div className="opts4"><span>Half</span><span>Double</span><span className="ok">Four times</span><span>Same</span></div>
          </div>
        </Feature>

        <Feature id="insight" kicker="Progress tracking" tone="lilac" title="See who needs help, before the exam."
          text="Every marked sheet updates each student's progress, chapter by chapter, so teachers can focus revision where it counts."
          points={["Reports for every student, batch and centre", "Weak chapters highlighted automatically", "Share reports with parents in one tap"]}>
          <div className="ui-card chart4">
            <div className="ui-head"><b>Class 10-A · chapters</b><span className="score-chip">↑ 14% this month</span></div>
            <div className="cbars">
              {[["Trig", 46, "coral"], ["AP", 81, "teal"], ["Quad", 74, "teal"], ["Real", 88, "teal"], ["H&D", 58, "gold"]].map(([l, h, c], i) => (
                <div key={l as string} className="cb"><i className={`c-${c}`} style={v({ "--h": `${h}%`, "--d": `${i * 0.1}s` })}><em>{h}%</em></i><span>{l}</span></div>
              ))}
            </div>
          </div>
        </Feature>

        <Feature kicker="Online tests" tone="sky" flip title="Tests on any phone, scored instantly."
          text="Run timed mock tests online with a question palette and mark-for-review, just like the real exam. Scores and rankings are ready the moment time is up."
          points={["Works on phones and computers", "Negative marking supported", "Instant scores and rank lists"]}>
          <div className="ui-card cbt4">
            <div className="ui-head"><b>JEE Mock · Physics</b><span className="timer4">⏱ 01:42:04</span></div>
            <div className="pal4">{Array.from({ length: 30 }, (_, i) => <i key={i} className={i < 17 ? "a" : i === 19 || i === 8 ? "r" : i === 21 ? "c" : ""} style={v({ "--d": `${i * 0.03}s` })}>{i + 1}</i>)}</div>
            <div className="legend"><span><i className="a" />Answered</span><span><i className="r" />Review</span><span><i />Not visited</span></div>
          </div>
        </Feature>
      </div>
    </section>
  );
}

/* ---------- Numbers band ---------- */
function Numbers() {
  return (
    <section className="numbers4">
      <svg className="wave top" viewBox="0 0 1440 60" preserveAspectRatio="none" aria-hidden><path d="M0 60 V30 C 240 0, 480 0, 720 26 S 1200 56, 1440 20 V60 Z" /></svg>
      <div className="wrap nums" data-reveal>
        <div><b>Same day</b><span>results instead of weeks</span></div>
        <div><b><CountUp to={4} /></b><span>question types marked: MCQ, numerical, short and long answers</span></div>
        <div><b><CountUp to={3} /></b><span>ways to test: paper, OMR and online</span></div>
        <div><b><CountUp to={100} suffix="%" /></b><span>of marks approved by your teachers</span></div>
      </div>
      <svg className="wave bottom" viewBox="0 0 1440 60" preserveAspectRatio="none" aria-hidden><path d="M0 0 V30 C 240 60, 480 60, 720 34 S 1200 4, 1440 40 V0 Z" /></svg>
    </section>
  );
}

/* ---------- Audience tabs ---------- */
const AUDIENCE = [
  { k: "Teachers", c: "teal", h: "Get your evenings back.", pts: ["Upload a class's sheets in minutes", "Review and adjust any mark", "Create the next test paper in minutes"] },
  { k: "Owners & admins", c: "gold", h: "See every centre at a glance.", pts: ["Results across batches and branches", "Know which teachers and topics need support", "Professional reports that impress parents"] },
  { k: "Students", c: "sky", h: "Know exactly what to fix.", pts: ["Clear feedback on every answer", "Practice tests on their phone", "Progress they can see improving"] },
  { k: "Parents", c: "coral", h: "Stay in the loop, effortlessly.", pts: ["A report link you can share on WhatsApp", "Marks, rank and what to revise", "No app or login needed"] },
];
function Audience() {
  const [tab, setTab] = useState(0);
  return (
    <section className="section4">
      <div className="wrap">
        <div className="head4" data-reveal>
          <span className="kicker">Made for everyone</span>
          <h2 className="h-sec">Helpful for your whole institute.</h2>
        </div>
        <div className="tabs4" role="tablist" data-reveal>
          {AUDIENCE.map((a, i) => <button key={a.k} role="tab" aria-selected={tab === i} className={tab === i ? "on" : ""} onClick={() => setTab(i)}>{a.k}</button>)}
        </div>
        <div className="aud-stage" data-reveal>
          {AUDIENCE.map((a, i) => (
            <div key={a.k} className={`aud c-${a.c} ${tab === i ? "on" : ""}`} aria-hidden={tab !== i}>
              <h3 className="h-feat">{a.h}</h3>
              <ul className="ticks big">{a.pts.map((x) => <li key={x}><Check />{x}</li>)}</ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- FAQ ---------- */
const FAQ = [
  ["Can it really read handwriting?", "Yes, including Hindi and Sanskrit. If a word is hard to read, Veda Vidya flags it so a teacher can take a quick look before marks are final."],
  ["Will it replace our teachers?", "No. It does the slow, repetitive checking. Teachers review every mark, change anything they disagree with, and approve results before students see them."],
  ["Which boards and exams does it support?", "CBSE, ICSE and state boards, plus competitive exams like JEE, NEET, UPSC and CA. You can also use your own marking scheme."],
  ["Do students need to install an app?", "No. Online tests work in any phone browser, and parents receive a simple report link."],
  ["Who can see our answer sheets and results?", "Only your institute's staff. Each student and parent sees only their own report."],
];
function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="section4 tinted">
      <div className="wrap faq-grid">
        <div className="head4 left" data-reveal>
          <span className="kicker">Questions</span>
          <h2 className="h-sec">Good questions.</h2>
          <p className="lead">Anything else? <Link to="/contact" className="inline-link">Ask us directly</Link>.</p>
        </div>
        <div className="faq" data-reveal>
          {FAQ.map(([q, a], i) => (
            <div key={q} className={`qa ${open === i ? "on" : ""}`}>
              <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>{q}<span className="pm" aria-hidden /></button>
              <div className="ans"><div><p>{a}</p></div></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Cta() {
  return (
    <section className="section4">
      <div className="wrap">
        <div className="cta4" data-reveal>
          <span className="cblob c1" aria-hidden /><span className="cblob c2" aria-hidden /><span className="cblob c3" aria-hidden />
          <h2 className="h-sec">Ready to make marking easy?</h2>
          <p>See Veda Vidya mark your own answer sheets in a friendly 20-minute call.</p>
          <div className="actions center">
            <Link to="/contact" className="btn btn-white btn-lg">Book a free demo</Link>
            <Link to="/login?mode=register" className="btn btn-ghost-white btn-lg">Create your institute</Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <main className="home4">
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
