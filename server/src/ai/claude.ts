// All Claude API calls live here: question-paper generation and answer-sheet evaluation.
// Each institute uses its own API key, saved (encrypted) from Settings → AI engine.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import fs from "node:fs";
import path from "node:path";
import { one } from "../db.js";
import { decrypt } from "../secrets.js";
import { GeneratedPaper, SheetEvaluation, type Section } from "./schemas.js";

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
      "marks_awarded must equal the sum of awarded step marks (or the objective result).",
    content: [
      ...blocks,
      {
        type: "text",
        text: `These pages are one student's answer sheet for "${paper.title}" (${paper.subject ?? ""}).\n\nAnswer key with rubrics (JSON):\n${JSON.stringify(key)}\n\nEvaluate every question in the answer key, in order.`,
      },
    ],
  });
}
