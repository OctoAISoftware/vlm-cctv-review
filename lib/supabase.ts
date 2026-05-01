// PostgREST client for both annotation tables.
// One set of functions parameterized by mode = 'image' | 'blind'.

import { Annotation, AnnotationMode, PickSlot } from "./types";

const SUPABASE_URL = (process.env.SUPABASE_URL || "http://10.5.255.107:54321").replace(/\/$/, "");
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
if (!SUPABASE_KEY) {
  console.warn("[lib/supabase] SUPABASE_KEY env var is not set — annotation reads/writes will fail");
}

const HEADERS: Record<string, string> = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

function tableFor(mode: AnnotationMode): string {
  return mode === "blind"
    ? "qwen35_review_blind_annotations"
    : "qwen35_review_annotations";
}

interface DbRow {
  id: number;
  frame: string;
  model: string;
  verdict: "approve" | "disapprove" | null;
  comment: string | null;
  pick1_class_id: number | null;
  pick2_class_id: number | null;
  pick3_class_id: number | null;
  pick1_proposed_label: string | null;
  pick1_proposed_description: string | null;
  pick2_proposed_label: string | null;
  pick2_proposed_description: string | null;
  pick3_proposed_label: string | null;
  pick3_proposed_description: string | null;
  model_top_matches: any | null;
  author: string | null;
  created_at: string;
  updated_at: string;
  // Legacy fields only on qwen35_review_annotations (image table).
  // Read for back-compat; never written by the new flow.
  suggested_class_id?: number | null;
  proposed_class_label?: string | null;
  proposed_class_description?: string | null;
}

function rowToAnnotation(r: DbRow): Annotation {
  // Back-compat: rows annotated under the OLD schema (single suggested
  // class) get migrated into pick1 on read so the UI doesn't see two
  // different shapes. Legacy rows have suggested_class_id OR
  // proposed_class_label populated and pick1_* empty.
  const legacyClass = r.suggested_class_id ?? null;
  const legacyProposedLabel = r.proposed_class_label ?? null;
  const legacyProposedDesc = r.proposed_class_description ?? null;

  const pick1HasNew =
    r.pick1_class_id != null || !!r.pick1_proposed_label || !!r.pick1_proposed_description;

  const pick1: PickSlot = pick1HasNew
    ? {
        class_id: r.pick1_class_id,
        proposed_label: r.pick1_proposed_label,
        proposed_description: r.pick1_proposed_description,
      }
    : {
        class_id: legacyClass,
        proposed_label: legacyProposedLabel,
        proposed_description: legacyProposedDesc,
      };

  return {
    id: r.id,
    frame: r.frame,
    model: r.model as Annotation["model"],
    verdict: r.verdict,
    comment: r.comment,
    pick1,
    pick2: {
      class_id: r.pick2_class_id,
      proposed_label: r.pick2_proposed_label,
      proposed_description: r.pick2_proposed_description,
    },
    pick3: {
      class_id: r.pick3_class_id,
      proposed_label: r.pick3_proposed_label,
      proposed_description: r.pick3_proposed_description,
    },
    model_top_matches: r.model_top_matches ?? null,
    author: r.author,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export async function listAnnotations(mode: AnnotationMode): Promise<Annotation[]> {
  const url = `${SUPABASE_URL}/rest/v1/${tableFor(mode)}?select=*&order=updated_at.desc`;
  const r = await fetch(url, { headers: HEADERS, cache: "no-store" });
  if (!r.ok) throw new Error(`listAnnotations(${mode}): ${r.status} ${await r.text()}`);
  const rows = (await r.json()) as DbRow[];
  return rows.map(rowToAnnotation);
}

export async function upsertAnnotation(mode: AnnotationMode, a: Annotation): Promise<Annotation> {
  const url = `${SUPABASE_URL}/rest/v1/${tableFor(mode)}?on_conflict=frame,model`;
  const payload: Record<string, unknown> = {
    frame: a.frame,
    model: a.model,
    verdict: a.verdict,
    comment: a.comment,
    pick1_class_id: a.pick1.class_id,
    pick1_proposed_label: a.pick1.proposed_label,
    pick1_proposed_description: a.pick1.proposed_description,
    pick2_class_id: a.pick2.class_id,
    pick2_proposed_label: a.pick2.proposed_label,
    pick2_proposed_description: a.pick2.proposed_description,
    pick3_class_id: a.pick3.class_id,
    pick3_proposed_label: a.pick3.proposed_label,
    pick3_proposed_description: a.pick3.proposed_description,
    model_top_matches: a.model_top_matches,
    author: a.author,
    updated_at: new Date().toISOString(),
  };
  const r = await fetch(url, {
    method: "POST",
    headers: { ...HEADERS, Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`upsertAnnotation(${mode}): ${r.status} ${await r.text()}`);
  const rows = (await r.json()) as DbRow[];
  return rowToAnnotation(rows[0]);
}

export async function deleteAnnotation(mode: AnnotationMode, frame: string, model: string): Promise<void> {
  const url = `${SUPABASE_URL}/rest/v1/${tableFor(mode)}?frame=eq.${encodeURIComponent(frame)}&model=eq.${encodeURIComponent(model)}`;
  const r = await fetch(url, { method: "DELETE", headers: HEADERS });
  if (!r.ok) throw new Error(`deleteAnnotation(${mode}): ${r.status} ${await r.text()}`);
}
