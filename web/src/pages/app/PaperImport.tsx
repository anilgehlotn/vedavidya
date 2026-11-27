// Importing a printed question paper: upload the PDF/photos (resumable, checked), choose where the
// answers come from, and queue it for reading. Used from Question Papers and from a test's paper step.
import { useState } from "react";
import { api } from "../../lib/api";
import type { UploadedFile } from "../../lib/chunkUpload";
import { FileUpload } from "../../components/FileUpload";
import { ErrorBox } from "../../components/ui";
import { CreditLine } from "./Credits";

type KeyMode = "auto" | "in_paper" | "separate";
const KEY_OPTIONS: { id: KeyMode; title: string; desc: string }[] = [
  { id: "auto", title: "Auto-generate solutions", desc: "AI solves every question and writes a model solution with step marks." },
  { id: "in_paper", title: "Answers are in this PDF", desc: "The answers or solutions are printed in the same file; AI extracts them." },
  { id: "separate", title: "I have a separate answer key", desc: "Upload the answer key or marking scheme as a second file." },
];

export function ImportPaperForm({ defaults, showMeta, onCreated, onCancel }: {
  defaults?: { subject?: string | null; class_level?: string | null };
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = paper.length > 0 && !paperBusy && !keyBusy && (mode !== "separate" || key.length > 0);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api<{ id: string }>("/papers/import", { body: {
        paper_uploads: paper.map((p) => p.id), key_uploads: mode === "separate" ? key.map((k) => k.id) : [], key_mode: mode,
        subject: meta.subject || undefined, class_level: meta.class_level || undefined, board: meta.board || undefined, duration_min: Number(meta.duration_min) || undefined,
      } });
      await onCreated(r.id);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  };

  return (
    <div className="stack">
      <FileUpload purpose="paper" multiple label="Question paper" hint="One PDF (up to 50 MB, 50 pages) or photos of each page" onChange={(u, b) => { setPaper(u); setPaperBusy(b); }} />
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Answer key</legend>
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
      {showMeta && (
        <div className="grid g2">
          <label className="field"><span>Subject</span><input className="input" value={meta.subject} onChange={(e) => setMeta({ ...meta, subject: e.target.value })} /></label>
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
