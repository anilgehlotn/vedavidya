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
  topic: z.string().describe("Chapter or topic this question tests"),
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
