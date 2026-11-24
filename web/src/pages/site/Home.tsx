import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CountUp, prefersReducedMotion } from "../../lib/motion";

const v = (vars: Record<string, string | number>) => vars as CSSProperties;

/* ---------- Small pieces ---------- */
const Avatar = ({ initials, tone }: { initials: string; tone: string }) => <span className={`ava t-${tone}`}>{initials}</span>;
const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" className="ic" aria-hidden><path d={d} /></svg>
);
const I = {
  clock: "M12 7v5l3 2M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18",
  cal: "M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1",
  check: "M8 12.5l2.5 2.5L16 9.5M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0",
  head: "M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v5H5a1 1 0 0 1-1-1zM20 14h-3v5h2a1 1 0 0 0 1-1z",
  send: "M4 12l16-8-6 16-2.5-6.5z",
  chev: "M9 6l6 6-6 6",
  back: "M15 6l-6 6 6 6",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8a4 4 0 0 0 0 8",
  spark: "M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z",
  share: "M7 12a3 3 0 1 1 0-.1M17 6a3 3 0 1 1 0-.1M17 18a3 3 0 1 1 0-.1M9.7 10.6l4.6-2.8M9.7 13.4l4.6 2.8",
  paper: "M7 3h7l4 4v14H7zM14 3v4h4M10 12h6M10 16h6",
  chart: "M5 20V10M12 20V4M19 20v-7",
  phone: "M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1M11 18h2",
};

/* Pink liquid-glass art, drawn with CSS so it can slowly move. */
const Glass = ({ className = "" }: { className?: string }) => (
  <div className={`glass ${className}`} aria-hidden><i className="gl1" /><i className="gl2" /><i className="gl3" /><i className="gl4" /></div>
);

function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) { setSeen(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, seen] as const;
}

/* ---------- Dashboard preview (the reference layout) ---------- */
function StatisticCard() {
  return (
    <section className="tile stat-tile pop" style={v({ "--i": 1 })}>
      <div className="tile-head"><h3>Statistic</h3><span className="chip-btn">View all</span></div>
      <div className="me">
        <div className="ring">
          <svg viewBox="0 0 120 120" aria-hidden><circle cx="60" cy="60" r="54" className="track" /><circle cx="60" cy="60" r="54" className="arc" pathLength={100} /></svg>
          <span className="ava big t-sun">PN</span>
          <span className="role">Teacher</span>
        </div>
        <p className="hello">Welcome, Priya <span className="wave">👋</span></p>
      </div>
      <div className="big-stat"><b><CountUp to={78} duration={1800} />%</b><span>of this month's copies<br />already marked</span></div>
      <div className="tri">
        {[["42%", "pink", 42], ["15%", "sun", 15], ["56%", "coral", 56]].map(([l, c, w], i) => (
          <div key={l as string} style={v({ "--w": `${w}%`, "--d": `${0.9 + i * 0.12}s` })}><i className={`t-${c}`} /><span>{l}</span></div>
        ))}
      </div>
      <div className="mini3">
        <div><span className="ic-dot t-pink"><Icon d={I.clock} /></span><b><CountUp to={9} /></b><span>Being marked</span></div>
        <div><span className="ic-dot t-sun"><Icon d={I.cal} /></span><b><CountUp to={4} /></b><span>To review</span></div>
        <div><span className="ic-dot t-coral"><Icon d={I.check} /></span><b><CountUp to={15} /></b><span>Published</span></div>
      </div>
    </section>
  );
}

