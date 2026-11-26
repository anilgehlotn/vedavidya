// Shows AI feedback and questions with proper maths: $...$, $$...$$, \(...\) and \[...\] become typeset
// formulas (KaTeX), and lines starting with "- " become a bullet list. Everything else is plain text.
import katex from "katex";
import "katex/dist/katex.min.css";

const MATH = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$(?!\s)([^$\n]+?)(?<!\s)\$/g;

function Inline({ text }: { text: string }) {
  const out: (string | { html: string; block: boolean })[] = [];
  let last = 0;
  for (const m of text.matchAll(MATH)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const expr = m[1] ?? m[2] ?? m[3] ?? m[4] ?? "";
    const block = Boolean(m[1] ?? m[2]);
    // KaTeX escapes everything it outputs; trust:false blocks links and HTML in formulas.
    out.push({ html: katex.renderToString(expr, { throwOnError: false, displayMode: block, trust: false, strict: "ignore", output: "html" }), block });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out.map((p, i) => (typeof p === "string" ? <span key={i}>{p}</span>
    : <span key={i} className={p.block ? "math-block" : undefined} dangerouslySetInnerHTML={{ __html: p.html }} />))}</>;
}

/** Plain text with maths; "- " lines become bullets, other lines become paragraphs. */
export function MathText({ text, className }: { text: string | null | undefined; className?: string }) {
  if (!text) return null;
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const blocks: ({ list: string[] } | string)[] = [];
  for (const l of lines) {
    const b = l.match(/^[-•*]\s+(.*)$/);
    if (b) { const prev = blocks[blocks.length - 1]; if (prev && typeof prev !== "string") prev.list.push(b[1]); else blocks.push({ list: [b[1]] }); }
    else blocks.push(l);
  }
  return (
    <div className={`math-text ${className ?? ""}`}>
      {blocks.map((b, i) => (typeof b === "string" ? <p key={i}><Inline text={b} /></p>
        : <ul key={i}>{b.list.map((x, j) => <li key={j}><Inline text={x} /></li>)}</ul>))}
    </div>
  );
}
