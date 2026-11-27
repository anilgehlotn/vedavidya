// Seeds a demo institute so the app has something to show. Run: npm run seed
// Demo data only - every score below is synthetic and generated here, not by the AI.
import "./env.js";
import bcrypt from "bcryptjs";
import { db, one, run, uid } from "./db.js";
import type { Question, Section, SheetEvaluation } from "./ai/schemas.js";
import { totalMarks } from "./routes/papers.js";

// Exact sub-topics of the demo questions (also added to an existing demo institute).
const DEMO_SUBTOPICS: [string, string][] = [
  ["kinetic energy is", "Kinetic energy formula"], ["dimensional formula of impulse", "Dimensional formula of derived quantities"],
  ["rotational kinetic energy", "Rotational kinetic energy"], ["4 Ω and 12 Ω", "Equivalent resistance in parallel"],
  ["launched at 45°", "Projectile motion at the highest point"], ["from rest to 20 m/s", "Equations of motion (uniform acceleration)"],
  ["10 Ω resistor", "Ohm's law"], ["2x² − 7x + 3", "Solving quadratics by factorisation"], ["15th term of the AP", "nth term of an AP"],
  ["sin θ = 3/5", "Trigonometric ratios from a given ratio"], ["√2 is irrational", "Proof of irrationality"], ["ladder 10 m long", "Heights and distances (right triangle)"],
];
const demoSubtopic = (text: string) => DEMO_SUBTOPICS.find(([k]) => text.includes(k))?.[1] ?? "";

