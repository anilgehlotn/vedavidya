// Institute scoping helpers: every id that comes from a request is checked to belong to the caller's institute.
import { one } from "../db.js";

const TABLES = new Set(["batches", "centres", "courses", "subjects", "paper_folders", "question_papers", "tests"]);
/** True when the row exists and belongs to the institute (null/undefined ids count as "nothing to check"). */
export function inOrg(table: string, id: string | null | undefined, orgId: string) {
  if (!TABLES.has(table)) throw new Error(`inOrg: unknown table ${table}`);
  if (!id) return true;
  return Boolean(one(`SELECT 1 FROM ${table} WHERE id = ? AND org_id = ?`, id, orgId));
}
/** A subject must belong to the given course (when both are set). */
export const subjectInCourse = (subjectId: string | null | undefined, courseId: string | null | undefined) =>
  !subjectId || !courseId || Boolean(one("SELECT 1 FROM subjects WHERE id = ? AND course_id = ?", subjectId, courseId));
