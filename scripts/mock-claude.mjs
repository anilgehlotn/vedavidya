// A stand-in for the Anthropic Messages API, used only for testing without a real key.
// Mirrors the real API's streaming format and its limits, and can inject 429/529 errors.
// Usage: MOCK_PORT=4999 MOCK_FAIL_RATE=0.2 node scripts/mock-claude.mjs
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT ?? 4999);
const FAIL_RATE = Number(process.env.MOCK_FAIL_RATE ?? 0);
const VALID_KEY = /^sk-ant-test-valid/;
const stats = { messages: 0, failsInjected: 0, models: 0, rejected: [] };

const send = (res, status, body, headers = {}) => { res.writeHead(status, { "content-type": "application/json", "request-id": "req_mock", ...headers }); res.end(JSON.stringify(body)); };
const apiError = (res, status, type, message, headers) => send(res, status, { type: "error", error: { type, message } }, headers);

function checkSchema(node, where = "$") {
  // Structured outputs require closed objects; make sure the app's schemas satisfy that.
  if (!node || typeof node !== "object") return;
  if (node.type === "object" && node.additionalProperties !== false) throw new Error(`schema object at ${where} must set additionalProperties:false`);
  if (node.type === "object" && node.properties) {
    const req = new Set(node.required ?? []);
    for (const k of Object.keys(node.properties)) if (!req.has(k)) throw new Error(`schema property ${where}.${k} must be required`);
  }
  for (const [k, v] of Object.entries(node)) if (v && typeof v === "object") checkSchema(v, `${where}.${k}`);
}

const rnd = (a, b) => a + Math.random() * (b - a);
const half = (x) => Math.round(x * 2) / 2;

function paperFrom(text) {
  const lines = [...text.matchAll(/\d+\. "([^"]+)": (\d+) × (\w+) questions, ([\d.]+) marks each(?:, -([\d.]+))?/g)];
  let n = 0;
  return {
    title: "Mock Paper",
    instructions: "Answer all questions.",
    sections: lines.map(([, name, count, type, marks, neg]) => ({
      name, instructions: "",
      questions: Array.from({ length: Number(count) }, () => {
        n++;
        const m = Number(marks);
        return {
          id: `q${n}`, type, text: `Mock question ${n}`, options: type === "mcq" ? ["A", "B", "C", "D"] : [],
          correct_option: type === "mcq" ? n % 4 : null, numeric_answer: type === "numeric" ? n * 2 : null,
          marks: m, negative_marks: Number(neg ?? 0), difficulty: "medium", topic: ["Algebra", "Geometry", "Trigonometry"][n % 3],
          solution: "Mock solution", rubric: [{ step: "Method", marks: m / 2 }, { step: "Answer", marks: m / 2 }],
        };
      }),
    })),
  };
}

function importedPaper(content, hasKey) {
  const pages = content.filter((b) => b.type === "image" || b.type === "document").length;
  stats.lastImport = { pages, hasKey };
  const mk = (n, type, marks) => ({ id: `q${n}`, type, text: `Printed question ${n}`, options: type === "mcq" ? ["A", "B", "C", "D"] : [],
    correct_option: type === "mcq" ? 1 : null, numeric_answer: null, marks, negative_marks: 0, difficulty: "medium", topic: "Imported",
    solution: hasKey ? "From answer key" : "Solved", rubric: [{ step: "Working", marks: marks / 2 }, { step: "Answer", marks: marks / 2 }] });
  return { title: "Imported Unit Test", instructions: "All questions compulsory.", sections: [
    { name: "Section A", instructions: "", questions: [mk(1, "mcq", 1), mk(2, "mcq", 1)] },
    { name: "Section B", instructions: "", questions: [mk(3, "short", 3), mk(4, "long", 5)] }] };
}

