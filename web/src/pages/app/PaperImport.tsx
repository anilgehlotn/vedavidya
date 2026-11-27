// Importing a printed question paper: upload the PDF/photos (resumable, checked), choose where the
// answers come from, and queue it for reading. Used from Question Papers and from a test's paper step.
import { useState } from "react";
import { api } from "../../lib/api";
import type { UploadedFile } from "../../lib/chunkUpload";
import { FileUpload } from "../../components/FileUpload";
import { ErrorBox, useApi } from "../../components/ui";
import type { Course } from "./Courses";
import { useToast } from "../../components/toast";
import { CreditLine } from "./Credits";

type KeyMode = "auto" | "in_paper" | "separate";
const KEY_OPTIONS: { id: KeyMode; title: string; desc: string }[] = [
  { id: "auto", title: "Auto-generate solutions", desc: "AI solves every question and writes a model solution with step marks." },
  { id: "in_paper", title: "Answers are in this PDF", desc: "The answers or solutions are printed in the same file; AI extracts them." },
  { id: "separate", title: "I have a separate answer key", desc: "Upload the answer key or marking scheme as a second file." },
];

/** Quick rules a teacher can add to "my own marking rules" with one tap. */
const RULE_CHIPS = ["Units are required for full marks", "Accept any correct method", "Ignore spelling mistakes", "Labelled diagrams carry marks",
  "No marks for the final answer without working", "Half marks for the correct formula"];

