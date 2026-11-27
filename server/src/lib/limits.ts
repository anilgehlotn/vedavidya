// Upload limits, shared by the server's checks and (via /api/config) the browser's checks.
export type UploadPurpose = "paper" | "answer_key" | "class_sheets" | "student_sheet";

export interface PurposeLimits {
  /** Max size of one file, in bytes. */
  maxBytes: number;
  /** Max pages in one PDF (and in the whole document). */
  maxPages: number;
  /** File kinds accepted. */
  kinds: ("pdf" | "image" | "zip")[];
  label: string;
}

const MB = 1024 * 1024;
export const LIMITS: Record<UploadPurpose, PurposeLimits> = {
  paper: { maxBytes: 50 * MB, maxPages: 50, kinds: ["pdf", "image"], label: "question paper" },
  answer_key: { maxBytes: 50 * MB, maxPages: 50, kinds: ["pdf", "image"], label: "answer key" },
  class_sheets: { maxBytes: 250 * MB, maxPages: 600, kinds: ["pdf", "zip"], label: "class answer sheets" },
  student_sheet: { maxBytes: 50 * MB, maxPages: 40, kinds: ["pdf", "image"], label: "answer sheet" },
};
/** Images are always limited to 25 MB each (phone photos are far smaller). */
export const MAX_IMAGE_BYTES = 25 * MB;
/** Chunk size for resumable uploads (the browser sends pieces of this size). */
export const CHUNK_BYTES = 5 * MB;
/** ZIP safety limits: number of entries and total unpacked size. */
export const ZIP_MAX_ENTRIES = 400;
export const ZIP_MAX_UNPACKED = 1024 * MB;

export const kindOf = (name: string): "pdf" | "image" | "zip" | null =>
  /\.pdf$/i.test(name) ? "pdf" : /\.(jpe?g|png|webp)$/i.test(name) ? "image" : /\.zip$/i.test(name) ? "zip" : null;
