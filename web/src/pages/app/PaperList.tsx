// Question Papers: folders, source chips, course/subject/status filters, search, and rich paper cards.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, fmtDate } from "../../lib/api";
import { Empty, ErrorBox, ErrorState, Modal, PageTitle, SkeletonCards, useApi } from "../../components/ui";
import { Icon } from "../../components/icons";
import { useRun, useToast } from "../../components/toast";
import { ImportPaperForm } from "./PaperImport";
import type { Course } from "./Courses";

export interface PaperRow {
  id: string; title: string; subject: string | null; board: string | null; class_level: string | null; language: string; total_marks: number; duration_min: number;
  status: "generating" | "draft" | "approved" | "failed"; error: string | null; created_at: string; updated_at: string; approved_at: string | null;
  source: "generated" | "imported" | "composed" | null; folder_id: string | null; folder_name: string | null;
  course_id: string | null; course_name: string | null; subject_id: string | null; subject_name: string | null;
  created_by_name: string | null; used_in_tests: number; question_count: number; section_count: number; difficulty: "easy" | "medium" | "hard" | null;
}
interface Folder { id: string; name: string; papers: number }

const SOURCE: Record<string, [string, string]> = { generated: ["✦ AI generated", "violet"], imported: ["⇪ Imported", "blue"], composed: ["✎ Written here", ""] };
const STATUS: Record<PaperRow["status"], [string, string]> = { generating: ["Being prepared", "amber"], draft: ["Draft", ""], approved: ["Approved", "green"], failed: ["Failed", "red"] };
const DIFF: Record<string, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };
const initials = (n: string) => n.split(" ").filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
const ago = (iso: string) => {
  const d = (Date.now() - Date.parse(iso.replace(" ", "T") + (iso.includes("Z") || iso.includes("+") ? "" : "Z"))) / 86400000;
  return d < 1 ? "today" : d < 2 ? "yesterday" : d < 30 ? `${Math.floor(d)} days ago` : fmtDate(iso);
};

