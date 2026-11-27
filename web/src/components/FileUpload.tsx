// File picker + resumable uploader with progress, cancel, retry (resumes) and re-upload.
// Files are checked in the browser first (type, size, pages); the server checks them again.
import { useEffect, useRef, useState } from "react";
import { checkFile, fmtSize, uploadFile, uploadLimits, type Purpose, type UploadedFile } from "../lib/chunkUpload";

type State = "checking" | "invalid" | "uploading" | "done" | "error";
interface Item { key: number; file: File; state: State; sent: number; total: number; pages: number | null; error?: string; upload?: UploadedFile; session?: string; ctrl?: AbortController }

let seq = 0;
const ACCEPT: Record<string, string> = { pdf: "application/pdf,.pdf", image: "image/jpeg,image/png,image/webp", zip: ".zip,application/zip" };

export function FileUpload({ purpose, multiple, label, hint, onChange, disabled }: {
  purpose: Purpose; multiple?: boolean; label: string; hint?: string; disabled?: boolean;
  /** Finished uploads (in order) and whether any file is still being checked or uploaded. */
  onChange: (uploads: UploadedFile[], busy: boolean) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [accept, setAccept] = useState("");
  const [limitsText, setLimitsText] = useState("");
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const replacing = useRef<number | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    uploadLimits().then((l) => {
      const lim = l.limits[purpose];
      setAccept(lim.kinds.map((k) => ACCEPT[k]).join(","));
      setLimitsText(`${lim.kinds.map((k) => (k === "image" ? "photos" : k.toUpperCase())).join(" / ")} · max ${fmtSize(lim.maxBytes)}${lim.maxPages ? ` · ${lim.maxPages} pages` : ""}`);
    }).catch(() => {});
  }, [purpose]);
  useEffect(() => {
    onChange(items.filter((i) => i.state === "done" && i.upload).map((i) => i.upload!), items.some((i) => i.state === "checking" || i.state === "uploading"));
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => itemsRef.current.forEach((i) => i.ctrl?.abort()), []); // leaving the page cancels uploads

  const patch = (key: number, p: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));

  const start = async (item: Item, resume?: string) => {
    const ctrl = new AbortController();
    patch(item.key, { state: "uploading", error: undefined, ctrl, sent: 0 });
    try {
      const upload = await uploadFile(item.file, purpose, { signal: ctrl.signal, resumeId: resume, onSession: (s) => patch(item.key, { session: s }), onProgress: (sent, total) => patch(item.key, { sent, total }) });
      patch(item.key, { state: "done", upload, pages: upload.pages ?? item.pages, ctrl: undefined });
    } catch (e) {
      if ((e as Error).name === "AbortError") { setItems((list) => list.filter((i) => i.key !== item.key)); return; }
      patch(item.key, { state: "error", error: (e as Error).message, ctrl: undefined });
    }
  };

  const add = async (files: File[]) => {
    if (!files.length) return;
    const chosen = multiple ? files : files.slice(0, 1);
    const fresh: Item[] = chosen.map((file) => ({ key: ++seq, file, state: "checking", sent: 0, total: file.size, pages: null }));
    const r = replacing.current;
    replacing.current = null;
    setItems((list) => {
      if (r != null) { list.find((i) => i.key === r)?.ctrl?.abort(); return list.map((i) => (i.key === r ? fresh[0] : i)); }
      if (!multiple) { list.forEach((i) => i.ctrl?.abort()); return fresh; }
      return [...list, ...fresh];
    });
    for (const it of fresh) {
      const c = await checkFile(it.file, purpose);
      if (!c.ok) { patch(it.key, { state: "invalid", error: c.error }); continue; }
      it.pages = c.pages;
      patch(it.key, { pages: c.pages });
      void start(it);
    }
  };

  const pick = () => !disabled && input.current?.click();
  const showDrop = multiple || items.length === 0;

  return (
    <div className="field">
      <span>{label}</span>
      <input ref={input} type="file" accept={accept} multiple={multiple && replacing.current == null} style={{ display: "none" }}
        onChange={(e) => { void add([...(e.target.files ?? [])]); e.target.value = ""; }} />
      {showDrop && (
        <div className={`drop ${over ? "over" : ""}`} role="button" tabIndex={0} aria-disabled={disabled} aria-label={`${label}: choose files or drop them here`}
          onClick={pick} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick())}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) void add([...e.dataTransfer.files]); }}>
          <b>{items.length ? "Add more files" : "Click to choose, or drop files here"}</b>
          <div className="small muted">{hint ?? limitsText}</div>
        </div>
      )}
      {items.map((i) => (
        <div key={i.key} className={`file-card ${i.state}`}>
          <div className="file-icon" aria-hidden>{/\.pdf$/i.test(i.file.name) ? "PDF" : /\.zip$/i.test(i.file.name) ? "ZIP" : "IMG"}</div>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="file-name" title={i.file.name}>{i.file.name}</div>
            <div className="small muted">
              {fmtSize(i.file.size)}{i.pages ? ` · ${i.pages} page${i.pages === 1 ? "" : "s"}` : ""}
              {i.state === "checking" && " · Checking…"}
              {i.state === "uploading" && ` · Uploading ${Math.floor((i.sent / Math.max(1, i.total)) * 100)}%`}
              {i.state === "done" && " · Uploaded ✓"}
            </div>
            {i.state === "uploading" && <div className="bar" style={{ marginTop: 6 }} role="progressbar" aria-valuenow={Math.floor((i.sent / Math.max(1, i.total)) * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${(i.sent / Math.max(1, i.total)) * 100}%` }} /></div>}
            {i.error && <div className="small" style={{ color: "var(--red)", marginTop: 4 }}>{i.error}</div>}
          </div>
          <div className="row" style={{ flex: "none", gap: 6 }}>
            {i.state === "uploading" && <button type="button" className="btn btn-ghost btn-sm" onClick={() => i.ctrl?.abort()}>Cancel</button>}
            {i.state === "error" && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void start(i, i.session)}>Retry</button>}
            {(i.state === "done" || i.state === "invalid" || i.state === "error") && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { replacing.current = i.key; pick(); }}>Re-upload</button>}
            {i.state !== "uploading" && <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove ${i.file.name}`} onClick={() => setItems((l) => l.filter((x) => x.key !== i.key))}>✕</button>}
          </div>
        </div>
      ))}
    </div>
  );
}
