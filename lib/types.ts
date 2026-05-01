// Shared types between server and client. Keep this small and dependency-free.

export type ModelName = "Qwen3.5-2B" | "Qwen3.5-4B" | "Qwen3.5-9B";
export type AnnotationMode = "image" | "blind";
export type PromptId = "frame-gun" | "vehicle-people";

export const MODES: AnnotationMode[] = ["image", "blind"];

export interface EventClass {
  id: number;
  short_label: string;
  content_ptbr: string | null;
  tags: string[] | null;
}

export interface TopMatch {
  ref_id: number;
  short_label: string;
  similarity: number;
}

// One (caption, top-3 matches) tuple produced by some prompt.
// A cell (frame, model) carries one PromptResult per prompt we benched.
export interface PromptResult {
  prompt_id: PromptId;
  caption: string;
  top_matches: TopMatch[];
}

// Per-(dataset, model, frame) cell. Holds ALL prompt variants for that frame.
// `dataset` distinguishes e.g. "cctv-sample-100" (the original public dataset)
// from "testaci" (extracted from the user's local video).
export interface BenchRow {
  dataset: string;        // e.g. 'cctv-sample-100' or 'testaci'
  model: ModelName;
  frame: string;          // e.g. 'frame_00003.jpg' or 'testaci_00003.jpg'
  prompts: PromptResult[];
}

export interface PromptInfo {
  id: PromptId;
  label: string;
}

export interface DatasetInfo {
  id: string;
  label: string;
  // Frame name prefix used to disambiguate when filenames are merged
  // (original frames are 'frame_*.jpg', testaci is 'testaci_*.jpg').
  frame_prefix: string;
  n_frames: number;
}

// One ranked pick slot (rank 1, 2, or 3 — 1 expected, 2/3 optional).
// Either an existing class id OR a free-text proposal of a new class.
export interface PickSlot {
  class_id: number | null;
  proposed_label: string | null;
  proposed_description: string | null;
}

export interface Annotation {
  id?: number;
  frame: string;
  model: ModelName;
  // Verdict is now derived for display; can still be sent explicitly
  // to override the derivation (e.g., flag a caption as bad even if
  // the cosine match happens to be acceptable).
  verdict: "approve" | "disapprove" | null;
  comment: string | null;
  pick1: PickSlot;
  pick2: PickSlot;
  pick3: PickSlot;
  // Snapshot of the model's cosine top-3 at annotation time. Persisted
  // alongside the picks so the future risk-engine calibration can join
  // human picks with model cosines in a single SQL query.
  model_top_matches: TopMatch[] | null;
  author: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface DataPayload {
  event_classes: EventClass[];
  rows: BenchRow[];
  models: ModelName[];
  frames: string[];
  prompts: PromptInfo[];
  datasets: DatasetInfo[];
}

export interface ApiData extends DataPayload {
  annotations: { image: Annotation[]; blind: Annotation[] };
}

// ─── Derived helpers ────────────────────────────────────────────────────────

/** All ref_ids picked (in order, dropping holes). Existing classes only —
 *  proposed-new entries don't have an id to compare against the model. */
export function pickedClassIds(a: Annotation): number[] {
  const out: number[] = [];
  for (const p of [a.pick1, a.pick2, a.pick3]) {
    if (p.class_id != null) out.push(p.class_id);
  }
  return out;
}

/** True if annotation has at least pick #1 filled (existing or proposed). */
export function isAnnotated(a: Annotation): boolean {
  const p = a.pick1;
  return p.class_id != null || !!p.proposed_label?.trim();
}

/** Derived verdict from picks vs model's cosine top-1.
 *  - exact: model's #1 == human's #1
 *  - partial: model's #1 in human's top-3
 *  - mismatch: otherwise (or human proposed a NEW class at rank 1) */
export type DerivedVerdict = "exact" | "partial" | "mismatch" | "unreviewed";
export function deriveVerdict(a: Annotation | undefined): DerivedVerdict {
  if (!a || !isAnnotated(a)) return "unreviewed";
  if (a.verdict === "approve") return "exact";
  if (a.verdict === "disapprove") return "mismatch";
  const modelTop1 = a.model_top_matches?.[0]?.ref_id;
  const picked = pickedClassIds(a);
  if (modelTop1 == null || picked.length === 0) return "mismatch";
  if (picked[0] === modelTop1) return "exact";
  if (picked.includes(modelTop1)) return "partial";
  return "mismatch";
}

/** overlap@3: count of model's top-3 ids that appear anywhere in human's top-3.
 *  Returns 0..3. */
export function overlapAt3(a: Annotation | undefined): number {
  if (!a) return 0;
  const modelIds = (a.model_top_matches ?? []).slice(0, 3).map(m => m.ref_id);
  const humanIds = pickedClassIds(a);
  return modelIds.filter(id => humanIds.includes(id)).length;
}