export function PaperList() {
  const papers = useApi<PaperRow[]>("/papers");
  const folders = useApi<Folder[]>("/paper-folders");
  const courses = useApi<Course[]>("/courses");
  const nav = useNavigate();
  const run = useRun();
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? "";
  const folder = get("folder"), source = get("source"), status = get("status"), course = get("course"), subject = get("subject");
  const [q, setQ] = useState("");
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<PaperRow | null>(null);
  const setParam = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v); else n.delete(k);
    if (k === "course") n.delete("subject");
    setParams(n, { replace: true });
  };
  useEffect(() => {
    if (!papers.data?.some((p) => p.status === "generating")) return;
    const t = setInterval(() => papers.reload(true), 3000);
    return () => clearInterval(t);
  }, [papers.data]);

  const all = papers.data ?? [];
  const list = useMemo(() => all.filter((p) =>
    (!folder || (folder === "none" ? !p.folder_id : p.folder_id === folder)) && (!source || p.source === source) && (!status || p.status === status) &&
    (!course || p.course_id === course) && (!subject || p.subject_id === subject) &&
    (!q || `${p.title} ${p.subject ?? ""} ${p.class_level ?? ""} ${p.board ?? ""} ${p.created_by_name ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [all, folder, source, status, course, subject, q]);
  const filtered = Boolean(folder || source || status || course || subject || q);
  const subjects = courses.data?.find((c) => c.id === course)?.subjects ?? [];
  const reload = () => { papers.reload(true); folders.reload(true); };

  const compose = async () => {
    const r = await run(() => api<{ id: string }>("/papers", { body: { title: "Untitled paper", duration_min: 60, sections: [{ name: "Section A", instructions: "", questions: [] }], folder_id: folder && folder !== "none" ? folder : null } }));
    if (r) nav(`/app/papers/${r.id}?edit=1`);
  };
  const newFolder = async () => {
    const name = prompt("Folder name, e.g. Unit tests or Class 10 - Term 1")?.trim();
    if (!name) return;
    const r = await run(() => api<{ id: string }>("/paper-folders", { body: { name } }), `Folder "${name}" created.`);
    if (r) { folders.reload(true); setParam("folder", r.id); }
  };
  const renameFolder = async (f: Folder) => {
    const name = prompt("Folder name", f.name)?.trim();
    if (!name || name === f.name) return;
    if (await run(() => api(`/paper-folders/${f.id}`, { method: "PUT", body: { name } }), "Folder renamed.")) reload();
  };
  const deleteFolder = async (f: Folder) => {
    if (!confirm(`Delete the folder "${f.name}"? Its ${f.papers} paper${f.papers === 1 ? "" : "s"} stay, outside any folder.`)) return;
    if (await run(() => api(`/paper-folders/${f.id}`, { method: "DELETE" }), `Folder "${f.name}" deleted.`)) { if (folder === f.id) setParam("folder", ""); reload(); }
  };
  const duplicate = async (p: PaperRow) => {
    const r = await run(() => api<{ id: string }>(`/papers/${p.id}/clone`, { body: {} }), `Copy of "${p.title}" made.`);
    if (r) reload();
  };
  const remove = async (p: PaperRow) => {
    if (!confirm(`Delete "${p.title}"? This can't be undone.`)) return;
    if (await run(() => api(`/papers/${p.id}`, { method: "DELETE" }), `"${p.title}" deleted.`)) reload();
  };

  const folderItems: { id: string; name: string; count: number; f?: Folder }[] = [
    { id: "", name: "All papers", count: all.length },
    ...(folders.data ?? []).map((f) => ({ id: f.id, name: f.name, count: f.papers, f })),
    { id: "none", name: "Not in a folder", count: all.filter((p) => !p.folder_id).length },
  ];

  return (
    <>
      <PageTitle title="Question Papers" sub="Generate with AI, import a printed paper, or write your own">
        <button className="btn btn-ghost" onClick={compose}>✎ Compose</button>
        <button className="btn btn-ghost" onClick={() => setImporting(true)}>⇪ Import paper</button>
        <Link to="/app/papers/new" className="btn btn-primary">✦ Generate with AI</Link>
      </PageTitle>

      <div className="papers-layout">
        <aside className="folder-nav" aria-label="Folders">
          <div className="row between folder-head"><b className="small">Folders</b><button className="btn-link small" onClick={newFolder}>+ New</button></div>
          <ul>
            {folderItems.map((f) => (
              <li key={f.id || "all"} className={folder === f.id ? "on" : ""}>
                <button type="button" onClick={() => setParam("folder", f.id)} aria-current={folder === f.id ? "true" : undefined}>
                  <Icon name={f.id === "" ? "inbox" : "paper"} size={16} /><span className="grow">{f.name}</span><span className="count">{f.count}</span>
                </button>
                {f.f && <span className="folder-tools">
                  <button type="button" onClick={() => renameFolder(f.f!)} aria-label={`Rename ${f.name}`} title="Rename">✎</button>
                  <button type="button" onClick={() => deleteFolder(f.f!)} aria-label={`Delete ${f.name}`} title="Delete"><Icon name="trash" size={13} /></button>
                </span>}
              </li>
            ))}
          </ul>
        </aside>

        <div className="papers-main">
          <div className="filters">
            <div className="search-field"><Icon name="search" size={16} /><input className="input" placeholder="Search papers…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search papers" /></div>
            <select className="input" value={course} onChange={(e) => setParam("course", e.target.value)} aria-label="Course">
              <option value="">All courses</option>{courses.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {course && subjects.length > 0 && <select className="input" value={subject} onChange={(e) => setParam("subject", e.target.value)} aria-label="Subject">
              <option value="">All subjects</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>}
            <select className="input" value={status} onChange={(e) => setParam("status", e.target.value)} aria-label="Status">
              <option value="">Any status</option>{Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div className="chips" role="group" aria-label="Source">
            {[["", "All"], ["generated", "AI generated"], ["imported", "Imported"], ["composed", "Written here"]].map(([k, l]) => (
              <button key={k} type="button" className={`chip-btn ${source === k ? "on" : ""}`} aria-pressed={source === k} onClick={() => setParam("source", k)}>
                {l}{k && <span className="count">{all.filter((p) => p.source === k).length}</span>}
              </button>
            ))}
            {filtered && <button type="button" className="btn-link small" onClick={() => { setQ(""); setParams({}, { replace: true }); }}>Clear all</button>}
          </div>

          {papers.loading ? <SkeletonCards count={6} height={180} /> : !papers.data ? <div className="card"><ErrorState error={papers.error} onRetry={() => papers.reload()} /></div>
            : !all.length ? (
              <div className="card"><Empty title="No question papers yet" icon="paper" action={<div className="row wrap" style={{ justifyContent: "center" }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setImporting(true)}>⇪ Import paper</button><Link to="/app/papers/new" className="btn btn-primary btn-sm">✦ Generate with AI</Link></div>}>
                Upload a printed paper for the AI to read, describe one and let the AI write it, or compose one yourself.</Empty></div>
            ) : !list.length ? (
              <div className="card"><Empty title="No papers match" icon="search" action={<button className="btn btn-ghost btn-sm" onClick={() => { setQ(""); setParams({}, { replace: true }); }}>Clear search and filters</button>}>
                {folder && folder !== "none" && !source && !status && !q ? "This folder is empty. Use a paper's ⋯ menu to move it here." : "Try another word or filter."}</Empty></div>
            ) : (
              <div className="grid g3 paper-grid">
                {list.map((p) => (
                  <PaperCard key={p.id} p={p} onOpen={() => nav(`/app/papers/${p.id}`)} onEdit={() => setEditing(p)} onDuplicate={() => duplicate(p)} onDelete={() => remove(p)} />
                ))}
              </div>
            )}
        </div>
      </div>

      {importing && (
        <Modal title="Import a question paper" onClose={() => setImporting(false)}>
          <ImportPaperForm showMeta onCancel={() => setImporting(false)} onCreated={(id) => nav(`/app/papers/${id}`)} />
        </Modal>
      )}
      {editing && <PaperMetaModal p={editing} folders={folders.data ?? []} courses={courses.data ?? []} onClose={() => setEditing(null)} onSaved={reload} />}
    </>
  );
}

function PaperCard({ p, onOpen, onEdit, onDuplicate, onDelete }: { p: PaperRow; onOpen: () => void; onEdit: () => void; onDuplicate: () => void; onDelete: () => void }) {
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(false); };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", close); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", key); };
  }, [menu]);
  const src = p.source ? SOURCE[p.source] : null;
  return (
    <article className="card paper-card" aria-label={p.title}>
      <div className="paper-card-top">
        <div className="row wrap" style={{ gap: 6 }}>
          {src && <span className={`badge ${src[1]}`}>{src[0]}</span>}
          {p.status !== "approved" && <span className={`badge ${STATUS[p.status][1]}`}>{p.status === "generating" && <span className="dot pulse" />}{STATUS[p.status][0]}</span>}
        </div>
        <div className="menu-wrap" ref={ref}>
          <button type="button" className="icon-btn" aria-label={`More actions for ${p.title}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>⋯</button>
          {menu && (
            <div className="pop-menu" role="menu">
              <button role="menuitem" onClick={() => { setMenu(false); onOpen(); }}>Open</button>
              {p.status !== "failed" && p.status !== "generating" && <Link role="menuitem" to={`/app/tests?new=1&paper=${p.id}`}>Use in a test</Link>}
              <button role="menuitem" onClick={() => { setMenu(false); onEdit(); }}>Folder, course & subject…</button>
              {p.status !== "generating" && <button role="menuitem" onClick={() => { setMenu(false); onDuplicate(); }}>Duplicate</button>}
              <button role="menuitem" className="danger" onClick={() => { setMenu(false); onDelete(); }}>Delete</button>
            </div>
          )}
        </div>
      </div>
      <Link to={`/app/papers/${p.id}`} className="paper-title">
        {p.status === "approved" && <span className="approved-tick" title={`Approved${p.approved_at ? ` on ${fmtDate(p.approved_at)}` : ""}`} aria-label="Approved"><Icon name="check" size={13} /></span>}
        {p.title}
      </Link>
      <div className="small muted">{[p.subject, p.class_level, p.board].filter(Boolean).join(" · ") || "No subject yet"}</div>
      {p.status === "failed" ? <div className="small" style={{ color: "var(--red)" }}>{p.error ?? "Couldn't be prepared."}</div> : (
        <div className="paper-facts">
          <span><b>{p.total_marks}</b> marks</span><span><b>{p.question_count}</b> questions</span><span><b>{p.duration_min}</b> min</span>
          {p.difficulty && <span className={`diff ${p.difficulty}`}>{DIFF[p.difficulty]}</span>}
        </div>
      )}
      {(p.course_name || p.subject_name || p.folder_name) && (
        <div className="row wrap" style={{ gap: 6 }}>
          {p.course_name && <span className="tag">{p.course_name}{p.subject_name ? ` · ${p.subject_name}` : ""}</span>}
          {p.folder_name && <span className="tag"><Icon name="paper" size={12} /> {p.folder_name}</span>}
        </div>
      )}
      <div className="paper-foot">
        <span className="ava-xs" aria-hidden>{initials(p.created_by_name ?? "?")}</span>
        <span className="small grow" style={{ minWidth: 0 }}><span className="ellipsis">{p.created_by_name ?? "Unknown"}</span><span className="muted"> · updated {ago(p.updated_at)}</span></span>
        {p.used_in_tests > 0 && <span className="small muted" title="Tests that use this paper">{p.used_in_tests} test{p.used_in_tests === 1 ? "" : "s"}</span>}
      </div>
    </article>
  );
}

function PaperMetaModal({ p, folders, courses, onClose, onSaved }: { p: PaperRow; folders: Folder[]; courses: Course[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ folder_id: p.folder_id ?? "", course_id: p.course_id ?? "", subject_id: p.subject_id ?? "" });
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const subjects = courses.find((c) => c.id === f.course_id)?.subjects ?? [];
  const save = async () => {
    setErr(null);
    try {
      await api(`/papers/${p.id}/meta`, { method: "PUT", body: { folder_id: f.folder_id || null, course_id: f.course_id || null, subject_id: f.subject_id || null } });
      toast.success("Paper updated."); onSaved(); onClose();
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Modal title={p.title} onClose={onClose}>
      <div className="stack">
        <label className="field"><span>Folder</span><select className="input" value={f.folder_id} onChange={(e) => setF({ ...f, folder_id: e.target.value })}><option value="">Not in a folder</option>{folders.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <div className="grid g2">
          <label className="field"><span>Course</span><select className="input" value={f.course_id} onChange={(e) => setF({ ...f, course_id: e.target.value, subject_id: "" })}><option value="">None</option>{courses.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label className="field"><span>Subject</span><select className="input" value={f.subject_id} disabled={!f.course_id} onChange={(e) => setF({ ...f, subject_id: e.target.value })}><option value="">None</option>{subjects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        </div>
        {f.course_id && !subjects.length && <p className="small muted" style={{ margin: 0 }}>This course has no subjects yet. Add them on Batches → Courses & subjects.</p>}
        <ErrorBox error={err} />
        <button className="btn btn-primary" onClick={save}>Save</button>
      </div>
    </Modal>
  );
}
