import { Fragment, useState } from "react";
import { Link } from "react-router-dom";

function HeroSheets() {
  return (
    <div className="sheet-stage" aria-hidden>
      <div className="sheet back">
        <div className="score-stamp"><div><b>41</b><small>50</small></div></div>
        <div className="ln">Q3. v = u + at</div>
        <div className="ln">&nbsp;&nbsp;= 0 + 4 × 5<span className="tick">✓</span></div>
        <div className="ln">&nbsp;&nbsp;= 20 m/s<span className="tick">✓</span></div>
        <div className="ln">Q4. F = ma = 2 × 3</div>
        <div className="ln">&nbsp;&nbsp;<span className="cut">= 5 N</span> <span className="note">→ 6 N</span></div>
        <div className="ln note">units ok, arithmetic slip −½</div>
        <div className="ln">Q5. KE ∝ ω², so 4×<span className="tick">✓</span></div>
        <div className="ln">Q6. R = 4·12/16 = 3Ω<span className="tick">✓</span></div>
      </div>
      <div className="sheet front">
        <span className="circle" style={{ top: 18 }}>4½</span>
        <div className="ln">प्र.2 √2 अपरिमेय है</div>
        <div className="ln">मान लो √2 = p/q<span className="tick">✓</span></div>
        <div className="ln">p² = 2q² ⇒ p सम<span className="tick">✓</span></div>
        <div className="ln">p = 2k ⇒ q² = 2k²<span className="tick">✓</span></div>
        <div className="ln note">conclusion missing −½</div>
        <div className="ln">Q3. a₁₅ = 7 + 14(4)</div>
        <div className="ln">&nbsp;&nbsp;= 63<span className="tick">✓✓</span></div>
      </div>
      <div className="ai-pill" style={{ left: 0, top: 60 }}><span className="dot pulse" style={{ color: "var(--green)" }} /> Evaluating 18 of 42 sheets</div>
      <div className="ai-pill" style={{ right: 10, bottom: 10 }}>Step-wise · Q4 <b style={{ color: "var(--accent)" }}>4.5 / 5</b></div>
    </div>
  );
}

const PILLARS = [
  {
    key: "evaluate", tab: "Evaluate answer sheets", chip: "AI EVALUATION",
    title: "Handwritten answers, graded like your best teacher would.",
    body: "Upload phone scans or PDFs. Markwise reads the handwriting, follows your rubric step by step, awards partial credit and writes feedback each student can act on.",
    points: ["Step-wise partial marks, not just right/wrong", "Reads English, Hindi and other Indian scripts", "Accepts alternative methods that reach the answer", "Teachers review and override any mark in one click"],
  },
  {
    key: "generate", tab: "Generate question papers", chip: "PAPER SETTER",
    title: "A complete, original question paper in minutes.",
    body: "Choose the board, class, chapters, difficulty and section layout. You get original questions with answer keys, worked solutions and marking schemes - fully editable.",
    points: ["CBSE, ICSE, state boards, JEE, NEET and more", "Control sections, marks, negative marking and difficulty", "Solutions and rubrics generated with every question", "Edit, clone and reuse papers across batches"],
  },
  {
    key: "analytics", tab: "Performance analytics", chip: "INSIGHTS",
    title: "See learning gaps before the next test, not after the exam.",
    body: "Every evaluated sheet feeds topic-level mastery, score trends and leaderboards - for a single student, a batch, or every centre you run.",
    points: ["Topic and chapter mastery per batch", "Student report cards with trend vs class average", "Shareable parent report links", "CSV export of every result"],
  },
  {
    key: "operate", tab: "Run your institute", chip: "OPERATIONS",
    title: "Centres, batches, people and notices in one place.",
    body: "Onboard a whole batch from a spreadsheet, issue student logins, schedule tests and post announcements - with separate views for admins, teachers and students.",
    points: ["Multi-centre and multi-batch structure", "Bulk student onboarding with generated logins", "Role-based access for admins, teachers, students", "Batch-targeted notice board"],
  },
];

