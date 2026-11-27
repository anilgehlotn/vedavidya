// Turns "what the AI read on each page" into "which student each page belongs to".
// A page that starts a sheet opens a new group; following pages join it until the next start.
// A start page the AI couldn't match still opens a group (for the teacher to name); pages before
// any start page stay unassigned.

export interface PageRead { n: number; first_page: boolean; student_id: string; confidence: "high" | "medium" | "low"; name_written: string; roll_written: string }
export interface PageMap extends PageRead { attempt_id: string | null; group: number }

export function groupPages(reads: PageRead[], valid: Set<string>): PageMap[] {
  const sorted = [...reads].sort((a, b) => a.n - b.n);
  let group = -1, current: string | null = null;
  const used = new Set<string>();
  return sorted.map((r) => {
    const id = r.student_id && valid.has(r.student_id) ? r.student_id : null;
    // A matched page for a different student also starts a new group, even if the model missed the header.
    const starts = r.first_page || (id !== null && id !== current);
    if (starts) {
      group++;
      // The same student twice (e.g. a re-scanned page): later groups stay unmatched for the teacher to decide.
      current = id && !used.has(id) ? id : null;
      if (current) used.add(current);
    }
    return { ...r, student_id: id ?? "", attempt_id: group < 0 ? null : current, group, confidence: id || !starts ? r.confidence : "low" };
  });
}
