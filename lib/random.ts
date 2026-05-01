// Server-side helpers for the "random" annotation flow.
// Distinct from lib/supabase.ts because:
//   * no upsert (random table is multi-row per cell, append-only)
//   * weighted-random selection logic lives here
//   * provenance fields (ip / user-agent) are random-table-only

import { Annotation, BenchRow, ModelName, PickSlot, PromptId, TopMatch } from "./types";

const SUPABASE_URL = (process.env.SUPABASE_URL || "http://10.5.255.107:54321").replace(/\/$/, "");
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
if (!SUPABASE_KEY) {
  // Soft warn — in dev, the request will simply 401 from PostgREST. We don't
  // hard-fail at import time so the app can still boot for static smoke tests.
  console.warn("[lib/random] SUPABASE_KEY env var is not set — annotation writes will fail");
}
const TABLE = "qwen35_review_random_annotations";

const HEADERS: Record<string, string> = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

// Per-(frame, model) review counts, returned by the dashboard view that
// powers the weighted random picker. Cells with fewer prior reviews get
// preference so we don't keep re-asking about the same caption.
// Each random review is keyed by (frame, model, prompt_id) — the random
// flow shows ONE prompt's caption at a time, so we want to count reviews
// per-prompt and weight selection across the broader (frame, model, prompt)
// space. That way both prompts get coverage independently.
async function fetchReviewCounts(): Promise<Map<string, number>> {
  // Pull frame, model AND first ranked match-set's prompt-id-equivalent
  // proxy. The random table currently stores model_top_matches but not
  // an explicit prompt id — for backward compat we treat it as the
  // primary prompt's slot. New rows will tag prompt_id explicitly via
  // the comment metadata, but for COUNTING purposes we just use frame+model
  // until we add a prompt_id column. Conservative: counts cells regardless
  // of prompt — this means once a (frame, model) cell has any review
  // under any prompt, it deprioritizes equally for both prompts.
  const url = `${SUPABASE_URL}/rest/v1/${TABLE}?select=frame,model`;
  const r = await fetch(url, { headers: HEADERS, cache: "no-store" });
  if (!r.ok) throw new Error(`fetchReviewCounts: ${r.status} ${await r.text()}`);
  const rows = (await r.json()) as { frame: string; model: string }[];
  const counts = new Map<string, number>();
  for (const row of rows) {
    const k = `${row.frame}|${row.model}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

export interface RandomNext {
  frame: string;
  model: ModelName;
  prompt_id: PromptId;
  prompt_label: string;
  caption: string;
  top_matches: TopMatch[];
  reviews_so_far: number;
  cells_total: number;          // (frame, model, prompt) triples available
  cells_seen: number;
}

/** Pick the next random cell, weighted toward under-reviewed ones.
 *  Selection space is (frame, model, prompt) triples. Within the lowest
 *  review-count bucket we pick uniformly at random. */
export function pickRandomCell(
  rows: BenchRow[],
  counts: Map<string, number>,
  promptLabelById: Record<string, string>,
  exclude: Set<string> = new Set(),
): RandomNext | null {
  // Expand each row into one entry per prompt (so the random flow can land
  // on any (frame, model, prompt) triple — not just one caption per cell).
  type Triple = { row: BenchRow; promptIdx: number };
  const triples: Triple[] = [];
  for (const r of rows) {
    for (let i = 0; i < r.prompts.length; i++) {
      const key = `${r.frame}|${r.model}|${r.prompts[i].prompt_id}`;
      if (exclude.has(key)) continue;
      triples.push({ row: r, promptIdx: i });
    }
  }
  if (triples.length === 0) return null;

  // Bucket by current review count of the (frame, model) cell — see comment
  // in fetchReviewCounts for why we count cell-wide rather than per-prompt.
  const buckets = new Map<number, Triple[]>();
  for (const t of triples) {
    const cellKey = `${t.row.frame}|${t.row.model}`;
    const c = counts.get(cellKey) ?? 0;
    if (!buckets.has(c)) buckets.set(c, []);
    buckets.get(c)!.push(t);
  }
  const minCount = Math.min(...buckets.keys());
  const pool = buckets.get(minCount)!;
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  const result = chosen.row.prompts[chosen.promptIdx];

  return {
    frame: chosen.row.frame,
    model: chosen.row.model,
    prompt_id: result.prompt_id,
    prompt_label: promptLabelById[result.prompt_id] ?? result.prompt_id,
    caption: result.caption,
    top_matches: result.top_matches.slice(0, 3),
    reviews_so_far: minCount,
    cells_total: triples.length,
    cells_seen: counts.size,
  };
}

export interface RandomSubmit {
  frame: string;
  model: ModelName;
  pick1: PickSlot;
  pick2: PickSlot;
  pick3: PickSlot;
  comment: string | null;
  author: string | null;
  model_top_matches: TopMatch[] | null;
  source_ip?: string | null;
  user_agent?: string | null;
}

export async function insertRandom(a: RandomSubmit): Promise<{ id: number }> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`, {
    method: "POST",
    headers: { ...HEADERS, Prefer: "return=representation" },
    body: JSON.stringify({
      frame: a.frame,
      model: a.model,
      pick1_class_id: a.pick1.class_id,
      pick1_proposed_label: a.pick1.proposed_label,
      pick1_proposed_description: a.pick1.proposed_description,
      pick2_class_id: a.pick2.class_id,
      pick2_proposed_label: a.pick2.proposed_label,
      pick2_proposed_description: a.pick2.proposed_description,
      pick3_class_id: a.pick3.class_id,
      pick3_proposed_label: a.pick3.proposed_label,
      pick3_proposed_description: a.pick3.proposed_description,
      comment: a.comment,
      author: a.author,
      model_top_matches: a.model_top_matches,
      source_ip: a.source_ip ?? null,
      user_agent: (a.user_agent ?? "").slice(0, 256),
    }),
  });
  if (!r.ok) throw new Error(`insertRandom: ${r.status} ${await r.text()}`);
  const rows = (await r.json()) as { id: number }[];
  return { id: rows[0].id };
}

export async function loadReviewCounts(): Promise<Map<string, number>> {
  return fetchReviewCounts();
}