function PillarDemo({ k }: { k: string }) {
  if (k === "evaluate") return (
    <div className="card demo-panel">
      <div className="top"><b>Q4 · Prove √2 is irrational</b><span className="badge green">4.5 / 5</span></div>
      {[["Assumes √2 = p/q in lowest terms", 1, 1], ["Shows p² = 2q² so p is even", 1.5, 1.5], ["Substitutes p = 2k, shows q even", 1.5, 1.5], ["States contradiction & conclusion", 1, 0.5]].map(([s, m, a]) => (
        <div key={s as string} className="row between" style={{ padding: "9px 0", borderBottom: "1px solid var(--line)" }}>
          <span className="small">{s}</span><span className={`badge ${a === m ? "green" : "amber"}`}>{a} / {m}</span>
        </div>
      ))}
      <p className="small" style={{ marginTop: 12, color: "var(--ink-2)" }}><b>Feedback:</b> Solid proof. Finish by explicitly stating that p and q share a factor 2, contradicting the assumption.</p>
    </div>
  );
  if (k === "generate") return (
    <div className="card demo-panel">
      <div className="top"><b>Physics · Class 11 · 30 marks</b><span className="badge violet">Draft</span></div>
      <div className="q-card"><div className="q-meta"><span className="badge">MCQ</span><span className="badge">Rotational Motion</span><span className="badge amber">Medium</span><span className="badge">+4 / −1</span></div>
        <div className="q-text">A uniform disc rotates freely. If its angular velocity is doubled, its rotational kinetic energy becomes</div>
        <div className="opts"><div className="opt">A. Half</div><div className="opt">B. Double</div><div className="opt correct">C. Four times</div><div className="opt">D. Unchanged</div></div>
      </div>
    </div>
  );
  if (k === "analytics") return (
    <div className="card demo-panel">
      <div className="top"><b>JEE 2027 · Alpha - topic mastery</b><span className="badge green">↑ 14% this month</span></div>
      {[["Rotational Motion", 48], ["Current Electricity", 63], ["Kinematics", 77], ["Units & Dimensions", 88]].map(([t, v]) => (
        <div key={t as string} style={{ marginBottom: 12 }}>
          <div className="row between small"><b>{t}</b><span className="muted">{v}%</span></div>
          <div className="bar"><i style={{ width: `${v}%`, background: (v as number) >= 75 ? "var(--green)" : (v as number) >= 50 ? "var(--amber)" : "var(--red)" }} /></div>
        </div>
      ))}
    </div>
  );
  return (
    <div className="card demo-panel">
      <div className="top"><b>Centres</b><span className="badge">2 centres · 36 students</span></div>
      {[["Malviya Nagar", "JEE 2027 - Alpha", "Mock live", "blue"], ["Malviya Nagar", "JEE 2027 - Beta", "Results sent", "green"], ["Vaishali Nagar", "Class 10 Foundation", "Paper drafted", "violet"]].map(([c, b, s, t]) => (
        <div key={b} className="row between" style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
          <div><b className="small">{b}</b><div className="small muted">{c}</div></div><span className={`badge ${t}`}>{s}</span>
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const [pillar, setPillar] = useState(PILLARS[0].key);
  const p = PILLARS.find((x) => x.key === pillar)!;
  return (
    <main>
      <section className="site-wrap">
        <div className="hero">
          <div>
            <div className="eyebrow">Evaluation · Paper setting · Analytics</div>
            <h1>Grade every sheet <span className="serif">faster</span>, teach every student better.</h1>
            <p className="hero-sub">Markwise checks handwritten answer sheets step by step, writes question papers on demand, and shows you exactly where each student needs help.</p>
            <div className="hero-cta">
              <Link to="/contact" className="btn btn-primary">Book a demo →</Link>
              <Link to="/login?demo=1" className="btn-link">Try the live demo</Link>
            </div>
          </div>
          <HeroSheets />
        </div>
        <div className="stats">
          <div><b>Step-wise</b><span>partial credit on every answer</span></div>
          <div><b>Minutes</b><span>to a complete question paper</span></div>
          <div><b>हिंदी + EN</b><span>and other Indian scripts</span></div>
          <div><b>1 view</b><span>across every centre & batch</span></div>
        </div>
      </section>

      <section className="section dark" style={{ marginTop: 72 }}>
        <div className="site-wrap">
          <div className="section-head">
            <span className="chip">The usual week</span>
            <h2>Most institutes still run on <span className="serif">red pens</span> and spreadsheets.</h2>
            <p>Your best teachers spend evenings checking copies and typing marks - instead of teaching, mentoring and growing the institute.</p>
          </div>
          <div className="chaos">
            {[["📚", "Stacks of copies", "Hundreds of sheets per test, checked by hand, one at a time."],
              ["⏳", "Results in weeks", "By the time marks come back, the batch has moved two chapters on."],
              ["🧮", "Marks in spreadsheets", "Coordinators copy totals into sheets and WhatsApp groups manually."],
              ["🎯", "No view of gaps", "Nobody can say which topic a batch is weak in until the final exam."]].map(([e, h, t]) => (
              <div key={h} className="chaos-card"><div className="em">{e}</div><h4>{h}</h4><p>{t}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="site-wrap">
          <div className="section-head">
            <span className="chip">What changes</span>
            <h2>From bottleneck to <span className="serif">same-day</span> results.</h2>
          </div>
          <div className="pain">
            {[["Checking eats every weekend", "Teachers lose evenings and Sundays to answer sheets and paper setting.", "Hours handed back every week", "Sheets are evaluated in the background while teachers teach."],
              ["Results come too late", "Feedback arrives after the class has moved on, so gaps quietly widen.", "Results the same day", "Upload after the test; review, publish and share report links within hours."],
              ["Two checkers, two marks", "Partial credit depends on who checks the copy. Parents notice.", "One rubric for everyone", "Every sheet is marked against the same step-wise scheme, with reasons."],
              ["No view across branches", "Centre heads compile reports by hand and still can't compare batches.", "Live view of every batch", "Trends, topic mastery and leaderboards update as soon as sheets are marked."]].map(([b, bt, a, at], i) => (
              <div key={b} className="card pain-card">
                <div className="row between"><span className="before">Before</span><span className="num">0{i + 1}</span></div>
                <h4>{b}</h4><p>{bt}</p>
                <div className="after">With Markwise</div>
                <h4>{a}</h4><p>{at}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="formats" style={{ background: "var(--bg-2)" }}>
        <div className="site-wrap">
          <div className="section-head">
            <span className="chip">Exam formats</span>
            <h2>Pen-and-paper, bubble sheet or <span className="serif">on screen</span>.</h2>
            <p>Run each test the way your students actually take it - the results land in the same analytics.</p>
          </div>
          <div className="formats">
            <div className="card format-card">
              <div className="mock">
                <div className="row between"><b>Online test · Physics mock</b><span className="badge red">⏱ 01:42:04</span></div>
                <div className="palette">{Array.from({ length: 20 }, (_, i) => <i key={i} className={i < 9 ? "a" : i === 11 || i === 4 ? "r" : i === 13 ? "c" : ""}>{i + 1}</i>)}</div>
                <div className="small"><b>Q14.</b> A uniform disc rotates freely. If its angular velocity is doubled…</div>
                <div className="row small muted" style={{ marginTop: 8 }}><span className="badge green">Answered</span><span className="badge amber">Review</span><span className="badge">+4 / −1</span></div>
              </div>
              <h4>Online (CBT) tests</h4><p className="muted small">Timed tests with a question palette, mark-for-review and instant +/− scoring.</p>
            </div>
            <div className="card format-card">
              <div className="mock">
                <div className="row between"><b>Bubble sheet</b><span className="badge green">Auto-scored</span></div>
                <div className="bubbles" style={{ marginTop: 14 }}>
                  {[2, 0, 3, 1, 2].map((f, r) => (<Fragment key={r}>
                    <span>{r + 1}.</span>
                    {[0, 1, 2, 3].map((c) => <i key={c} className={c === f ? "f" : ""} />)}
                  </Fragment>))}
                </div>
              </div>
              <h4>Objective & OMR-style papers</h4><p className="muted small">Scan the sheet and objective answers are checked against the key, negative marking included.</p>
            </div>
            <div className="card format-card">
              <div className="mock">
                <div className="row between"><b>Homework · Chemistry</b><span className="badge violet">Due today</span></div>
                <div className="q-card" style={{ marginTop: 12, padding: 12 }}>
                  <div className="row between small"><b>Aarav S. · Roll 24</b><span className="badge green">8.5 / 10</span></div>
                  <div className="hand" style={{ fontSize: 20, color: "#263066", marginTop: 6 }}>Mg + 2HCl → MgCl₂ + H₂↑ <span style={{ color: "var(--red)" }}>✓</span></div>
                  <div className="small muted">Balanced correctly; state symbols missing (−½)</div>
                </div>
              </div>
              <h4>Handwritten tests & homework</h4><p className="muted small">Collect photos or PDFs per student and get step-wise marks with written feedback.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="product">
        <div className="site-wrap">
          <div className="section-head">
            <span className="chip">The platform</span>
            <h2>One system that <span className="serif">works while you teach</span>.</h2>
          </div>
          <div className="pillar-tabs">{PILLARS.map((x) => <button key={x.key} className={x.key === pillar ? "on" : ""} onClick={() => setPillar(x.key)}>{x.tab}</button>)}</div>
          <div className="pillar">
            <div>
              <span className="chip">{p.chip}</span>
              <h3>{p.title}</h3>
              <p style={{ color: "var(--ink-2)" }}>{p.body}</p>
              <ul>{p.points.map((pt) => <li key={pt}>{pt}</li>)}</ul>
            </div>
            <PillarDemo k={pillar} />
          </div>
        </div>
      </section>

      <section className="site-wrap">
        <div className="card card-pad" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 20, textAlign: "center" }}>
          {[["🔒", "Your data stays yours", "Sheets and results are private to your institute"], ["🧑‍🏫", "Teacher in the loop", "Every AI mark can be reviewed and changed"], ["📱", "Works on any device", "Students take tests and see results on their phone"], ["📤", "Easy exports", "CSV results and shareable parent reports"]].map(([e, h, t]) => (
            <div key={h}><div style={{ fontSize: 26 }}>{e}</div><b>{h}</b><p className="small muted">{t}</p></div>
          ))}
        </div>
      </section>

      <section className="site-wrap" style={{ marginTop: 96 }}>
        <div className="cta-band">
          <span className="chip" style={{ background: "rgba(255,255,255,.15)", color: "#fff", borderColor: "rgba(255,255,255,.3)" }}>Get started</span>
          <h2>Give your teachers their evenings back.</h2>
          <p>See Markwise evaluate your own answer sheets in a 20-minute walkthrough, or set up your institute today.</p>
          <div className="row" style={{ justifyContent: "center", marginTop: 28, flexWrap: "wrap" }}>
            <Link to="/contact" className="btn btn-primary">Book a demo</Link>
            <Link to="/login?mode=register" className="btn btn-ghost">Create your institute</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