if (one("SELECT 1 FROM users WHERE email = 'admin@demo.school'")) {
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

db.exec("BEGIN");
const org = uid("org");
run("INSERT INTO orgs (id, name, city, is_demo) VALUES (?, 'Sunrise Academy', 'Jaipur', 1)", org);
const admin = uid("usr");
run("INSERT INTO users (id, org_id, role, name, email, password_hash) VALUES (?,?, 'admin', 'Priya Nair', 'admin@demo.school', ?)", admin, org, hash);
const teachers = [["Rahul Verma", "Physics"], ["Meera Iyer", "Mathematics"], ["Arjun Rao", "Chemistry"]].map(([name, subject], i) => {
  const id = uid("usr");
  run("INSERT INTO users (id, org_id, role, name, email, subject, password_hash) VALUES (?,?, 'teacher', ?,?,?,?)", id, org, name, `teacher${i + 1}@demo.school`, subject, hash);
  return id;
});

const centres = [["Malviya Nagar", "Jaipur"], ["Vaishali Nagar", "Jaipur"]].map(([name, city]) => {
  const id = uid("ctr");
  run("INSERT INTO centres (id, org_id, name, city) VALUES (?,?,?,?)", id, org, name, city);
  return id;
});
const batches = [
  ["JEE 2027 - Alpha", "JEE Main", 0, 0], ["JEE 2027 - Beta", "JEE Main", 0, 1], ["Class 10 Foundation", "CBSE Class 10", 1, 1],
].map(([name, course, c, t]) => {
  const id = uid("bat");
  run("INSERT INTO batches (id, org_id, centre_id, name, course, teacher_id) VALUES (?,?,?,?,?,?)", id, org, centres[c as number], name, course, teachers[t as number]);
  return id;
});

const first = ["Aarav", "Ananya", "Rohit", "Isha", "Kabir", "Diya", "Vihaan", "Saanvi", "Aditya", "Myra", "Reyansh", "Kiara", "Arnav", "Navya", "Dhruv", "Pari", "Ishaan", "Tara"];
const last = ["Sharma", "Gupta", "Singh", "Patel", "Mehta", "Joshi", "Reddy", "Kapoor", "Bansal", "Agarwal"];
const students: { id: string; batch: string; skill: number }[] = [];
batches.forEach((batch, bi) => {
  for (let i = 0; i < 12; i++) {
    const id = uid("usr");
    const name = `${first[(i + bi * 5) % first.length]} ${last[(i * 3 + bi) % last.length]}`;
    const username = name.split(" ")[0].toLowerCase() + (100 + bi * 20 + i);
    run("INSERT INTO users (id, org_id, role, name, username, phone, password_hash) VALUES (?,?, 'student', ?,?,?,?)", id, org, name, username, `98${String(10000000 + bi * 1000 + i)}`, hash);
    run("INSERT INTO enrollments (student_id, batch_id, roll_no, parent_name, parent_phone) VALUES (?,?,?,?,?)", id, batch, String(i + 1), `Parent of ${name.split(" ")[0]}`, `97${String(20000000 + bi * 1000 + i)}`);
    students.push({ id, batch, skill: 0.35 + rand() * 0.6 });
  }
});
run("UPDATE users SET username = 'student' WHERE id = ?", students[0].id);

const q = (p: Partial<Question> & Pick<Question, "id" | "type" | "text" | "marks" | "topic" | "solution">): Question => ({
  options: [], correct_option: null, numeric_answer: null, negative_marks: 0, difficulty: "medium", subtopic: "",
  rubric: [{ step: "Correct final answer", marks: p.marks }], ...p,
});

const physicsMcq: Section[] = [{
  name: "Section A - Single correct", instructions: "+4 for correct, -1 for incorrect.",
  questions: [
    q({ id: "q1", type: "mcq", text: "A body of mass 2 kg moves with velocity 3 m/s. Its kinetic energy is", options: ["3 J", "6 J", "9 J", "18 J"], correct_option: 2, marks: 4, negative_marks: 1, subtopic: "Kinetic energy formula", topic: "Work, Energy & Power", solution: "KE = ½mv² = ½·2·9 = 9 J." }),
    q({ id: "q2", type: "mcq", text: "The dimensional formula of impulse is", options: ["[MLT⁻²]", "[MLT⁻¹]", "[ML²T⁻²]", "[M⁰LT⁻¹]"], correct_option: 1, marks: 4, negative_marks: 1, subtopic: "Dimensional formula of derived quantities", topic: "Units & Dimensions", solution: "Impulse = force × time → [MLT⁻²][T] = [MLT⁻¹]." }),
    q({ id: "q3", type: "mcq", text: "A uniform disc rotates freely. If its angular velocity is doubled, its rotational kinetic energy becomes", options: ["Half", "Double", "Four times", "Unchanged"], correct_option: 2, marks: 4, negative_marks: 1, subtopic: "Rotational kinetic energy", topic: "Rotational Motion", solution: "KE = ½Iω² ∝ ω², so doubling ω quadruples KE." }),
    q({ id: "q4", type: "mcq", text: "Two resistors of 4 Ω and 12 Ω are connected in parallel. The equivalent resistance is", options: ["3 Ω", "8 Ω", "16 Ω", "48 Ω"], correct_option: 0, marks: 4, negative_marks: 1, subtopic: "Equivalent resistance in parallel", topic: "Current Electricity", solution: "R = (4·12)/(4+12) = 3 Ω." }),
    q({ id: "q5", type: "mcq", text: "A projectile is launched at 45°. Ignoring air resistance, at the highest point its velocity is", options: ["Zero", "Maximum", "Horizontal component only", "Vertical component only"], correct_option: 2, marks: 4, negative_marks: 1, subtopic: "Projectile motion at the highest point", topic: "Kinematics", solution: "At the top the vertical component is zero; the horizontal component remains." }),
  ],
}, {
  name: "Section B - Numerical", instructions: "+4 for correct, no negative marking.",
  questions: [
    q({ id: "q6", type: "numeric", text: "A car accelerates uniformly from rest to 20 m/s in 5 s. Find the distance covered (in m).", numeric_answer: 50, marks: 4, subtopic: "Equations of motion (uniform acceleration)", topic: "Kinematics", solution: "a = 4 m/s², s = ½at² = ½·4·25 = 50 m." }),
    q({ id: "q7", type: "numeric", text: "Find the current (in A) through a 10 Ω resistor connected to a 5 V ideal battery.", numeric_answer: 0.5, marks: 4, subtopic: "Ohm's law", topic: "Current Electricity", solution: "I = V/R = 0.5 A." }),
  ],
}];

const mathsSubjective: Section[] = [{
  name: "Section A - Short answer", instructions: "Show all working. Step marks are awarded.",
  questions: [
    q({ id: "q1", type: "short", text: "Solve for x: 2x² − 7x + 3 = 0.", marks: 3, subtopic: "Solving quadratics by factorisation", topic: "Quadratic Equations", solution: "(2x − 1)(x − 3) = 0 ⇒ x = 1/2 or x = 3.",
      rubric: [{ step: "Correct factorisation or use of formula", marks: 2 }, { step: "Both roots stated", marks: 1 }] }),
    q({ id: "q2", type: "short", text: "Find the 15th term of the AP 7, 11, 15, …", marks: 2, subtopic: "nth term of an AP", topic: "Arithmetic Progressions", solution: "a = 7, d = 4, a₁₅ = 7 + 14·4 = 63.",
      rubric: [{ step: "Identifies a and d and uses aₙ = a + (n−1)d", marks: 1 }, { step: "Correct answer 63", marks: 1 }] }),
    q({ id: "q3", type: "short", text: "If sin θ = 3/5 and θ is acute, find cos θ and tan θ.", marks: 3, subtopic: "Trigonometric ratios from a given ratio", topic: "Trigonometry", solution: "cos θ = 4/5, tan θ = 3/4.",
      rubric: [{ step: "Uses sin²θ + cos²θ = 1 or a right triangle", marks: 1 }, { step: "cos θ = 4/5", marks: 1 }, { step: "tan θ = 3/4", marks: 1 }] }),
  ],
}, {
  name: "Section B - Long answer", instructions: "Answer with complete reasoning.",
  questions: [
    q({ id: "q4", type: "long", text: "Prove that √2 is irrational.", marks: 5, subtopic: "Proof of irrationality", topic: "Real Numbers", solution: "Assume √2 = p/q in lowest terms, then p² = 2q² so p is even; write p = 2k, then q² = 2k² so q is even - contradiction.",
      rubric: [{ step: "Assumes √2 = p/q with p, q coprime", marks: 1 }, { step: "Shows p² = 2q² hence p even", marks: 1.5 }, { step: "Substitutes p = 2k to show q even", marks: 1.5 }, { step: "States the contradiction and conclusion", marks: 1 }] }),
    q({ id: "q5", type: "long", text: "A ladder 10 m long reaches a window 8 m above the ground. Find the distance of the foot of the ladder from the wall, and the angle the ladder makes with the ground.", marks: 5, subtopic: "Heights and distances (right triangle)", topic: "Trigonometry", solution: "Distance = √(100 − 64) = 6 m; sin θ = 8/10 ⇒ θ ≈ 53.1°.",
      rubric: [{ step: "Draws/identifies right triangle", marks: 1 }, { step: "Applies Pythagoras correctly", marks: 1.5 }, { step: "Distance = 6 m", marks: 1 }, { step: "Angle via sin/cos/tan ≈ 53°", marks: 1.5 }] }),
  ],
}];

function paper(title: string, subject: string, board: string, cls: string, sections: Section[], duration: number) {
  const id = uid("qp");
  run(`INSERT INTO question_papers (id, org_id, title, subject, board, class_level, language, duration_min, instructions, sections, total_marks, status, created_by)
       VALUES (?,?,?,?,?,?, 'English', ?, ?, ?, ?, 'approved', ?)`,
    id, org, title, subject, board, cls, duration, "Read every question carefully. Calculators are not allowed.", JSON.stringify(sections), totalMarks(sections), admin);
  return { id, sections, total: totalMarks(sections) };
}
const p1 = paper("Physics Weekly Test - Mechanics & Electricity", "Physics", "JEE Main", "Class 11", physicsMcq, 30);
const p2 = paper("Maths Unit Test - Algebra & Trigonometry", "Mathematics", "CBSE", "Class 10", mathsSubjective, 60);

function synthEval(sections: Section[], skill: number): SheetEvaluation {
  const questions = sections.flatMap((s) => s.questions).map((qq) => {
    const attempted = rand() < 0.92;
    const frac = attempted ? Math.min(1, Math.max(0, skill + (rand() - 0.5) * 0.5)) : 0;
    const objective = qq.type === "mcq" || qq.type === "numeric";
    const correct = objective && attempted && rand() < skill;
    const steps = objective ? [] : qq.rubric.map((r) => ({ step: r.step, max_marks: r.marks, awarded: Math.round(r.marks * Math.min(1, frac + (rand() - 0.5) * 0.3) * 2) / 2, comment: "" }))
      .map((s) => ({ ...s, awarded: Math.max(0, Math.min(s.max_marks, s.awarded)) }));
    const marks = objective ? (!attempted ? 0 : correct ? qq.marks : -qq.negative_marks) : steps.reduce((t, s) => t + s.awarded, 0);
    const types = ["concept", "careless", "incomplete", "presentation"] as const;
    const mistake_type: SheetEvaluation["questions"][number]["mistake_type"] = !attempted ? "not_attempted" : marks >= qq.marks ? "none" : objective ? "concept" : types[Math.floor(rand() * types.length)];
    return { question_id: qq.id, attempted, transcription: "", steps, marks_awarded: marks, max_marks: qq.marks, confidence: "high" as const,
      feedback: !attempted ? "Not attempted." : marks >= qq.marks ? "Fully correct." : `Revise ${qq.topic}.`,
      mistake_type, mistake_note: mistake_type === "none" || mistake_type === "not_attempted" ? "" : `Demo: ${mistake_type} mistake in ${qq.topic}`,
      location: { page: 0, top: 0, bottom: 0, mark_x: 0, mark_y: 0 }, annotations: [] };
  });
  const weak = [...new Set(questions.filter((x) => x.marks_awarded < x.max_marks * 0.5).map((x) => sections.flatMap((s) => s.questions).find((qq) => qq.id === x.question_id)!.topic))];
  return { student_name_on_sheet: null, questions, overall_feedback: "Demo evaluation.", strengths: [], gaps: weak };
}

function test(title: string, p: ReturnType<typeof paper>, mode: "cbt" | "offline", batchIds: string[], daysAgo: number, publish: boolean) {
  const id = uid("tst");
  const when = new Date(Date.now() - daysAgo * 86400000).toISOString();
  run("INSERT INTO tests (id, org_id, paper_id, title, mode, scheduled_at, duration_min, results_published) VALUES (?,?,?,?,?,?,?,?)",
    id, org, p.id, title, mode, when, 60, publish ? 1 : 0);
  for (const b of batchIds) {
    run("INSERT INTO test_batches (test_id, batch_id) VALUES (?,?)", id, b);
    for (const s of students.filter((x) => x.batch === b)) {
      const done = daysAgo > 0;
      const ev = done ? synthEval(p.sections, s.skill + (daysAgo < 10 ? 0.08 : 0)) : null;
      const score = ev ? ev.questions.reduce((t, x) => t + x.marks_awarded, 0) : null;
      run(`INSERT INTO attempts (id, test_id, student_id, status, evaluation, score, max_score, submitted_at, evaluated_at)
           VALUES (?,?,?,?,?,?,?,?,?)`, uid("att"), id, s.id, done ? "evaluated" : "pending", ev && JSON.stringify(ev), score, p.total, done ? when : null, done ? when : null);
    }
  }
}
test("Physics Weekly Test 1", p1, "cbt", [batches[0], batches[1]], 28, true);
test("Physics Weekly Test 2", p1, "cbt", [batches[0], batches[1]], 14, true);
test("Physics Weekly Test 3", p1, "cbt", [batches[0], batches[1]], 3, true);
test("Physics Live Mock", p1, "cbt", [batches[0], batches[1]], 0, false);
test("Maths Unit Test 1", p2, "offline", [batches[2]], 20, true);
test("Maths Unit Test 2", p2, "offline", [batches[2]], 6, true);

run("INSERT INTO notices (id, org_id, title, body, created_by) VALUES (?,?,?,?,?)", uid("ntc"), org, "Diwali break", "The institute will be closed from 29 Oct to 3 Nov. Classes resume on 4 Nov.", admin);
run("INSERT INTO notices (id, org_id, title, body, batch_id, created_by) VALUES (?,?,?,?,?,?)", uid("ntc"), org, "Live mock this Sunday", "Full-syllabus physics mock at 10:00 AM on the portal. Keep your login ready.", batches[0], teachers[0]);
db.exec("COMMIT");

console.log(`Seeded demo institute.
  Admin:    admin@demo.school / demo1234
  Teacher:  teacher1@demo.school / demo1234
  Student:  student / demo1234`);