const TESTS = [
  { t: "Unit Test 2 · Maths", tags: ["Class 10", "24 copies"], p: 46, who: "Meera Iyer", ini: "MI", tone: "pink" },
  { t: "Weekly Test 3 · Physics", tags: ["24 copies", "JEE"], p: 72, who: "Rahul Verma", ini: "RV", tone: "sky" },
  { t: "Chemistry Quiz", tags: ["Class 11", "36 copies"], p: 56, who: "Arjun Rao", ini: "AR", tone: "sun" },
  { t: "English Essay", tags: ["Class 9", "40 copies"], p: 88, who: "Sara Khan", ini: "SK", tone: "lilac" },
  { t: "Biology Mock", tags: ["NEET", "52 copies"], p: 31, who: "Dev Nair", ini: "DN", tone: "coral" },
];
function TestsCard() {
  const [start, setStart] = useState(0);
  const max = TESTS.length - 3;
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const t = setInterval(() => setStart((s) => (s >= max ? 0 : s + 1)), 4200);
    return () => clearInterval(t);
  }, []);
  return (
    <section className="tile coral-tile pop" style={v({ "--i": 2 })}>
      <div className="tile-head">
        <h3 className="h-coral">Your tests</h3>
        <div className="row-btns">
          <span className="arrows"><button aria-label="Previous" onClick={() => setStart(Math.max(0, start - 1))}><Icon d={I.back} /></button><button aria-label="Next" onClick={() => setStart(Math.min(max, start + 1))}><Icon d={I.chev} /></button></span>
          <span className="chip-btn white">View all</span>
        </div>
      </div>
      <div className="carousel">
        <div className="track3" style={{ transform: `translateX(calc(${-start} * (100% + 14px) / 3))` }}>
          {TESTS.map((x, i) => (
            <article key={x.t} className="test" style={v({ "--d": `${0.5 + i * 0.1}s` })}>
              <h4>{x.t}</h4>
              <div className="tags">{x.tags.map((g) => <span key={g}>{g}</span>)}</div>
              <div className="pct"><b>{x.p}%</b> marked</div>
              <div className="pbar"><i style={v({ "--w": `${x.p}%` })} /></div>
              <div className="who"><Avatar initials={x.ini} tone={x.tone} /><div><span>Teacher</span><b>{x.who}</b></div></div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

const BARS = [["Algebra", 66], ["Geometry", 40], ["Trigonometry", 87], ["Statistics", 56]] as const;
function ProgressCard() {
  return (
    <section className="tile pop" style={v({ "--i": 3 })}>
      <div className="tile-head"><h3>Class progress</h3><span className="chip-btn">This week <Icon d="M7 10l5 5 5-5" /></span></div>
      <div className="cols">
        {BARS.map(([l, h], i) => (
          <div key={l} className="col">
            <div className="well"><i className={h === 87 ? "hot" : ""} style={v({ "--h": `${h}%`, "--d": `${0.8 + i * 0.12}s` })}><em className={h === 87 ? "dark" : ""}>{h}%</em></i></div>
            <span>{l}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

const QUESTIONS = ["Which students struggled with Q4?", "Make a 20-mark test on Trigonometry", "Summarise Class 10's weak chapters", "Draft a note for Kabir's parents"];
function AssistantCard() {
  const [qi, setQi] = useState(0);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion()) { setN(QUESTIONS[0].length); return; }
    const q = QUESTIONS[qi];
    const t = n < q.length ? setTimeout(() => setN(n + 1), 45) : setTimeout(() => { setQi((qi + 1) % QUESTIONS.length); setN(0); }, 2200);
    return () => clearTimeout(t);
  }, [n, qi]);
  return (
    <section className="tile ai-tile pop" style={v({ "--i": 4 })}>
      <Glass />
      <div className="ai-top"><span className="chip-btn white"><Icon d={I.refresh} /> Model</span><span className="dot-btn">•••</span></div>
      <div className="ai-box">
        <h3>AI assistant</h3>
        <div className="ask"><span>{QUESTIONS[qi].slice(0, n)}<i className="caret" /></span><span className="send"><Icon d={I.send} /></span></div>
      </div>
    </section>
  );
}

function DashboardPreview() {
  return (
    <div className="frame" aria-label="Veda Vidya dashboard preview">
      <div className="fnav pop" style={v({ "--i": 0 })}>
        <span className="flogo"><span className="mini-logo" />Veda Vidya</span>
        <div className="pills"><span>All tests</span><span className="on"><Icon d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" /> Dashboard</span><span>Statistic</span><span>AI assistant</span><span>Support</span></div>
        <div className="fright"><span className="round"><Icon d={I.head} /></span><span className="round notif"><Icon d={I.bell} /></span><span className="ava t-sun">PN</span></div>
      </div>
      <div className="bento">
        <StatisticCard />
        <TestsCard />
        <ProgressCard />
        <AssistantCard />
      </div>
    </div>
  );
}

/* ---------- Page sections ---------- */
function Hero() {
  return (
    <section className="hero6">
      <div className="wrap6 center6">
        <span className="hello-chip rise" style={v({ "--i": 0 })}><span className="spark-dot" /> AI marking for schools & coaching institutes</span>
        <h1 className="h-hero6 rise" style={v({ "--i": 1 })}>Marking made <span className="coral-word">easy</span>,<br />so teachers can teach.</h1>
        <p className="lead6 rise" style={v({ "--i": 2 })}>Snap photos of answer sheets. Veda Vidya marks every step, writes feedback, and gives you a live view of every class.</p>
        <div className="actions6 rise" style={v({ "--i": 3 })}>
          <Link to="/contact" className="btn6 dark">Book a free demo</Link>
          <Link to="/login" className="btn6 light">Try the dashboard <Icon d={I.chev} /></Link>
        </div>
      </div>
      <div className="wrap6 preview-wrap"><DashboardPreview /></div>
    </section>
  );
}

function SectionHead({ chip, title, text }: { chip: string; title: ReactNode; text?: string }) {
  return (
    <div className="shead" data-reveal>
      <span className="chip6">{chip}</span>
      <h2 className="h-sec6">{title}</h2>
      {text && <p className="lead6">{text}</p>}
    </div>
  );
}

const STEPS = [
  { t: "Snap or scan", d: "Take phone photos of each answer sheet, or upload a PDF. Any handwriting works.", ic: I.camera, tone: "pink" },
  { t: "AI marks it", d: "Every answer is read and marked step by step, using your own marking scheme.", ic: I.spark, tone: "sun" },
  { t: "Approve & share", d: "Teachers check the marks, then students and parents get reports the same day.", ic: I.share, tone: "coral" },
];
function HowItWorks() {
  return (
    <section className="sec6" id="how">
      <div className="wrap6">
        <SectionHead chip="How it works" title="Three simple steps" />
        <div className="frame soft">
          <div className="grid3">
            {STEPS.map((s, i) => (
              <article key={s.t} className="tile step6" data-reveal style={v({ transitionDelay: `${i * 0.1}s` })}>
                <div className="tile-head"><span className={`ic-dot lg t-${s.tone}`}><Icon d={s.ic} /></span><span className="stepno">0{i + 1}</span></div>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Features() {
  const [ref, seen] = useInView<HTMLDivElement>();
  return (
    <section className="sec6" id="features">
      <div className="wrap6">
        <SectionHead chip="Features" title="Everything your institute needs" text="Marking, question papers, progress tracking and online tests, in one simple app." />
        <div className={`frame soft feat-grid ${seen ? "go" : ""}`} ref={ref}>
          <article className="tile f-mark" data-reveal>
            <div className="tile-head"><h3>Step-wise marking</h3><span className="ic-dot t-pink"><Icon d={I.check} /></span></div>
            <p>Partial marks for every correct step, with a short note on what was missed.</p>
            <div className="rubric6">
              {[["Assumes √2 = p/q", "1/1"], ["Shows p is even", "1.5/1.5"], ["Shows q is even", "1.5/1.5"], ["States contradiction", "0.5/1"]].map(([s, m], i) => (
                <div key={s} style={v({ "--d": `${0.3 + i * 0.12}s` })}><span>{s}</span><b className={m.startsWith("0.5") ? "half" : ""}>{m}</b></div>
              ))}
            </div>
          </article>
          <article className="tile coral-tile f-paper" data-reveal>
            <div className="tile-head"><h3 className="h-coral">Question papers in minutes</h3><span className="ic-dot white"><Icon d={I.paper} /></span></div>
            <div className="test qp">
              <div className="tags"><span>Physics</span><span>Class 11</span><span>JEE</span></div>
              <p><b>Q14.</b> A uniform disc rotates freely. If its angular velocity is doubled, its kinetic energy becomes…</p>
              <div className="opts6"><span>Half</span><span>Double</span><span className="ok">Four times</span><span>Same</span></div>
            </div>
          </article>
          <article className="tile f-chart" data-reveal>
            <div className="tile-head"><h3>Weak chapters, at a glance</h3><span className="ic-dot t-sun"><Icon d={I.chart} /></span></div>
            <div className="hbars6">
              {[["Trigonometry", 46, "coral"], ["Algebra", 66, "pink"], ["Geometry", 74, "sun"], ["Statistics", 88, "dark"]].map(([t, p, c], i) => (
                <div key={t as string}><span>{t}</span><div className="pbar"><i className={`t-${c}`} style={v({ "--w": `${p}%`, "--d": `${0.2 + i * 0.1}s` })} /></div><b>{p}%</b></div>
              ))}
            </div>
          </article>
          <article className="tile f-cbt" data-reveal>
            <div className="tile-head"><h3>Online tests</h3><span className="ic-dot t-lilac"><Icon d={I.phone} /></span></div>
            <p>Timed tests on any phone, scored instantly with ranks.</p>
            <div className="pal6">{Array.from({ length: 20 }, (_, i) => <i key={i} className={i < 11 ? "a" : i === 13 ? "r" : ""} style={v({ "--d": `${i * 0.04}s` })} />)}</div>
          </article>
        </div>
      </div>
    </section>
  );
}

function Numbers() {
  return (
    <section className="sec6 tight">
      <div className="wrap6">
        <div className="nums6" data-reveal>
          <div className="tile"><b>Same day</b><span>results, not weeks</span></div>
          <div className="tile"><b><CountUp to={4} /></b><span>question types marked</span></div>
          <div className="tile"><b><CountUp to={3} /></b><span>ways to test: paper, OMR, online</span></div>
          <div className="tile coral-tile"><b className="h-coral"><CountUp to={100} suffix="%" /></b><span className="on-coral">of marks approved by teachers</span></div>
        </div>
      </div>
    </section>
  );
}

const AUD = [
  { k: "Teachers", h: "Get your evenings back.", pts: ["Upload a class's sheets in minutes", "Review and change any mark", "Make the next test paper in minutes"], tone: "pink" },
  { k: "Owners", h: "Every batch and centre in one view.", pts: ["Results across branches", "See which topics need more teaching", "Clear reports for parents"], tone: "sun" },
  { k: "Students", h: "Know exactly what to fix.", pts: ["Feedback on every answer", "Practice tests on their phone", "Progress they can see"], tone: "lilac" },
  { k: "Parents", h: "Stay informed, easily.", pts: ["A report link to open on WhatsApp", "Marks, rank and what to revise", "No app or login needed"], tone: "coral" },
];
function Audience() {
  const [tab, setTab] = useState(0);
  const a = AUD[tab];
  return (
    <section className="sec6">
      <div className="wrap6">
        <SectionHead chip="For everyone" title="Made for your whole institute" />
        <div className="pills big" role="tablist" data-reveal>
          {AUD.map((x, i) => <button key={x.k} role="tab" aria-selected={tab === i} className={tab === i ? "on" : ""} onClick={() => setTab(i)}>{x.k}</button>)}
        </div>
        <div className="tile aud6" key={a.k}>
          <span className={`ic-dot lg t-${a.tone}`}><Icon d={I.spark} /></span>
          <div><h3>{a.h}</h3><ul>{a.pts.map((p, i) => <li key={p} style={v({ "--i": i })}><Icon d={I.check} />{p}</li>)}</ul></div>
        </div>
      </div>
    </section>
  );
}

const FAQ = [
  ["Can it really read handwriting?", "Yes, including Hindi and Sanskrit. If a word is hard to read, it's flagged so a teacher can check it before marks are final."],
  ["Will it replace our teachers?", "No. It does the slow, repetitive checking. Teachers review every mark and approve results before students see them."],
  ["Which boards and exams are supported?", "CBSE, ICSE and state boards, plus JEE, NEET, UPSC and CA. You can also use your own marking scheme."],
  ["Do students need to install an app?", "No. Online tests open in any phone browser, and parents get a simple report link."],
  ["Who can see our answer sheets?", "Only your institute's staff. Each student and parent sees only their own report."],
];
function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="sec6">
      <div className="wrap6 faq6">
        <SectionHead chip="FAQ" title="Questions? Answers." />
        <div className="frame soft">
          {FAQ.map(([q, ans], i) => (
            <div key={q} className={`tile qa6 ${open === i ? "on" : ""}`} data-reveal>
              <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>{q}<span className="round sm"><Icon d="M12 6v12M6 12h12" /></span></button>
              <div className="ans6"><div><p>{ans}</p></div></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Cta() {
  return (
    <section className="sec6">
      <div className="wrap6">
        <div className="tile cta6" data-reveal>
          <Glass className="cta-glass" />
          <div className="cta6-copy">
            <h2 className="h-sec6">Try it with your own answer sheets.</h2>
            <p>Book a free 20-minute demo. Bring a few copies and watch them get marked.</p>
            <div className="actions6">
              <Link to="/contact" className="btn6 dark">Book a free demo</Link>
              <Link to="/login?mode=register" className="btn6 light">Create your institute</Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <main className="home6">
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