function evaluationFrom(text) {
  const key = JSON.parse(text.split("Answer key with rubrics (JSON):\n")[1].split("\n\nEvaluate every question")[0]);
  return {
    student_name_on_sheet: null,
    questions: key.map((q) => {
      const steps = (q.rubric ?? []).map((r) => ({ step: r.step, max_marks: r.marks, awarded: half(rnd(0, r.marks)), comment: "" }));
      const sum = steps.reduce((t, s) => t + s.awarded, 0);
      // Occasionally over-award, to prove the app clamps marks to the paper's maximum.
      return { question_id: q.id, attempted: true, transcription: "x = 3", steps, marks_awarded: Math.random() < 0.1 ? q.marks + 5 : sum,
        max_marks: q.marks, feedback: "Mock feedback", confidence: Math.random() < 0.1 ? "low" : "high" };
    }),
    overall_feedback: "Mock overall", strengths: ["Algebra"], gaps: ["Trigonometry"],
  };
}

function streamText(res, model, text) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", "request-id": "req_mock" });
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  ev("message_start", { message: { id: "msg_mock", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1 } } });
  ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
  for (let i = 0; i < text.length; i += 400) ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: text.slice(i, i + 400) } });
  ev("content_block_stop", { index: 0 });
  ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 500 } });
  ev("message_stop", {});
  res.end();
}

http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/__stats") return send(res, 200, stats);
    const key = req.headers["x-api-key"] ?? String(req.headers.authorization ?? "").replace(/^Bearer /, "");
    if (!key || !VALID_KEY.test(String(key))) return apiError(res, 401, "authentication_error", "invalid x-api-key");

    if (req.method === "GET" && url.pathname.startsWith("/v1/models/")) {
      stats.models++;
      const id = decodeURIComponent(url.pathname.split("/").pop());
      return send(res, 200, { type: "model", id, display_name: "Claude (mock)", created_at: "2026-01-01T00:00:00Z" });
    }
    if (req.method === "POST" && url.pathname === "/v1/messages") {
      const raw = Buffer.concat(chunks);
      if (raw.length > 32 * 1024 * 1024) return apiError(res, 413, "request_too_large", "Request exceeds the maximum allowed size");
      let body;
      try { body = JSON.parse(raw.toString()); } catch { return apiError(res, 400, "invalid_request_error", "bad json"); }
      const reject = (m) => { stats.rejected.push(m); return apiError(res, 400, "invalid_request_error", m); };
      if (!body.model || !body.max_tokens || !Array.isArray(body.messages)) return reject("missing model/max_tokens/messages");
      if (!body.stream) return reject("expected a streaming request");
      const fmt = body.output_config?.format;
      if (fmt?.type !== "json_schema" || !fmt.schema) return reject("expected output_config.format json_schema");
      try { checkSchema(fmt.schema); } catch (e) { return reject(String(e.message)); }
      const content = body.messages[0].content;
      for (const b of content) {
        if (b.type === "image") {
          const bytes = Buffer.from(b.source.data, "base64").length;
          if (bytes > 5 * 1024 * 1024) return reject(`image exceeds 5 MB maximum: ${bytes} bytes`);
          if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(b.source.media_type)) return reject("bad media type");
        }
        if (b.type === "document" && b.source.media_type !== "application/pdf") return reject("bad document type");
      }
      stats.messages++;
      if (Math.random() < FAIL_RATE) {
        stats.failsInjected++;
        return Math.random() < 0.5
          ? apiError(res, 429, "rate_limit_error", "rate limited", { "retry-after": "1" })
          : apiError(res, 529, "overloaded_error", "Overloaded");
      }
      const text = content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const out = /Create an original question paper/.test(text) ? paperFrom(text)
        : /Transcribe this question paper/.test(text) ? importedPaper(content, /ANSWER KEY/.test(text))
        : evaluationFrom(text);
      return setTimeout(() => streamText(res, body.model, JSON.stringify(out)), rnd(100, 600));
    }
    apiError(res, 404, "not_found_error", `no route ${req.method} ${url.pathname}`);
  });
}).listen(PORT, () => console.log(`mock Claude on :${PORT} (fail rate ${FAIL_RATE})`));
