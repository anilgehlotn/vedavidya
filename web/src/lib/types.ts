export type Role = "admin" | "teacher" | "student";
export interface User { id: string; org_id: string; role: Role; name: string; email: string | null }
export interface Org { id: string; name: string; city: string | null }

export interface RubricStep { step: string; marks: number }
export interface Question {
  id: string; type: "mcq" | "numeric" | "short" | "long"; text: string; options: string[];
  correct_option: number | null; numeric_answer: number | null; marks: number; negative_marks: number;
  difficulty: "easy" | "medium" | "hard"; topic: string; subtopic?: string; solution: string; rubric: RubricStep[];
}
export interface Section { name: string; instructions: string; questions: Question[] }
export interface Paper {
  id: string; title: string; subject: string | null; board: string | null; class_level: string | null; language: string;
  duration_min: number; total_marks: number; status: "generating" | "draft" | "approved" | "failed";
  sections: Section[]; instructions: string | null; error: string | null; created_at: string;
}
export interface QuestionEvaluation {
  question_id: string; attempted: boolean; transcription: string;
  steps: { step: string; max_marks: number; awarded: number; comment: string }[];
  marks_awarded: number; max_marks: number; feedback: string; confidence: "high" | "medium" | "low";
  mistake_type?: string; mistake_note?: string;
}
export interface SheetEvaluation {
  student_name_on_sheet: string | null; questions: QuestionEvaluation[]; overall_feedback: string; strengths: string[]; gaps: string[];
}
export type AttemptStatus = "pending" | "in_progress" | "uploaded" | "evaluating" | "evaluated" | "failed";
