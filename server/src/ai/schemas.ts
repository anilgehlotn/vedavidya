import { z } from "zod";

// A rubric step: what a correct answer must show, and the marks it earns.
export const RubricStep = z.object({
  step: z.string().describe("What the student must show or state for this step"),
  marks: z.number().describe("Marks awarded for this step"),
});

export const Question = z.object({
  id: z.string().describe("Short unique id like q1, q2"),
  type: z.enum(["mcq", "numeric", "short", "long"]),
  text: z.string().describe("Question text. Use plain text; LaTeX-style math allowed inline"),
  options: z.array(z.string()).describe("Exactly 4 options for mcq, empty array otherwise"),
  correct_option: z.number().nullable().describe("0-based index of the correct option for mcq, else null"),
  numeric_answer: z.number().nullable().describe("Exact answer for numeric type, else null"),
  marks: z.number(),
  negative_marks: z.number().describe("Marks deducted for a wrong objective answer, 0 if none"),
  difficulty: z.enum(["easy", "medium", "hard"]),
  topic: z.string().describe("Chapter name only, e.g. 'Trigonometry' or 'Current Electricity'"),
  subtopic: z.string().describe("The exact sub-topic / concept within the chapter that this question tests, specific enough for a teacher to re-teach, e.g. 'Trigonometric ratios from a given ratio' or 'Equivalent resistance in parallel'"),
  solution: z.string().describe("Worked model solution"),
  rubric: z.array(RubricStep).describe("Step-wise marking scheme; step marks sum to the question marks"),
});
export type Question = z.infer<typeof Question>;

export const Section = z.object({
  name: z.string(),
  instructions: z.string(),
  questions: z.array(Question),
});
export type Section = z.infer<typeof Section>;

// Papers saved by teachers: the sub-topic is optional (older papers and hand-written questions may not have one).
export const StoredQuestion = Question.extend({ subtopic: z.string().max(160).default("") });
export const StoredSection = Section.extend({ questions: z.array(StoredQuestion) });

/** Chapter + exact sub-topic for each question of an existing paper. */
export const SubtopicTags = z.object({
  questions: z.array(z.object({ id: z.string(), topic: z.string().describe("Chapter name"), subtopic: z.string().describe("Exact sub-topic / concept tested") })),
});
export type SubtopicTags = z.infer<typeof SubtopicTags>;

export const GeneratedPaper = z.object({
  title: z.string(),
  instructions: z.string().describe("General instructions printed at the top of the paper"),
  sections: z.array(Section),
});

// Evaluation of one question in a student's answer sheet.
export const QuestionEvaluation = z.object({
  question_id: z.string(),
  attempted: z.boolean(),
  transcription: z.string().describe("Faithful transcription of what the student wrote for this question"),
  steps: z.array(z.object({
    step: z.string(),
    max_marks: z.number(),
    awarded: z.number(),
    comment: z.string(),
  })),
  marks_awarded: z.number(),
  max_marks: z.number(),
  feedback: z.string().describe("One or two sentences of actionable feedback for the student"),
  confidence: z.enum(["high", "medium", "low"]).describe("Low when handwriting is illegible or ambiguous"),
  mistake_type: z.enum(["none", "concept", "careless", "incomplete", "presentation", "not_attempted"]).describe(
    "Main reason marks were lost: none (full marks), concept (misunderstood the idea/method), careless (arithmetic, sign, copying or unit slip), " +
    "incomplete (stopped early or skipped required steps), presentation (right idea but missing working, labels, diagram or final statement), not_attempted"),
  mistake_note: z.string().describe("One short sentence naming the exact mistake, e.g. 'Forgot to square the radius'. Empty when mistake_type is none"),
  location: z.object({
    page: z.number().describe("The 'Page N' number where this answer's final line is written; 0 if not attempted or not found"),
    top: z.number().describe("Top edge of this answer on that page, as a fraction of the page height from the top (0 to 1)"),
    bottom: z.number().describe("Bottom edge of this answer on that page, as a fraction of the page height (0 to 1)"),
    mark_x: z.number().describe("Where a teacher would put the tick or cross: just to the right of the end of the final answer, as a fraction of the page width from the left (0 to 1)"),
    mark_y: z.number().describe("Vertical position of that tick or cross, as a fraction of the page height from the top (0 to 1)"),
  }).describe("Where the answer is on the student's pages, so the marked sheet can be drawn like a teacher's correction"),
});
export type QuestionEvaluation = z.infer<typeof QuestionEvaluation>;

export const SheetEvaluation = z.object({
  student_name_on_sheet: z.string().nullable(),
  questions: z.array(QuestionEvaluation),
  overall_feedback: z.string(),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()).describe("Topics or skills the student should revise"),
});
export type SheetEvaluation = z.infer<typeof SheetEvaluation>;

export const MISTAKE_TYPES = ["concept", "careless", "incomplete", "presentation", "not_attempted"] as const;
export type MistakeType = (typeof MISTAKE_TYPES)[number] | "none";

// ---- Fix-it practice ----
export const PracticeQuestion = z.object({
  id: z.string().describe("p1, p2, ... for practice; c1, c2, ... for the check-up"),
  type: z.enum(["mcq", "numeric"]),
  text: z.string(),
  options: z.array(z.string()).describe("Exactly 4 options for mcq, empty array for numeric"),
  correct_option: z.number().nullable().describe("0-based index for mcq, else null"),
  numeric_answer: z.number().nullable().describe("Exact answer for numeric, else null"),
  topic: z.string(),
  targets: z.string().describe("Which of the student's mistakes this question fixes, in a few words"),
  explanation: z.string().describe("Short worked explanation shown after the student answers"),
});
export type PracticeQuestion = z.infer<typeof PracticeQuestion>;

export const PracticePlan = z.object({
  focus: z.string().describe("Two friendly sentences to the student: what they will fix and why it matters"),
  practice: z.array(PracticeQuestion),
  checkup: z.array(PracticeQuestion),
});
export type PracticePlan = z.infer<typeof PracticePlan>;

// ---- Re-teach brief for teachers ----
export const ReteachBrief = z.object({
  summary: z.string().describe("Two or three sentences on how the class did and the main pattern"),
  misconceptions: z.array(z.object({
    title: z.string(),
    explanation: z.string().describe("What students think and why it is wrong"),
    students_affected: z.number().describe("How many students showed this misconception"),
    example: z.string().describe("A short, anonymised example of a real wrong answer from the class"),
    reteach_plan: z.string().describe("A 10-minute re-teach plan for the next class"),
    check_question: z.string().describe("One quick question to check understanding after re-teaching"),
  })),
  next_steps: z.array(z.string()),
});
export type ReteachBrief = z.infer<typeof ReteachBrief>;
