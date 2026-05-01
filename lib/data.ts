// Loader for the bench-result + match JSON files.
// Cached in-process — these files don't change at runtime.
//
// We now load MULTIPLE (dataset, prompt) match files and stitch them
// into per-(dataset, model, frame) rows that carry one
// (caption, top_matches) tuple per prompt under the `prompts` field.

import fs from "node:fs/promises";
import path from "node:path";
import {
  BenchRow,
  DataPayload,
  DatasetInfo,
  EventClass,
  ModelName,
  PromptId,
  PromptResult,
} from "./types";
import { categoryOf } from "./event_class_groups";

function benchResultsDir(): string {
  return process.env.BENCH_RESULTS_DIR || path.resolve(process.cwd(), "..", "bench_results");
}

// Each dataset advertises one or more frame-image directories on disk.
// /api/images/<name>.jpg searches each in order until it finds the file.
// Override via env: FRAMES_DIRS (colon-separated list).
function imagesDirs(): string[] {
  const raw = process.env.FRAMES_DIRS || process.env.FRAMES_DIR ||
    "/home/suporte/datasets/cctv-sample-100:/home/suporte/datasets/testaci-frames";
  return raw.split(":").map((s) => s.trim()).filter(Boolean);
}

// Resolve a frame name to the first directory that has it.
export async function resolveImagePath(frameName: string): Promise<string | null> {
  for (const dir of imagesDirs()) {
    const p = path.join(dir, frameName);
    try {
      await fs.access(p);
      return p;
    } catch {}
  }
  return null;
}

// Each tuple = (dataset_id, prompt_id, prompt_label, file path).
// Add a new row here to surface a new (dataset, prompt, model_family) bench
// output. Files that don't exist yet are silently skipped (warning logged) —
// so it's safe to declare a future bench output here ahead of time.
//
// File names follow the convention written by match_event_classes.py:
//   <dataset?>-<family>-event-class-matches[-<label>].json
//                                            ↑ omitted for the "frame-gun" prompt
//                                              when --label was empty (legacy)
//
// Adding a new model family means: declare its match files here AND make
// sure the matcher's FAMILIES dict knows the (display_name, file_stem)
// mapping for its sizes (see scripts/match_event_classes.py).
const SOURCES: Array<{
  dataset: string;
  dataset_label: string;
  frame_prefix: string;
  prompt: PromptId;
  prompt_label: string;
  file: string;
}> = [
  // Qwen3.5 family — original cctv-sample-100
  {
    dataset: "cctv-sample-100",
    dataset_label: "CCTV sample-100 (public traffic dataset)",
    frame_prefix: "frame_",
    prompt: "frame-gun",
    prompt_label: "Frame Gun (orig)",
    file: "qwen35-event-class-matches.json",
  },
  {
    dataset: "cctv-sample-100",
    dataset_label: "CCTV sample-100 (public traffic dataset)",
    frame_prefix: "frame_",
    prompt: "vehicle-people",
    prompt_label: "Vehicle/People (interactions)",
    file: "qwen35-event-class-matches-vehicle-people.json",
  },
  // Qwen3.5 family — testaci
  {
    dataset: "testaci",
    dataset_label: "testaci.mp4 (local video, 1 frame / 2s)",
    frame_prefix: "testaci_",
    prompt: "frame-gun",
    prompt_label: "Frame Gun (orig)",
    file: "testaci-qwen35-event-class-matches-frame-gun.json",
  },
  {
    dataset: "testaci",
    dataset_label: "testaci.mp4 (local video, 1 frame / 2s)",
    frame_prefix: "testaci_",
    prompt: "vehicle-people",
    prompt_label: "Vehicle/People (interactions)",
    file: "testaci-qwen35-event-class-matches-vehicle-people.json",
  },
  // Cosmos-Reason2 family — cctv-sample-100
  {
    dataset: "cctv-sample-100",
    dataset_label: "CCTV sample-100 (public traffic dataset)",
    frame_prefix: "frame_",
    prompt: "frame-gun",
    prompt_label: "Frame Gun (orig)",
    file: "cctv-sample-100-cosmos-event-class-matches-frame-gun.json",
  },
  {
    dataset: "cctv-sample-100",
    dataset_label: "CCTV sample-100 (public traffic dataset)",
    frame_prefix: "frame_",
    prompt: "vehicle-people",
    prompt_label: "Vehicle/People (interactions)",
    file: "cctv-sample-100-cosmos-event-class-matches-vehicle-people.json",
  },
  // Cosmos-Reason2 family — testaci
  {
    dataset: "testaci",
    dataset_label: "testaci.mp4 (local video, 1 frame / 2s)",
    frame_prefix: "testaci_",
    prompt: "frame-gun",
    prompt_label: "Frame Gun (orig)",
    file: "testaci-cosmos-event-class-matches-frame-gun.json",
  },
  {
    dataset: "testaci",
    dataset_label: "testaci.mp4 (local video, 1 frame / 2s)",
    frame_prefix: "testaci_",
    prompt: "vehicle-people",
    prompt_label: "Vehicle/People (interactions)",
    file: "testaci-cosmos-event-class-matches-vehicle-people.json",
  },
];

