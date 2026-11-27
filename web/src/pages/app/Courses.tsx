// Courses (e.g. "10th CBSE", "II PUC Karnataka Board") and their subjects. Admins manage them; batches,
// papers and tests link to them.
import { useState } from "react";
import { api } from "../../lib/api";
import { ErrorBox, Loading, useApi } from "../../components/ui";

export interface Course { id: string; name: string; board: string | null; batches: number; students: number; subjects: { id: string; name: string }[] }

export function CoursesCard({ isAdmin }: { isAdmin: boolean }) {
  const courses = useApi<Course[]>("/courses");
  const [name, setName] = useState("");
  const [board, setBoard] = useState("");
  const [subj, setSubj] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); courses.reload(true); } catch (e) { setErr((e as Error).message); } };

  return (
    <div className="card card-pad stack" style={{ marginBottom: 16 }}>
      <div className="row between"><b>Courses & subjects</b><span className="small muted">Batches, papers and tests are grouped by course</span></div>
      {courses.loading ? <Loading /> : !courses.data?.length ? <p className="small muted" style={{ margin: 0 }}>No courses yet. Add one like "10th CBSE" or "II PUC Karnataka Board".</p> : (
        <div className="stack" style={{ gap: 10 }}>
          {courses.data.map((c) => (
            <div key={c.id} className="course-row">
              <div className="row between wrap" style={{ gap: 8 }}>
                <div><b>{c.name}</b>{c.board && <span className="small muted"> · {c.board}</span>}
                  <div className="small muted">{c.batches} batch{c.batches === 1 ? "" : "es"} · {c.students} student{c.students === 1 ? "" : "s"}</div></div>
                {isAdmin && (
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => { const n = prompt("Course name", c.name); if (n?.trim()) void act(() => api(`/courses/${c.id}`, { method: "PUT", body: { name: n.trim(), board: c.board } })); }}>Rename</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => { if (confirm(`Delete the course "${c.name}"?`)) void act(() => api(`/courses/${c.id}`, { method: "DELETE" })); }}>Delete</button>
                  </div>
                )}
              </div>
              <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
                {c.subjects.map((s) => (
                  <span key={s.id} className="badge">{s.name}
                    {isAdmin && <button type="button" className="chip-x" aria-label={`Remove ${s.name}`} onClick={() => { if (confirm(`Remove the subject "${s.name}" from ${c.name}?`)) void act(() => api(`/subjects/${s.id}`, { method: "DELETE" })); }}>×</button>}
                  </span>
                ))}
                {isAdmin && (
                  <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); const n = (subj[c.id] ?? "").trim(); if (n) void act(async () => { await api(`/courses/${c.id}/subjects`, { body: { name: n } }); setSubj({ ...subj, [c.id]: "" }); }); }}>
                    <input className="input input-sm" placeholder="Add subject" value={subj[c.id] ?? ""} onChange={(e) => setSubj({ ...subj, [c.id]: e.target.value })} maxLength={80} aria-label={`Add subject to ${c.name}`} />
                    <button className="btn btn-ghost btn-sm" disabled={!(subj[c.id] ?? "").trim()}>Add</button>
                  </form>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {isAdmin && (
        <form className="row wrap" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); void act(async () => { await api("/courses", { body: { name: name.trim(), board: board.trim() || null } }); setName(""); setBoard(""); }); }}>
          <input className="input grow" placeholder="New course, e.g. 10th CBSE" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} aria-label="New course name" />
          <input className="input" style={{ width: 160 }} placeholder="Board (optional)" value={board} onChange={(e) => setBoard(e.target.value)} maxLength={80} aria-label="Board" />
          <button className="btn btn-primary" disabled={!name.trim()}>Add course</button>
        </form>
      )}
      <ErrorBox error={err} />
    </div>
  );
}
