// All Claude API calls live here: question-paper generation and answer-sheet evaluation.
// Each institute uses its own API key, saved (encrypted) from Settings → AI engine.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import fs from "node:fs";
import path from "node:path";
import { one } from "../db.js";
import { decrypt } from "../secrets.js";
import { GeneratedPaper, SheetEvaluation, PracticePlan, ReteachBrief, type Section } from "./schemas.js";

export const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
const MAX_REQUEST_BYTES = 30 * 1024 * 1024; // API request limit is 32 MB

export class AiError extends Error {}

const clients = new Map<string, Anthropic>();
const makeClient = (apiKey: string) =>
  // The SDK retries 408/409/429/5xx and connection errors with backoff and honours retry-after.
  new Anthropic({ apiKey, maxRetries: 6, timeout: 15 * 60 * 1000 });

function clientFor(orgId: string): Anthropic {
  const org = one<{ is_demo: number; claude_key_enc: string | null }>("SELECT is_demo, claude_key_enc FROM orgs WHERE id = ?", orgId);
  if (!org) throw new AiError("Institute not found.");
  if (org.is_demo) throw new AiError("AI features are switched off in the public demo institute. Create your own institute to use them.");
  const key = decrypt(org.claude_key_enc);
  if (!key) throw new AiError("No Claude API key yet. An admin can add one in Settings → AI engine.");
  let c = clients.get(key);
  if (!c) { c = makeClient(key); clients.set(key, c); }
  return c;
}
export const forgetClients = () => clients.clear();

/** Returns a user-facing reason AI can't run for this institute, or null when it's ready. */
export function aiProblem(orgId: string): string | null {
  try { clientFor(orgId); return null; } catch (e) { return e instanceof AiError ? e.message : String(e); }
}

function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "The Claude API key was rejected. Check it in Settings → AI engine.";
  if (e instanceof Anthropic.PermissionDeniedError) return "This API key doesn't have access to the model. Check your Anthropic Console plan.";
  if (e instanceof Anthropic.RateLimitError) return "Claude is busy for this API key (rate limit). Wait a minute, then click Evaluate again.";
  if (e instanceof Anthropic.BadRequestError) {
    if (/credit balance/i.test(e.message)) return "Your Anthropic account has no credits left. Add credits in the Anthropic Console, then try again.";
    return `Claude couldn't process this request: ${e.message}`;
  }
  if (e instanceof Anthropic.InternalServerError) return "Claude had a temporary problem. Please try again.";
  if (e instanceof Anthropic.APIConnectionTimeoutError) return "The request to Claude timed out. Please try again.";
  if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach Claude. Check the server's internet connection and try again.";
  if (e instanceof Anthropic.APIError) return `Claude API error ${e.status}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

// One structured-output request, streamed (large outputs). Uses server-side refusal fallback;
// if the API rejects that option, retries once without it.
async function structured<T>(orgId: string, opts: {
  system: string;
  content: Anthropic.Beta.BetaContentBlockParam[];
  format: ReturnType<typeof zodOutputFormat<any>>;
  effort: "low" | "medium" | "high";
}): Promise<T> {
  const client = clientFor(orgId);
  const run = async (withFallback: boolean) => {
    const params: any = {
      model: MODEL,
      max_tokens: 64000,
      system: opts.system,
      output_config: { effort: opts.effort, format: opts.format },
      messages: [{ role: "user", content: opts.content }],
    };
    if (withFallback) { params.betas = ["server-side-fallback-2026-07-01"]; params.fallbacks = "default"; }
    const msg: any = await client.beta.messages.stream(params).finalMessage();
    if (msg.stop_reason === "refusal") throw new AiError("Claude declined this request.");
    if (msg.stop_reason === "max_tokens") throw new AiError("The response was too long. Try fewer questions or fewer pages.");
    const text = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    try { return opts.format.parse(text) as T; }
    catch { throw new AiError("Claude's answer couldn't be read. Please try again."); }
  };
  try {
    try { return await run(true); }
    catch (e) {
      if (e instanceof Anthropic.BadRequestError && /fallback|beta/i.test(e.message)) return await run(false);
      throw e;
    }
  } catch (e) {
    if (e instanceof AiError) throw e;
    throw new AiError(describeError(e));
  }
}

/** Checks a key without spending tokens: looks up the model this app uses. */
export async function verifyKey(apiKey: string): Promise<{ ok: true; model: string } | { ok: false; error: string }> {
  try {
    const m = await new Anthropic({ apiKey, maxRetries: 1, timeout: 20000 }).models.retrieve(MODEL);
    return { ok: true, model: (m as any).display_name ?? MODEL };
  } catch (e) {
    if (e instanceof Anthropic.NotFoundError) return { ok: false, error: `The key works, but this account can't use ${MODEL}.` };
    return { ok: false, error: describeError(e) };
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

