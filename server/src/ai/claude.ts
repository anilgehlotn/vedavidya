// All Claude API calls live here: question-paper generation and answer-sheet evaluation.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import fs from "node:fs";
import path from "node:path";
import { GeneratedPaper, SheetEvaluation, type Section } from "./schemas.js";

const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic());

export class AiError extends Error {}

function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "Claude API key missing or invalid. Set ANTHROPIC_API_KEY in server/.env.";
  if (e instanceof Anthropic.RateLimitError) return "Claude API rate limit reached - try again shortly.";
  if (e instanceof Anthropic.BadRequestError) return `Claude rejected the request: ${e.message}`;
  if (e instanceof Anthropic.APIError) return `Claude API error ${e.status}: ${e.message}`;
  if (e instanceof Error && /api key|apiKey|authentication/i.test(e.message)) return "Claude API key missing. Set ANTHROPIC_API_KEY in server/.env.";
  return e instanceof Error ? e.message : String(e);
}

// Runs a structured-output request with streaming (large outputs) and refusal fallback.
async function structured<T>(opts: {
  system: string;
  content: Anthropic.Beta.BetaContentBlockParam[];
  format: ReturnType<typeof zodOutputFormat<any>>;
  effort: "low" | "medium" | "high";
}): Promise<T> {
  try {
    const stream = getClient().beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: opts.system,
      output_config: { effort: opts.effort, format: opts.format },
      messages: [{ role: "user", content: opts.content }],
    } as any);
    const msg: any = await stream.finalMessage();
    if (msg.stop_reason === "refusal") throw new AiError("Claude declined this request.");
    if (msg.stop_reason === "max_tokens") throw new AiError("Response was too long - try fewer questions or pages.");
    const text = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    return opts.format.parse(text) as T;
  } catch (e) {
    if (e instanceof AiError) throw e;
    throw new AiError(describeError(e));
  }
}

export interface PaperSpec {
  subject: string;
  board: string;
  class_level: string;
  topics: string;
  language: string;
  difficulty: "easy" | "medium" | "hard" | "mixed";
  duration_min: number;
  sections: { name: string; type: "mcq" | "numeric" | "short" | "long"; count: number; marks_each: number; negative_marks: number }[];
  notes?: string;
}

export async function generatePaper(spec: PaperSpec) {
  const layout = spec.sections
    .map((s, i) => `${i + 1}. "${s.name}": ${s.count} × ${s.type} questions, ${s.marks_each} marks each${s.negative_marks ? `, -${s.negative_marks} for wrong answers` : ""}`)
    .join("\n");
  return structured<{ title: string; instructions: string; sections: Section[] }>({
    effort: "medium",
    format: zodOutputFormat(GeneratedPaper),
    system:
      "You are an expert paper-setter for Indian schools and coaching institutes (CBSE, ICSE, state boards, JEE, NEET, UPSC, CA). " +
      "You write original, unambiguous, syllabus-aligned questions with correct answers, worked solutions and step-wise marking rubrics " +
      "whose step marks add up exactly to each question's marks. Objective questions have exactly one correct option.",
    content: [{
      type: "text",
      text:
        `Create an original question paper.\n\nSubject: ${spec.subject}\nBoard/Exam: ${spec.board}\nClass/Level: ${spec.class_level}\n` +
        `Topics to cover: ${spec.topics}\nLanguage of questions: ${spec.language}\nDifficulty: ${spec.difficulty}\nDuration: ${spec.duration_min} minutes\n\n` +
        `Sections (follow exactly, in this order, with these exact counts and marks):\n${layout}\n` +
        (spec.notes ? `\nAdditional instructions from the teacher: ${spec.notes}\n` : "") +
        `\nNumber question ids sequentially across the paper (q1, q2, ...). Spread questions across the listed topics.`,
    }],
  });
}

const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".pdf": "application/pdf" };

function fileBlock(file: string): Anthropic.Beta.BetaContentBlockParam {
  const mime = MIME[path.extname(file).toLowerCase()];
  if (!mime) throw new AiError(`Unsupported file type: ${path.basename(file)}`);
  const data = fs.readFileSync(file).toString("base64");
  if (mime === "application/pdf") return { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  return { type: "image", source: { type: "base64", media_type: mime as any, data } };
}

export async function evaluateSheet(paper: { title: string; subject: string | null; sections: Section[] }, files: string[]) {
  const key = paper.sections.flatMap((s) => s.questions).map((q) => ({
    id: q.id, type: q.type, marks: q.marks, negative_marks: q.negative_marks, question: q.text,
    options: q.options.length ? q.options : undefined,
    correct_option: q.correct_option, numeric_answer: q.numeric_answer,
    model_solution: q.solution, rubric: q.rubric,
  }));
  return structured<import("./schemas.js").SheetEvaluation>({
    effort: "high",
    format: zodOutputFormat(SheetEvaluation),
    system:
      "You are a meticulous, fair examiner grading handwritten answer sheets like an experienced teacher. " +
      "Read the student's handwriting carefully (including Hindi/Sanskrit/regional scripts, formulas and diagrams). " +
      "Grade every question in the answer key: award step-wise partial credit strictly according to the rubric, accept valid alternative methods, " +
      "and never award more than a step's maximum. For objective questions award full marks if correct, minus negative_marks if wrong, 0 if unattempted. " +
      "If a question is not attempted, mark attempted=false with 0 marks. If handwriting is unclear, give your best reading and set confidence to low. " +
      "marks_awarded must equal the sum of awarded step marks (or the objective result).",
    content: [
      ...files.map(fileBlock),
      {
        type: "text",
        text: `These pages are one student's answer sheet for "${paper.title}" (${paper.subject ?? ""}).\n\nAnswer key with rubrics (JSON):\n${JSON.stringify(key)}\n\nEvaluate every question in the answer key, in order.`,
      },
    ],
  });
}