interface RawMatchFile {
  event_classes: EventClass[];
  rows: Array<{
    model: ModelName;
    frame: string;
    caption: string;
    top_matches: PromptResult["top_matches"];
  }>;
}

let _payload: DataPayload | null = null;

export async function loadData(): Promise<DataPayload> {
  if (_payload) return _payload;

  const dir = benchResultsDir();
  let event_classes: EventClass[] | null = null;

  // Stitch: (dataset|model|frame) → BenchRow
  const cellMap = new Map<string, BenchRow>();
  // Track which prompt+dataset pairs we successfully loaded for advertising
  const seenPrompts = new Map<PromptId, string>();
  const seenDatasets = new Map<string, { label: string; frame_prefix: string }>();

  for (const src of SOURCES) {
    const fp = path.join(dir, src.file);
    let raw: string;
    try {
      raw = await fs.readFile(fp, "utf8");
    } catch {
      console.warn(`[loadData] missing match file ${fp} — skipping ${src.dataset}/${src.prompt}`);
      continue;
    }
    const data = JSON.parse(raw) as RawMatchFile;

    // Use the first non-empty event_classes we see; expect them identical
    // across files (same library at run-time).
    if (!event_classes) event_classes = data.event_classes;

    seenPrompts.set(src.prompt, src.prompt_label);
    seenDatasets.set(src.dataset, { label: src.dataset_label, frame_prefix: src.frame_prefix });

    for (const r of data.rows) {
      const key = `${src.dataset}|${r.model}|${r.frame}`;
      let cell = cellMap.get(key);
      if (!cell) {
        cell = { dataset: src.dataset, model: r.model, frame: r.frame, prompts: [] };
        cellMap.set(key, cell);
      }
      cell.prompts.push({
        prompt_id: src.prompt,
        caption: r.caption,
        top_matches: r.top_matches,
      });
    }
  }

  if (!event_classes) {
    throw new Error(`no match files loaded from ${dir}`);
  }
  // Attach the operator-friendly category to each event_class so the
  // client can render <optgroup> separators in the dropdowns.
  event_classes = event_classes.map((c) => ({ ...c, category: categoryOf(c.id) }));

  // Stable order: prompts in declaration order
  const promptOrder = Array.from(seenPrompts.keys());
  for (const cell of cellMap.values()) {
    cell.prompts.sort(
      (a, b) => promptOrder.indexOf(a.prompt_id) - promptOrder.indexOf(b.prompt_id)
    );
  }

  const rows = Array.from(cellMap.values());
  // Deterministic frame ordering: by dataset then by frame name
  rows.sort(
    (a, b) =>
      a.dataset.localeCompare(b.dataset) ||
      a.frame.localeCompare(b.frame) ||
      a.model.localeCompare(b.model)
  );

  const frames = Array.from(new Set(rows.map((r) => r.frame))).sort();
  const models = Array.from(new Set(rows.map((r) => r.model))) as ModelName[];
  models.sort();

  const datasets: DatasetInfo[] = Array.from(seenDatasets.entries()).map(([id, info]) => {
    const n = new Set(rows.filter((r) => r.dataset === id).map((r) => r.frame)).size;
    return { id, label: info.label, frame_prefix: info.frame_prefix, n_frames: n };
  });

  _payload = {
    event_classes,
    rows,
    models,
    frames,
    prompts: Array.from(seenPrompts.entries()).map(([id, label]) => ({ id, label })),
    datasets,
  };
  return _payload;
}