export async function generatePaper(orgId: string, spec: PaperSpec) {
  const layout = spec.sections
    .map((s, i) => `${i + 1}. "${s.name}": ${s.count} × ${s.type} questions, ${s.marks_each} marks each${s.negative_marks ? `, -${s.negative_marks} for wrong answers` : ""}`)
    .join("\n");
  return structured<{ title: string; instructions: string; sections: Section[] }>(orgId, {
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

const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".pdf": "application/pdf" };

function fileBlocks(files: string[]): Anthropic.Beta.BetaContentBlockParam[] {
  let total = 0;
  return files.map((file) => {
    const mime = MIME[path.extname(file).toLowerCase()];
    if (!mime) throw new AiError(`Unsupported file type: ${path.basename(file)}`);
    if (!fs.existsSync(file)) throw new AiError("An uploaded page is missing. Please upload this student's sheet again.");
    const data = fs.readFileSync(file).toString("base64");
    total += data.length;
    if (total > MAX_REQUEST_BYTES) throw new AiError("This answer sheet is too large to send in one go. Upload fewer or smaller pages.");
    if (mime === "application/pdf") return { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
    return { type: "image", source: { type: "base64", media_type: mime as "image/jpeg", data } };
  });
}

export async function evaluateSheet(orgId: string, paper: { title: string; subject: string | null; sections: Section[] }, files: string[]) {
  if (!files.length) throw new AiError("No pages uploaded for this student.");
  const key = paper.sections.flatMap((s) => s.questions).map((q) => ({
    id: q.id, type: q.type, marks: q.marks, negative_marks: q.negative_marks, question: q.text,
    options: q.options.length ? q.options : undefined,
    correct_option: q.correct_option, numeric_answer: q.numeric_answer,
    model_solution: q.solution, rubric: q.rubric,
  }));
  const blocks = fileBlocks(files);
  return structured<import("./schemas.js").SheetEvaluation>(orgId, {
    effort: "high",
    format: zodOutputFormat(SheetEvaluation),
    system:
      "You are a meticulous, fair examiner grading handwritten answer sheets like an experienced teacher. " +
      "Read the student's handwriting carefully (including Hindi/Sanskrit/regional scripts, formulas and diagrams). " +
      "Grade every question in the answer key: award step-wise partial credit strictly according to the rubric, accept valid alternative methods, " +
      "and never award more than a step's maximum. For objective questions award full marks if correct, minus negative_marks if wrong, 0 if unattempted. " +
      "If a question is not attempted, mark attempted=false with 0 marks. If handwriting is unclear, give your best reading and set confidence to low. " +
      "marks_awarded must equal the sum of awarded step marks (or the objective result). " +
      "For every question where marks were lost, classify the main cause in mistake_type and name the exact slip in mistake_note, " +
      "so the student knows precisely what to fix. Use mistake_type none only for full marks.",
    content: [
      ...blocks,
      {
        type: "text",
        text: `These pages are one student's answer sheet for "${paper.title}" (${paper.subject ?? ""}).\n\nAnswer key with rubrics (JSON):\n${JSON.stringify(key)}\n\nEvaluate every question in the answer key, in order.`,
      },
    ],
  });
}

export interface ImportMeta { subject?: string; board?: string; class_level?: string; language?: string; notes?: string }

/** Reads an existing question paper (photos/PDF) and, optionally, its answer key, into an editable paper. */
export async function importPaper(orgId: string, paperFiles: string[], keyFiles: string[], meta: ImportMeta) {
  if (!paperFiles.length) throw new AiError("Upload at least one page of the question paper.");
  const paperBlocks = fileBlocks([...paperFiles, ...keyFiles]);
  const qBlocks = paperBlocks.slice(0, paperFiles.length);
  const kBlocks = paperBlocks.slice(paperFiles.length);
  return structured<{ title: string; instructions: string; sections: Section[] }>(orgId, {
    effort: "high",
    format: zodOutputFormat(GeneratedPaper),
    system:
      "You digitise question papers for Indian schools and coaching institutes. Transcribe every question exactly as printed " +
      "(keep the original wording, language, numbering order, options, sections and marks). Never invent, drop or merge questions. " +
      "Use the answer key when provided; otherwise solve each question carefully yourself. For every question write a worked solution " +
      "and a step-wise marking rubric whose step marks add up exactly to the question's marks. If a question's marks are not printed, " +
      "use the section's marking or a sensible value and mention it in the paper instructions.",
    content: [
      { type: "text", text: "QUESTION PAPER pages:" },
      ...qBlocks,
      ...(kBlocks.length ? [{ type: "text" as const, text: "ANSWER KEY / MARKING SCHEME pages:" }, ...kBlocks] : []),
      {
        type: "text",
        text:
          `Transcribe this question paper into the required structure.\n` +
          (meta.subject ? `Subject: ${meta.subject}\n` : "") + (meta.board ? `Board/Exam: ${meta.board}\n` : "") +
          (meta.class_level ? `Class: ${meta.class_level}\n` : "") + (meta.language ? `Language: ${meta.language}\n` : "") +
          (meta.notes ? `Teacher's note: ${meta.notes}\n` : "") +
          `Number question ids sequentially (q1, q2, ...). Use type mcq for single-correct multiple choice (exactly 4 options when the paper has 4; ` +
          `if it has a different number of options, still list them all), numeric for numerical-answer questions, short or long for written answers. ` +
          (kBlocks.length ? "Take correct answers and marking from the answer key." : "No answer key was provided: solve each question yourself."),
      },
    ],
  });
}

export interface LostQuestion {
  question: string; topic: string; marks: number; awarded: number; mistake_type: string; mistake_note: string;
  missed_steps: string[]; student_wrote: string; feedback: string;
}

/** A personal Fix-it set: practice now on exactly what was lost, plus a later check-up on the same skills. */
export async function generatePractice(orgId: string, ctx: {
  studentFirstName: string; subject: string | null; classLevel: string | null; language: string; lost: LostQuestion[];
  practiceCount: number; checkupCount: number;
}) {
  return structured<import("./schemas.js").PracticePlan>(orgId, {
    effort: "medium",
    format: zodOutputFormat(PracticePlan),
    system:
      "You are a caring, expert tutor for Indian school and coaching students. You design short, targeted practice that fixes the " +
      "specific mistakes a student made in a test. Every question must be auto-markable (single-correct MCQ with 4 options, or numeric), " +
      "unambiguous, correct, at the student's level, and aimed at one of the listed mistakes. Order practice from easier to harder. " +
      "Explanations teach the exact step the student got wrong in 2-4 short sentences. Check-up questions test the same skills with new numbers " +
      "and contexts (never repeat practice questions) so that improvement can be measured.",
    content: [{
      type: "text",
      text:
        `Student: ${ctx.studentFirstName}\nSubject: ${ctx.subject ?? "-"}\nClass: ${ctx.classLevel ?? "-"}\nWrite questions in: ${ctx.language}\n\n` +
        `Questions where the student lost marks (JSON):\n${JSON.stringify(ctx.lost)}\n\n` +
        `Create a Fix-it practice plan with exactly ${ctx.practiceCount} practice questions (ids p1..p${ctx.practiceCount}) and exactly ` +
        `${ctx.checkupCount} check-up questions (ids c1..c${ctx.checkupCount}). Give more questions to the mistakes that cost the most marks.`,
    }],
  });
}

/** One brief per test for the teacher: the class's main misconceptions and how to re-teach them tomorrow. */
export async function generateBrief(orgId: string, ctx: {
  title: string; subject: string | null; students: number; questions: unknown[]; examples: unknown[]; mistakeTotals: Record<string, number>;
}) {
  return structured<import("./schemas.js").ReteachBrief>(orgId, {
    effort: "medium",
    format: zodOutputFormat(ReteachBrief),
    system:
      "You are an experienced head of department helping a teacher plan tomorrow's lesson after a test. Identify the 2-4 misconceptions " +
      "that cost the class the most marks, using the per-question statistics and real (anonymised) student answers provided. " +
      "Never include student names. Re-teach plans must be practical for a normal classroom, about 10 minutes each.",
    content: [{
      type: "text",
      text:
        `Test: ${ctx.title} (${ctx.subject ?? ""}), ${ctx.students} students marked.\n\n` +
        `Marks lost by mistake type across the class: ${JSON.stringify(ctx.mistakeTotals)}\n\n` +
        `Per-question results (JSON):\n${JSON.stringify(ctx.questions)}\n\n` +
        `Sample anonymised wrong answers (JSON):\n${JSON.stringify(ctx.examples)}\n\nWrite the re-teach brief.`,
    }],
  });
}
