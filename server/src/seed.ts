// Seeds a demo institute so the app has something to show. Run: npm run seed
// Demo data only - every score below is synthetic and generated here, not by the AI.
import "./env.js";
import bcrypt from "bcryptjs";
import { db, one, run, uid } from "./db.js";
import type { Question, Section, SheetEvaluation } from "./ai/schemas.js";
import { totalMarks } from "./routes/papers.js";
import { storage } from "./lib/storage.js";
import { renderSheet, type WrittenAnswer } from "./lib/demosheets.js";

// Exact sub-topics of the demo questions (also added to an existing demo institute).
const DEMO_SUBTOPICS: [string, string][] = [
  ["kinetic energy is", "Kinetic energy formula"], ["dimensional formula of impulse", "Dimensional formula of derived quantities"],
  ["rotational kinetic energy", "Rotational kinetic energy"], ["4 Ω and 12 Ω", "Equivalent resistance in parallel"],
  ["launched at 45°", "Projectile motion at the highest point"], ["from rest to 20 m/s", "Equations of motion (uniform acceleration)"],
  ["10 Ω resistor", "Ohm's law"], ["2x² − 7x + 3", "Solving quadratics by factorisation"], ["15th term of the AP", "nth term of an AP"],
  ["sin θ = 3/5", "Trigonometric ratios from a given ratio"], ["√2 is irrational", "Proof of irrationality"], ["ladder 10 m long", "Heights and distances (right triangle)"],
];
const demoSubtopic = (text: string) => DEMO_SUBTOPICS.find(([k]) => text.includes(k))?.[1] ?? "";

// DEMO_RESEED=true replaces an existing demo institute with a fresh one (its data is synthetic and read-only).
const existing = one<{ org_id: string }>("SELECT org_id FROM users WHERE email = 'admin@demo.school'");
if (existing && process.env.DEMO_RESEED === "true") {
  const keys = (db.prepare("SELECT a.files FROM attempts a JOIN tests t ON t.id = a.test_id WHERE t.org_id = ? AND a.files IS NOT NULL").all(existing.org_id) as { files: string }[])
    .flatMap((r) => JSON.parse(r.files) as string[]);
  run("DELETE FROM orgs WHERE id = ? AND is_demo = 1", existing.org_id);
  await storage.remove(keys);
  console.log(`Removed the old demo institute (${keys.length} page images).`);
} else if (existing) {
  // Older demo data: fill in sub-topics so reports show the exact concept.
  const papers = db.prepare("SELECT p.id, p.sections FROM question_papers p JOIN orgs o ON o.id = p.org_id WHERE o.is_demo = 1").all() as { id: string; sections: string }[];
  for (const p of papers) {
    const sections = JSON.parse(p.sections) as Section[];
    let changed = false;
    for (const sec of sections) for (const q of sec.questions) if (!q.subtopic && demoSubtopic(q.text)) { q.subtopic = demoSubtopic(q.text); changed = true; }
    if (changed) run("UPDATE question_papers SET sections = ? WHERE id = ?", JSON.stringify(sections), p.id);
  }
  console.log("Demo data already present. Delete server/data to reseed.");
  process.exit(0);
}

let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const hash = bcrypt.hashSync("demo1234", 10);
const ago = (days: number, hour = 10) => { const d = new Date(Date.now() - days * 86400000); d.setUTCHours(hour - 5, 30, 0, 0); return d.toISOString(); };
const sqlTime = (iso: string) => iso.replace("T", " ").slice(0, 19);

db.exec("BEGIN");
const org = uid("org");
run("INSERT INTO orgs (id, name, city, is_demo) VALUES (?, 'Sunrise Academy', 'Jaipur', 1)", org);
const admin = uid("usr");
run("INSERT INTO users (id, org_id, role, name, email, password_hash, created_at) VALUES (?,?, 'admin', 'Priya Nair', 'admin@demo.school', ?, ?)", admin, org, hash, sqlTime(ago(120)));
const teachers = [["Rahul Verma", "Physics"], ["Meera Iyer", "Mathematics"], ["Arjun Rao", "Chemistry"]].map(([name, subject], i) => {
  const id = uid("usr");
  run("INSERT INTO users (id, org_id, role, name, email, subject, password_hash, created_at) VALUES (?,?, 'teacher', ?,?,?,?,?)", id, org, name, `teacher${i + 1}@demo.school`, subject, hash, sqlTime(ago(90 - i * 30)));
  return id;
});