export function ImportPaperForm({ defaults, showMeta, onCreated, onCancel }: {
  defaults?: { subject?: string | null; class_level?: string | null; folder_id?: string | null };
  showMeta?: boolean;
  onCreated: (paperId: string) => void | Promise<void>;
  onCancel?: () => void;
}) {
  const [paper, setPaper] = useState<UploadedFile[]>([]);
  const [paperBusy, setPaperBusy] = useState(false);
  const [key, setKey] = useState<UploadedFile[]>([]);
  const [keyBusy, setKeyBusy] = useState(false);
  const [mode, setMode] = useState<KeyMode>("auto");
  const [meta, setMeta] = useState({ subject: defaults?.subject ?? "", class_level: defaults?.class_level ?? "", board: "CBSE", duration_min: "60" });
  const [criteria, setCriteria] = useState<"auto" | "custom">("auto");
  const [rules, setRules] = useState("");
  const [place, setPlace] = useState({ course_id: "", subject_id: "" });
  const courses = useApi<Course[]>(showMeta ? "/courses" : null);
  const subjects = courses.data?.find((c) => c.id === place.course_id)?.subjects ?? [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const addRule = (r: string) => setRules((t) => (t.includes(r) ? t : `${t.trim()}${t.trim() ? "\n" : ""}${r}`));
  const ready = paper.length > 0 && !paperBusy && !keyBusy && (mode !== "separate" || key.length > 0) && (criteria === "auto" || rules.trim().length > 0);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api<{ id: string }>("/papers/import", { body: {
        paper_uploads: paper.map((p) => p.id), key_uploads: mode === "separate" ? key.map((k) => k.id) : [], key_mode: mode,
        subject: meta.subject || undefined, class_level: meta.class_level || undefined, board: meta.board || undefined, duration_min: Number(meta.duration_min) || undefined,
        marking_notes: criteria === "custom" ? rules.trim() : undefined,
        course_id: place.course_id || null, subject_id: place.subject_id || null, folder_id: defaults?.folder_id || null,
      } });
      toast.info("The AI is reading your paper. This usually takes 1–3 minutes.");
      await onCreated(r.id);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  };

  return (
    <div className="stack">
      <div className="step-label"><span>1</span>Question paper</div>
      <FileUpload purpose="paper" multiple label="PDF or photos of the paper" hint="One PDF (up to 50 MB, 50 pages) or photos of each page" onChange={(u, b) => { setPaper(u); setPaperBusy(b); }} />
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="step-label"><span>2</span>Answer key</legend>
        <div className="stack" style={{ gap: 8 }}>
          {KEY_OPTIONS.map((o) => (
            <label key={o.id} className={`mode-opt ${mode === o.id ? "on" : ""}`}>
              <input type="radio" name="key-mode" checked={mode === o.id} onChange={() => setMode(o.id)} />
              <span className="grow"><b>{o.title}</b><span className="small muted" style={{ display: "block" }}>{o.desc}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      {mode === "separate" && <FileUpload purpose="answer_key" multiple label="Answer key / marking scheme" onChange={(u, b) => { setKey(u); setKeyBusy(b); }} />}
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="step-label"><span>3</span>Evaluation criteria</legend>
        <div className="seg-choice" role="radiogroup" aria-label="Evaluation criteria">
          <label className={criteria === "auto" ? "on" : ""}><input type="radio" name="criteria" checked={criteria === "auto"} onChange={() => setCriteria("auto")} />
            <b>Automatic</b><span className="small muted">AI writes step-wise marks for every question from its solution.</span></label>
          <label className={criteria === "custom" ? "on" : ""}><input type="radio" name="criteria" checked={criteria === "custom"} onChange={() => setCriteria("custom")} />
            <b>My own rules</b><span className="small muted">Tell the AI how you mark. Used for the marking scheme and when marking sheets.</span></label>
        </div>
        {criteria === "custom" && (
          <div className="stack" style={{ gap: 8, marginTop: 10 }}>
            <textarea className="input" rows={4} maxLength={2000} value={rules} onChange={(e) => setRules(e.target.value)} aria-label="Your marking rules"
              placeholder={"e.g. Give 1 mark for the formula, 1 for substitution and 1 for the answer with units.\nAccept any correct method."} />
            <div className="row wrap" style={{ gap: 6 }}>{RULE_CHIPS.map((r) => <button key={r} type="button" className="chip-btn" onClick={() => addRule(r)}>+ {r}</button>)}</div>
          </div>
        )}
      </fieldset>
      {showMeta && <div className="step-label"><span>4</span>Details <span className="small muted" style={{ fontWeight: 400 }}>(optional)</span></div>}
      {showMeta && (
        <div className="grid g2">
          <label className="field"><span>Course</span><select className="input" value={place.course_id} onChange={(e) => setPlace({ course_id: e.target.value, subject_id: "" })}>
            <option value="">None</option>{courses.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="field"><span>Subject</span><select className="input" value={place.subject_id} disabled={!place.course_id || !subjects.length} onChange={(e) => {
            const sub = subjects.find((x) => x.id === e.target.value); setPlace({ ...place, subject_id: e.target.value }); if (sub && !meta.subject) setMeta({ ...meta, subject: sub.name });
          }}><option value="">None</option>{subjects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        </div>
      )}
      {showMeta && (
        <div className="grid g2">
          <label className="field"><span>Subject name on the paper</span><input className="input" value={meta.subject} onChange={(e) => setMeta({ ...meta, subject: e.target.value })} /></label>
          <label className="field"><span>Class</span><input className="input" value={meta.class_level} onChange={(e) => setMeta({ ...meta, class_level: e.target.value })} /></label>
          <label className="field"><span>Board / exam</span><input className="input" value={meta.board} onChange={(e) => setMeta({ ...meta, board: e.target.value })} /></label>
          <label className="field"><span>Duration (min)</span><input className="input" type="number" min={5} max={360} value={meta.duration_min} onChange={(e) => setMeta({ ...meta, duration_min: e.target.value })} /></label>
        </div>
      )}
      <ErrorBox error={error} />
      <div className="row between wrap" style={{ gap: 10 }}>
        <CreditLine action="paper_import" />
        <div className="row" style={{ marginLeft: "auto" }}>
        {onCancel && <button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>Cancel</button>}
        <button type="button" className="btn btn-primary" disabled={!ready || busy} onClick={submit}>
          {busy ? "Starting…" : paperBusy || keyBusy ? "Uploading…" : "Upload & process"}
        </button>
        </div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>AI reads the questions and marks in the background (usually 1–3 minutes). You can check and edit everything before using it.</p>
    </div>
  );
}