// Centres, courses (with subjects) and four batches of five students.
const centres = [["Malviya Nagar", "Jaipur"], ["Vaishali Nagar", "Jaipur"]].map(([name, city]) => {
  const id = uid("ctr");
  run("INSERT INTO centres (id, org_id, name, city) VALUES (?,?,?,?)", id, org, name, city);
  return id;
});
const course = (name: string, board: string, subjects: string[]) => {
  const id = uid("crs");
  run("INSERT INTO courses (id, org_id, name, board) VALUES (?,?,?,?)", id, org, name, board);
  return { id, name, subjects: Object.fromEntries(subjects.map((s) => { const sid = uid("sub"); run("INSERT INTO subjects (id, org_id, course_id, name) VALUES (?,?,?,?)", sid, org, id, s); return [s, sid]; })) as Record<string, string> };
};
const jee = course("JEE Main", "NTA", ["Physics", "Chemistry", "Mathematics"]);
const cbse = course("CBSE Class 10", "CBSE", ["Mathematics", "Science"]);
const batchDefs: [string, typeof jee, number, number, number][] = [
  ["JEE 2027 - Alpha", jee, 0, 0, 150], ["JEE 2027 - Beta", jee, 0, 0, 140], ["Class 10 - Foundation A", cbse, 1, 1, 130], ["Class 10 - Foundation B", cbse, 1, 1, 100],
];
const batches = batchDefs.map(([name, c, ctr, t, startedDaysAgo]) => {
  const id = uid("bat");
  run("INSERT INTO batches (id, org_id, centre_id, name, course, course_id, teacher_id, start_date, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    id, org, centres[ctr], name, c.name, c.id, teachers[t], ago(startedDaysAgo).slice(0, 10), sqlTime(ago(startedDaysAgo + 5)));
  return id;
});
const names = [
  ["Aarav Sharma", "Ananya Gupta", "Rohit Singh", "Isha Patel", "Kabir Mehta"],
  ["Diya Joshi", "Vihaan Reddy", "Saanvi Kapoor", "Aditya Bansal", "Myra Agarwal"],
  ["Reyansh Singh", "Kiara Joshi", "Arnav Bansal", "Navya Gupta", "Dhruv Mehta"],
  ["Pari Kapoor", "Ishaan Sharma", "Tara Patel", "Aarohi Verma", "Yash Agarwal"],
];
// skill: how well each student usually does (fixed, so the demo looks the same every time).
const skills = [[0.92, 0.55, 0.74, 0.38, 0.83], [0.66, 0.47, 0.88, 0.61, 0.79], [0.9, 0.58, 0.72, 0.35, 0.81], [0.68, 0.95, 0.5, 0.77, 0.42]];
const students: { id: string; name: string; batch: string; roll: string; skill: number }[] = [];
batches.forEach((batch, bi) => names[bi].forEach((name, i) => {
  const id = uid("usr");
  const first = name.split(" ")[0];
  const username = bi === 2 && i === 0 ? "student" : first.toLowerCase() + (100 + bi * 20 + i);
  const joined = sqlTime(ago(bi === 3 ? 20 - i : 100 - bi * 10 - i));
  run("INSERT INTO users (id, org_id, role, name, username, phone, password_hash, created_at) VALUES (?,?, 'student', ?,?,?,?,?)", id, org, name, username, `98${String(10000000 + bi * 1000 + i)}`, hash, joined);
  run("INSERT INTO enrollments (student_id, batch_id, roll_no, parent_name, parent_phone, parent_email) VALUES (?,?,?,?,?,?)",
    id, batch, String(i + 1), `Parent of ${first}`, `97${String(20000000 + bi * 1000 + i)}`, `parent.${first.toLowerCase()}@example.com`);
  students.push({ id, name, batch, roll: String(i + 1), skill: skills[bi][i] });
}));

const q = (p: Partial<Question> & Pick<Question, "id" | "type" | "text" | "marks" | "topic" | "solution">): Question => ({
  options: [], correct_option: null, numeric_answer: null, negative_marks: 0, difficulty: "medium", subtopic: "",
  rubric: [{ step: "Correct final answer", marks: p.marks }], ...p,
});
const physicsMcq: Section[] = [{
  name: "Section A - Single correct", instructions: "+4 for correct, -1 for incorrect.",
  questions: [
    q({ id: "q1", type: "mcq", text: "A body of mass 2 kg moves with velocity 3 m/s. Its kinetic energy is", options: ["3 J", "6 J", "9 J", "18 J"], correct_option: 2, marks: 4, negative_marks: 1, difficulty: "easy", subtopic: "Kinetic energy formula", topic: "Work, Energy & Power", solution: "$KE = \\frac{1}{2}mv^2 = \\frac{1}{2}\\cdot 2 \\cdot 9 = 9$ J." }),
    q({ id: "q2", type: "mcq", text: "The dimensional formula of impulse is", options: ["$[MLT^{-2}]$", "$[MLT^{-1}]$", "$[ML^2T^{-2}]$", "$[M^0LT^{-1}]$"], correct_option: 1, marks: 4, negative_marks: 1, subtopic: "Dimensional formula of derived quantities", topic: "Units & Dimensions", solution: "Impulse = force × time → $[MLT^{-2}][T] = [MLT^{-1}]$." }),
    q({ id: "q3", type: "mcq", text: "A uniform disc rotates freely. If its angular velocity is doubled, its rotational kinetic energy becomes", options: ["Half", "Double", "Four times", "Unchanged"], correct_option: 2, marks: 4, negative_marks: 1, subtopic: "Rotational kinetic energy", topic: "Rotational Motion", solution: "$KE = \\frac{1}{2}I\\omega^2 \\propto \\omega^2$, so doubling $\\omega$ quadruples KE." }),
    q({ id: "q4", type: "mcq", text: "Two resistors of 4 Ω and 12 Ω are connected in parallel. The equivalent resistance is", options: ["3 Ω", "8 Ω", "16 Ω", "48 Ω"], correct_option: 0, marks: 4, negative_marks: 1, difficulty: "easy", subtopic: "Equivalent resistance in parallel", topic: "Current Electricity", solution: "$R = \\frac{4 \\cdot 12}{4 + 12} = 3\\ \\Omega$." }),
    q({ id: "q5", type: "mcq", text: "A projectile is launched at 45°. Ignoring air resistance, at the highest point its velocity is", options: ["Zero", "Maximum", "Horizontal component only", "Vertical component only"], correct_option: 2, marks: 4, negative_marks: 1, subtopic: "Projectile motion at the highest point", topic: "Kinematics", solution: "At the top the vertical component is zero; the horizontal component remains." }),
  ],
}, {
  name: "Section B - Numerical", instructions: "+4 for correct, no negative marking.",
  questions: [
    q({ id: "q6", type: "numeric", text: "A car accelerates uniformly from rest to 20 m/s in 5 s. Find the distance covered (in m).", numeric_answer: 50, marks: 4, subtopic: "Equations of motion (uniform acceleration)", topic: "Kinematics", solution: "$a = 4$ m/s², $s = \\frac{1}{2}at^2 = \\frac{1}{2}\\cdot 4 \\cdot 25 = 50$ m." }),
    q({ id: "q7", type: "numeric", text: "Find the current (in A) through a 10 Ω resistor connected to a 5 V ideal battery.", numeric_answer: 0.5, marks: 4, difficulty: "easy", subtopic: "Ohm's law", topic: "Current Electricity", solution: "$I = V/R = 0.5$ A." }),
  ],
}];
const mathsSubjective: Section[] = [{
  name: "Section A - Short answer", instructions: "Show all working. Step marks are awarded.",
  questions: [
    q({ id: "q1", type: "short", text: "Solve for $x$: $2x^2 - 7x + 3 = 0$.", marks: 3, subtopic: "Solving quadratics by factorisation", topic: "Quadratic Equations", solution: "$(2x - 1)(x - 3) = 0 \\Rightarrow x = \\frac{1}{2}$ or $x = 3$.",
      rubric: [{ step: "Correct factorisation or use of formula", marks: 2 }, { step: "Both roots stated", marks: 1 }] }),
    q({ id: "q2", type: "short", text: "Find the 15th term of the AP 7, 11, 15, …", marks: 2, difficulty: "easy", subtopic: "nth term of an AP", topic: "Arithmetic Progressions", solution: "$a = 7$, $d = 4$, $a_{15} = 7 + 14 \\cdot 4 = 63$.",
      rubric: [{ step: "Identifies a and d and uses $a_n = a + (n-1)d$", marks: 1 }, { step: "Correct answer 63", marks: 1 }] }),
    q({ id: "q3", type: "short", text: "If $\\sin\\theta = \\frac{3}{5}$ and $\\theta$ is acute, find $\\cos\\theta$ and $\\tan\\theta$.", marks: 3, subtopic: "Trigonometric ratios from a given ratio", topic: "Trigonometry", solution: "$\\cos\\theta = \\frac{4}{5}$, $\\tan\\theta = \\frac{3}{4}$.",
      rubric: [{ step: "Uses $\\sin^2\\theta + \\cos^2\\theta = 1$ or a right triangle", marks: 1 }, { step: "$\\cos\\theta = 4/5$", marks: 1 }, { step: "$\\tan\\theta = 3/4$", marks: 1 }] }),
  ],
}, {
  name: "Section B - Long answer", instructions: "Answer with complete reasoning.",
  questions: [
    q({ id: "q4", type: "long", text: "Prove that $\\sqrt{2}$ is irrational.", marks: 5, difficulty: "hard", subtopic: "Proof of irrationality", topic: "Real Numbers", solution: "Assume $\\sqrt{2} = p/q$ in lowest terms, then $p^2 = 2q^2$ so $p$ is even; write $p = 2k$, then $q^2 = 2k^2$ so $q$ is even - contradiction.",
      rubric: [{ step: "Assumes $\\sqrt{2} = p/q$ with p, q coprime", marks: 1 }, { step: "Shows $p^2 = 2q^2$ hence p even", marks: 1.5 }, { step: "Substitutes $p = 2k$ to show q even", marks: 1.5 }, { step: "States the contradiction and conclusion", marks: 1 }] }),
    q({ id: "q5", type: "long", text: "A ladder 10 m long reaches a window 8 m above the ground. Find the distance of the foot of the ladder from the wall, and the angle the ladder makes with the ground.", marks: 5, subtopic: "Heights and distances (right triangle)", topic: "Trigonometry", solution: "Distance $= \\sqrt{100 - 64} = 6$ m; $\\sin\\theta = 8/10 \\Rightarrow \\theta \\approx 53.1°$.",
      rubric: [{ step: "Draws/identifies right triangle", marks: 1 }, { step: "Applies Pythagoras correctly", marks: 1.5 }, { step: "Distance = 6 m", marks: 1 }, { step: "Angle via sin/cos/tan ≈ 53°", marks: 1.5 }] }),
  ],
}];
const chemistryDraft: Section[] = [{
  name: "Section A", instructions: "Answer all questions.",
  questions: [
    q({ id: "q1", type: "mcq", text: "The number of moles in 22 g of $CO_2$ is", options: ["0.25", "0.5", "1", "2"], correct_option: 1, marks: 4, negative_marks: 1, difficulty: "easy", subtopic: "Mole concept", topic: "Some Basic Concepts of Chemistry", solution: "$n = 22/44 = 0.5$ mol." }),
    q({ id: "q2", type: "short", text: "Write the electronic configuration of chromium (Z = 24) and explain its exception.", marks: 3, subtopic: "Exceptional configurations", topic: "Structure of Atom", solution: "$[Ar]\\,3d^5 4s^1$: a half-filled d subshell is more stable.",
      rubric: [{ step: "Correct configuration", marks: 2 }, { step: "Half-filled stability reason", marks: 1 }] }),
  ],
}];

const folder = (name: string) => { const id = uid("fld"); run("INSERT INTO paper_folders (id, org_id, name, created_by) VALUES (?,?,?,?)", id, org, name, admin); return id; };
const weekly = folder("Weekly tests"), unit = folder("Unit tests");
function paper(o: { title: string; subject: string; board: string; cls: string; sections: Section[]; duration: number; source: string; status: string; course: typeof jee; folder: string | null; by: string; daysAgo: number; notes?: string }) {
  const id = uid("qp");
  const when = sqlTime(ago(o.daysAgo));
  run(`INSERT INTO question_papers (id, org_id, title, subject, board, class_level, language, duration_min, instructions, sections, total_marks, status, created_by,
         source, course_id, subject_id, folder_id, marking_notes, created_at, updated_at, approved_at, checked_questions)
       VALUES (?,?,?,?,?,?, 'English', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, org, o.title, o.subject, o.board, o.cls, o.duration, "Read every question carefully. Calculators are not allowed.", JSON.stringify(o.sections), totalMarks(o.sections), o.status, o.by,
    o.source, o.course.id, o.course.subjects[o.subject] ?? null, o.folder, o.notes ?? null, when, when, o.status === "approved" ? when : null,
    JSON.stringify(o.status === "approved" ? o.sections.flatMap((s) => s.questions.map((x) => x.id)) : []));
  return { id, sections: o.sections, total: totalMarks(o.sections), title: o.title, subject: o.subject, course: o.course };
}
const p1 = paper({ title: "Physics Weekly Test - Mechanics & Electricity", subject: "Physics", board: "JEE Main", cls: "Class 11", sections: physicsMcq, duration: 30, source: "generated", status: "approved", course: jee, folder: weekly, by: teachers[0], daysAgo: 35 });
const p2 = paper({ title: "Maths Unit Test - Algebra & Trigonometry", subject: "Mathematics", board: "CBSE", cls: "Class 10", sections: mathsSubjective, duration: 60, source: "imported", status: "approved", course: cbse, folder: unit, by: teachers[1], daysAgo: 12,
  notes: "Accept any correct method.\nGive step marks even if the final answer is wrong." });
paper({ title: "Chemistry Practice - Mole Concept & Atomic Structure", subject: "Chemistry", board: "JEE Main", cls: "Class 11", sections: chemistryDraft, duration: 20, source: "composed", status: "draft", course: jee, folder: null, by: teachers[2], daysAgo: 2 });

// ---- Online physics tests (scored automatically) ----
function cbtEval(sections: Section[], skill: number): SheetEvaluation {
  const questions = sections.flatMap((s) => s.questions).map((qq) => {
    const attempted = rand() < 0.93;
    const correct = attempted && rand() < skill;
    const marks = !attempted ? 0 : correct ? qq.marks : -qq.negative_marks;
    return { question_id: qq.id, attempted, transcription: attempted ? (qq.type === "mcq" ? `Option ${String.fromCharCode(65 + (correct ? qq.correct_option! : (qq.correct_option! + 1) % 4))}` : String(correct ? qq.numeric_answer : (qq.numeric_answer ?? 0) * 2)) : "",
      steps: [], marks_awarded: marks, max_marks: qq.marks, confidence: "high" as const,
      feedback: !attempted ? "Not attempted." : correct ? "Correct." : `Revise ${qq.subtopic || qq.topic}.`,
      mistake_type: (!attempted ? "not_attempted" : correct ? "none" : rand() < 0.5 ? "concept" : "careless") as SheetEvaluation["questions"][number]["mistake_type"],
      mistake_note: !attempted || correct ? "" : `Mixed up ${qq.subtopic.toLowerCase() || qq.topic.toLowerCase()}.`,
      location: { page: 0, top: 0, bottom: 0, mark_x: 0, mark_y: 0 }, annotations: [] };
  });
  return { student_name_on_sheet: null, questions, overall_feedback: "", strengths: [], gaps: [] };
}
function cbtTest(title: string, daysAgo: number, publish: boolean, future = false) {
  const id = uid("tst");
  const when = future ? new Date(Date.now() + 2 * 86400000).toISOString() : ago(daysAgo);
  run("INSERT INTO tests (id, org_id, paper_id, title, mode, scheduled_at, duration_min, results_published, subject, course_id, subject_id, created_at) VALUES (?,?,?,?, 'cbt', ?, 30, ?, 'Physics', ?, ?, ?)",
    id, org, p1.id, title, when, publish ? 1 : 0, jee.id, jee.subjects.Physics, sqlTime(ago(Math.max(0, daysAgo) + 2)));
  for (const b of batches.slice(0, 2)) {
    run("INSERT INTO test_batches (test_id, batch_id) VALUES (?,?)", id, b);
    for (const s of students.filter((x) => x.batch === b)) {
      const ev = future ? null : cbtEval(p1.sections, Math.min(0.97, s.skill + (daysAgo < 10 ? 0.06 : 0)));
      const score = ev ? ev.questions.reduce((t, x) => t + x.marks_awarded, 0) : null;
      run("INSERT INTO attempts (id, test_id, student_id, status, evaluation, score, max_score, submitted_at, evaluated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        uid("att"), id, s.id, ev ? "evaluated" : "pending", ev && JSON.stringify(ev), score, p1.total, ev ? when : null, ev ? when : null);
    }
  }
}
cbtTest("Physics Weekly Test 1", 33, true);
cbtTest("Physics Weekly Test 2", 19, true);
cbtTest("Physics Weekly Test 3", 5, true);
cbtTest("Physics Mock - Full Syllabus", 0, false, true);

// ---- Maths unit test: handwritten sheets, fully marked ----
// Each answer has a few ways it can come out, depending on the student: fully right, partly right, wrong, skipped.
type Variant = { lines: WrittenAnswer["lines"]; awarded: number[]; mistake: SheetEvaluation["questions"][number]["mistake_type"]; note: string; feedback: string; transcription: string };
const V = (lines: WrittenAnswer["lines"], awarded: number[], mistake: Variant["mistake"], note: string, feedback: string): Variant =>
  ({ lines, awarded, mistake, note, feedback, transcription: lines.map((l) => l.text).join("\n") });
const VARIANTS: Record<string, Variant[]> = {
  q1: [
    V([{ text: "2x² − 7x + 3 = 0" }, { text: "2x² − 6x − x + 3 = 0" }, { text: "2x(x − 3) − 1(x − 3) = 0" }, { text: "(2x − 1)(x − 3) = 0" }, { text: "x = 1/2  or  x = 3" }], [2, 1], "none", "", "Clean factorisation and both roots. Well done."),
    V([{ text: "2x² − 7x + 3 = 0" }, { text: "2x² − 6x − x + 3 = 0" }, { text: "(2x − 1)(x − 3) = 0" }, { text: "x = 1/2", note: "Second root x = 3 missing", mark: "partial" }], [2, 0], "incomplete", "Stopped after the first root; $x = 3$ is also a root.", "Your factorisation is right. Always write both roots of a quadratic."),
    V([{ text: "2x² − 7x + 3 = 0" }, { text: "(2x + 1)(x + 3) = 0", note: "Signs wrong: −7x needs (−)(−)" }, { text: "x = −1/2 or x = −3" }], [0.5, 0], "concept", "Chose factors with the wrong signs; their product gives $+7x$.", "Check your factors by expanding them before solving."),
  ],
  q2: [
    V([{ text: "a = 7,  d = 11 − 7 = 4" }, { text: "a₁₅ = a + 14d" }, { text: "= 7 + 56 = 63" }], [1, 1], "none", "", "Correct use of the nth-term formula."),
    V([{ text: "a = 7, d = 4" }, { text: "a₁₅ = 7 + 15 × 4 = 67", note: "Use (n − 1)d, not nd" }], [0.5, 0], "careless", "Used $nd$ instead of $(n-1)d$.", "The 15th term adds the difference 14 times, not 15."),
    V([{ text: "a₁₅ = 15 × 7 = 105", note: "Not an AP formula" }], [0, 0], "concept", "Multiplied the first term by $n$ instead of using $a + (n-1)d$.", "Revise the nth term of an AP: $a_n = a + (n-1)d$."),
  ],
  q3: [
    V([{ text: "sin θ = 3/5  ⇒  opp = 3, hyp = 5" }, { text: "adj = √(25 − 9) = 4" }, { text: "cos θ = 4/5" }, { text: "tan θ = 3/4" }], [1, 1, 1], "none", "", "All three ratios correct with a clear triangle."),
    V([{ text: "adj = √(25 − 9) = 4" }, { text: "cos θ = 4/5" }, { text: "tan θ = 4/3", note: "tan = opp/adj = 3/4" }], [1, 1, 0], "careless", "Inverted $\\tan\\theta$: it is opposite over adjacent.", "Remember $\\tan\\theta = \\frac{\\text{opp}}{\\text{adj}}$."),
    V([{ text: "cos θ = 5/3", note: "cos θ can't be more than 1" }, { text: "tan θ = 5/4" }], [0, 0, 0], "concept", "Took $\\cos\\theta = 1/\\sin\\theta$.", "Use $\\sin^2\\theta + \\cos^2\\theta = 1$ to find $\\cos\\theta$."),
  ],
  q4: [
    V([{ text: "Let √2 = p/q, p and q coprime" }, { text: "2 = p²/q²  ⇒  p² = 2q²" }, { text: "so p² is even, hence p is even" }, { text: "p = 2k  ⇒  4k² = 2q²  ⇒  q² = 2k²" }, { text: "so q is also even" }, { text: "p, q both even: contradiction" }, { text: "∴ √2 is irrational" }], [1, 1.5, 1.5, 1], "none", "", "A complete, well-argued proof."),
    V([{ text: "Let √2 = p/q in lowest terms" }, { text: "p² = 2q² so p is even" }, { text: "∴ √2 is irrational", note: "Show q is even too", mark: "partial" }], [1, 1.5, 0, 0.5], "incomplete", "Skipped showing $q$ is even, so there is no contradiction yet.", "Finish the argument: put $p = 2k$ to show $q$ is even."),
    V([{ text: "√2 = 1.414213…" }, { text: "it never ends so irrational", note: "Not a proof" }], [0, 0, 0, 0], "concept", "Gave a decimal expansion instead of a proof by contradiction.", "Learn the standard proof by contradiction."),
  ],
  q5: [
    V([{ text: "AB = ladder = 10 m, BC = 8 m (wall)" }, { text: "AC² = 10² − 8² = 36" }, { text: "AC = 6 m" }, { text: "sin θ = 8/10 = 0.8" }, { text: "θ ≈ 53°" }], [1, 1.5, 1, 1.5], "none", "", "Correct triangle, distance and angle."),
    V([{ text: "AC² = 10² − 8² = 36, AC = 6 m" }, { text: "cos θ = 8/10", note: "Wall is opposite θ: use sin" }, { text: "θ ≈ 37°" }], [1, 1.5, 1, 0], "concept", "Used the wrong ratio for the angle with the ground.", "Draw the triangle and label which side is opposite the angle."),
    V([{ text: "AC = 10 − 8 = 2 m", note: "Use Pythagoras, not subtraction" }, { text: "θ = 45°" }], [0.5, 0, 0, 0], "concept", "Subtracted the sides instead of using Pythagoras.", "In a right triangle, $\\text{base}^2 = \\text{hyp}^2 - \\text{height}^2$."),
  ],
};
const mathTestId = uid("tst");
const mathWhen = ago(6, 9);
run("INSERT INTO tests (id, org_id, paper_id, title, mode, scheduled_at, duration_min, results_published, subject, course_id, subject_id, created_at) VALUES (?,?,?,?, 'offline', ?, 60, 1, 'Mathematics', ?, ?, ?)",
  mathTestId, org, p2.id, "Maths Unit Test - Term 1", mathWhen, cbse.id, cbse.subjects.Mathematics, sqlTime(ago(9)));
const mathQs = mathsSubjective.flatMap((s) => s.questions);
const pending: { attempt: string; student: typeof students[number]; answers: { q: Question; v: Variant | null }[] }[] = [];
for (const b of batches.slice(2)) {
  run("INSERT INTO test_batches (test_id, batch_id) VALUES (?,?)", mathTestId, b);
  for (const s of students.filter((x) => x.batch === b)) {
    const answers = mathQs.map((qq) => {
      if (qq.id === "q4" && s.skill < 0.45 && rand() < 0.6) return { q: qq, v: null }; // the hard proof is skipped by some
      const r = rand() * 0.35 + s.skill * 0.75;
      return { q: qq, v: VARIANTS[qq.id][r > 0.78 ? 0 : r > 0.5 ? 1 : 2] };
    });
    pending.push({ attempt: uid("att"), student: s, answers });
  }
}
db.exec("COMMIT");

// Sheet images are drawn outside the transaction (it takes a few seconds), then the marks are saved with their positions.
let drawn = 0;
for (const p of pending) {
  let files: string[] = [], placed: Awaited<ReturnType<typeof renderSheet>>["placed"] = {};
  try {
    const sheet = await renderSheet({ name: p.student.name, roll: p.student.roll }, { subject: "Mathematics", test: "Unit Test - Term 1" },
      p.answers.filter((a) => a.v).map((a) => ({ qid: a.q.id, label: `Q${a.q.id.slice(1)}.`, lines: a.v!.lines })), rand);
    for (const [i, img] of sheet.pages.entries()) { const key = `demo/${p.attempt}/${i + 1}.jpg`; await storage.put(key, img); files.push(key); }
    placed = sheet.placed; drawn++;
  } catch (e) {
    console.warn(`Couldn't draw a demo sheet (${(e as Error).message}); the test is seeded without images.`);
    files = [];
  }
  const questions = p.answers.map(({ q: qq, v }) => {
    const steps = qq.rubric.map((r, i) => ({ step: r.step, max_marks: r.marks, awarded: v ? Math.min(r.marks, v.awarded[i] ?? 0) : 0,
      comment: !v ? "" : (v.awarded[i] ?? 0) >= r.marks ? "Done correctly." : (v.awarded[i] ?? 0) > 0 ? "Partly there; see the note on your sheet." : "Missing or incorrect." }));
    const marks = steps.reduce((t, x) => t + x.awarded, 0);
    const pl = placed[qq.id];
    return { question_id: qq.id, attempted: Boolean(v), transcription: v?.transcription ?? "", steps, marks_awarded: marks, max_marks: qq.marks,
      feedback: v?.feedback ?? "Not attempted. Even writing the first step earns marks.", confidence: (v && v.mistake === "careless" && rand() < 0.3 ? "low" : "high") as "low" | "high",
      mistake_type: v ? v.mistake : "not_attempted" as const, mistake_note: v?.note ?? "",
      location: pl?.location ?? { page: 0, top: 0, bottom: 0, mark_x: 0, mark_y: 0 }, annotations: pl?.annotations ?? [] };
  });
  const score = questions.reduce((t, x) => t + x.marks_awarded, 0);
  const weak = [...new Set(questions.filter((x) => x.marks_awarded < x.max_marks * 0.6).map((x) => mathQs.find((qq) => qq.id === x.question_id)!.topic))];
  const strong = [...new Set(questions.filter((x) => x.marks_awarded >= x.max_marks).map((x) => mathQs.find((qq) => qq.id === x.question_id)!.topic))];
  const ev = { student_name_on_sheet: p.student.name, questions, strengths: strong, gaps: weak,
    overall_feedback: `${score >= p2.total * 0.75 ? "A strong paper." : score >= p2.total * 0.5 ? "A fair attempt with room to improve." : "This topic needs more practice."}\n` +
      (strong.length ? `- Good work in ${strong.slice(0, 2).join(" and ")}.\n` : "") + (weak.length ? `- Revise ${weak.slice(0, 2).join(" and ")}.\n` : "") + "- Write every step: most marks are for the working.",
    meta: { model: "demo", grading: "whole", pages: files.length, marked_at: mathWhen } };
  for (const x of questions as (typeof questions[number] & { needs_review?: boolean; check_note?: string })[])
    if (x.confidence === "low") { x.needs_review = true; x.check_note = "Handwriting was hard to read. Please check."; }
  run(`INSERT INTO attempts (id, test_id, student_id, status, files, evaluation, score, max_score, submitted_at, evaluated_at, reviewed) VALUES (?,?,?, 'evaluated', ?,?,?,?,?,?, 1)`,
    p.attempt, mathTestId, p.student.id, JSON.stringify(files), JSON.stringify(ev), score, p2.total, mathWhen, mathWhen);
}

run("INSERT INTO notices (id, org_id, title, body, created_by, created_at) VALUES (?,?,?,?,?,?)", uid("ntc"), org, "Diwali break", "The institute will be closed from 29 Oct to 3 Nov. Classes resume on 4 Nov.", admin, sqlTime(ago(30)));
run("INSERT INTO notices (id, org_id, title, body, batch_id, created_by, created_at) VALUES (?,?,?,?,?,?,?)", uid("ntc"), org, "Physics mock this Sunday", "Full-syllabus physics mock on the portal at 10:00 AM. Keep your login ready.", batches[0], teachers[0], sqlTime(ago(1)));

console.log(`Seeded demo institute: 2 centres, 4 batches, ${students.length} students, 3 papers, ${drawn} handwritten sheets.
  Admin:    admin@demo.school / demo1234
  Teacher:  teacher1@demo.school / demo1234
  Student:  student / demo1234`);
