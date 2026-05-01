"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Annotation,
  AnnotationMode,
  EventClass,
  ModelName,
  PickSlot,
  PromptInfo,
  PromptResult,
  TopMatch,
} from "@/lib/types";
import { TranslateButton } from "./TranslateButton";

interface Props {
  mode: AnnotationMode;
  frame: string;
  model: ModelName;
  // One PromptResult per prompt we benched (frame-gun, vehicle-people, …)
  prompts: PromptResult[];
  // Display label per prompt id (from /api/data)
  promptInfos: PromptInfo[];
  eventClasses: EventClass[];
  initial: Annotation | null;
  defaultAuthor: string;
  onSaved: (a: Annotation) => void;
  onCleared: () => void;
}

const PICK_SENTINEL = {
  NONE: "",
  PROPOSE_NEW: "__new__",
} as const;

function emptyPick(): PickSlot {
  return { class_id: null, proposed_label: null, proposed_description: null };
}

// Per-prompt verdict computation. Mirrors deriveVerdict() but takes
// arbitrary top_matches so we can score the SAME human picks against
// multiple prompt-specific top-3s.
type PromptVerdict = "exact" | "partial" | "mismatch" | "unreviewed";
function derivePerPrompt(picks: number[], top_matches: TopMatch[]): PromptVerdict {
  if (picks.length === 0) return "unreviewed";
  const top1 = top_matches?.[0]?.ref_id;
  if (top1 == null) return "mismatch";
  if (picks[0] === top1) return "exact";
  if (picks.includes(top1)) return "partial";
  return "mismatch";
}

export function AnnotationForm({
  mode,
  frame,
  model,
  prompts,
  promptInfos,
  eventClasses,
  initial,
  defaultAuthor,
  onSaved,
  onCleared,
}: Props) {
  const [pick1, setPick1] = useState<PickSlot>(initial?.pick1 ?? emptyPick());
  const [pick2, setPick2] = useState<PickSlot>(initial?.pick2 ?? emptyPick());
  const [pick3, setPick3] = useState<PickSlot>(initial?.pick3 ?? emptyPick());
  const [comment, setComment] = useState(initial?.comment ?? "");
  const [author, setAuthor] = useState(initial?.author ?? defaultAuthor);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setPick1(initial?.pick1 ?? emptyPick());
    setPick2(initial?.pick2 ?? emptyPick());
    setPick3(initial?.pick3 ?? emptyPick());
    setComment(initial?.comment ?? "");
    setAuthor(initial?.author ?? defaultAuthor);
  }, [initial, defaultAuthor]);

  const pickedIds = useMemo(() => {
    const out: number[] = [];
    for (const p of [pick1, pick2, pick3]) if (p.class_id != null) out.push(p.class_id);
    return out;
  }, [pick1, pick2, pick3]);

  const pick1Filled = pick1.class_id != null || !!pick1.proposed_label?.trim();
  const canSubmit = pick1Filled && !busy;

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      // We persist the PRIMARY prompt's top_matches in the annotation
      // (for back-compat with existing dashboard code that reads it).
      // Per-prompt match-set is reconstructible from /api/data anytime.
      const primary = prompts[0]?.top_matches?.slice(0, 3) ?? [];
      const body = {
        frame,
        model,
        comment: comment.trim() || null,
        pick1, pick2, pick3,
        model_top_matches: primary,
        author: author.trim() || null,
      };
      const r = await fetch(`/api/annotations?mode=${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      onSaved(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!confirm(`Clear ${mode} annotation for ${model} on ${frame}?`)) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(
        `/api/annotations?mode=${mode}&frame=${encodeURIComponent(frame)}&model=${encodeURIComponent(model)}`,
        { method: "DELETE" }
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      onCleared();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const verdictMeta: Record<PromptVerdict, { label: string; cls: string }> = {
    exact: { label: "exact", cls: "bg-approve/20 text-approve" },
    partial: { label: "partial", cls: "bg-yellow-500/20 text-yellow-300" },
    mismatch: { label: "mismatch", cls: "bg-disapprove/20 text-disapprove" },
    unreviewed: { label: "unreviewed", cls: "bg-border text-muted" },
  };

  // Build a label lookup so the UI can show "Vehicle/People (interactions)"
  // instead of bare "vehicle-people"
  const labelOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of promptInfos) m.set(p.id, p.label);
    return m;
  }, [promptInfos]);

  return (
    <div className="bg-surface border border-border rounded p-4 space-y-3">
      <header className="flex items-baseline justify-between flex-wrap gap-2">
        <h3 className="text-text font-semibold">{model}</h3>
        <div className="flex items-center gap-1 flex-wrap">
          {prompts.map((p) => {
            const v = derivePerPrompt(pickedIds, p.top_matches);
            return (
              <span
                key={p.prompt_id}
                className={`text-xs px-2 py-0.5 rounded ${verdictMeta[v].cls}`}
                title={`${labelOf.get(p.prompt_id) ?? p.prompt_id} → ${v}`}
              >
                {labelOf.get(p.prompt_id) ?? p.prompt_id}: {verdictMeta[v].label}
              </span>
            );
          })}
        </div>
      </header>

      {prompts.map((p) => (
        <PromptBlock
          key={p.prompt_id}
          prompt={p}
          label={labelOf.get(p.prompt_id) ?? p.prompt_id}
          pickedIds={pickedIds}
          pick1Filled={pick1Filled}
        />
      ))}

      <div className="space-y-2">
        <div className="text-muted text-xs uppercase tracking-wide flex items-center justify-between">
          <span>Your top-3 (most adequate first)</span>
          <span className="text-muted normal-case">#1 required, #2 &amp; #3 optional</span>
        </div>
        <PickRow rank={1} pick={pick1} setPick={setPick1} eventClasses={eventClasses} required />
        <PickRow rank={2} pick={pick2} setPick={setPick2} eventClasses={eventClasses} />
        <PickRow rank={3} pick={pick3} setPick={setPick3} eventClasses={eventClasses} />
      </div>

      <textarea
        placeholder="Comment (optional — why is this right or wrong?)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        className="w-full text-sm min-h-[60px]"
      />

      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Author"
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          className="text-sm w-32"
        />
        <div className="flex-1" />
        {initial && (
          <button
            onClick={clear}
            disabled={busy}
            className="px-3 py-1 text-sm rounded border border-border text-muted hover:border-disapprove hover:text-disapprove disabled:opacity-50"
          >
            Clear
          </button>
        )}
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="px-4 py-1 text-sm rounded bg-accent/20 text-accent border border-accent hover:bg-accent hover:text-bg disabled:opacity-30 disabled:cursor-not-allowed"
          title={pick1Filled ? "" : "Pick #1 is required before saving"}
        >
          {initial ? "Update" : "Save"}
        </button>
      </div>

      {err && <div className="text-xs text-disapprove">{err}</div>}
    </div>
  );
}

// One per-prompt block: label + caption + Translate button + top-3 matches.
function PromptBlock({
  prompt,
  label,
  pickedIds,
  pick1Filled,
}: {
  prompt: PromptResult;
  label: string;
  pickedIds: number[];
  pick1Filled: boolean;
}) {
  return (
    <div className="bg-surface2 border border-border rounded p-3 space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-muted text-xs uppercase tracking-wide">{label}</span>
        <span className="text-muted text-xs font-mono">{prompt.prompt_id}</span>
      </div>
      <div className="text-sm text-text leading-relaxed">{prompt.caption}</div>
      <TranslateButton text={prompt.caption} />
      <ol className="space-y-1">
        {prompt.top_matches.slice(0, 3).map((m, i) => {
          const inHumanTop3 = pickedIds.includes(m.ref_id);
          const humanRank = pickedIds.indexOf(m.ref_id);
          const borderCls = !pick1Filled
            ? "border-border"
            : inHumanTop3
            ? "border-approve"
            : "border-disapprove";
          return (
            <li
              key={m.ref_id}
              className={`flex items-center gap-2 text-sm bg-surface rounded px-2 py-1 border ${borderCls}`}
              title={inHumanTop3 ? `In your top-3 at rank #${humanRank + 1}` : "Not in your top-3"}
            >
              <span className="text-muted font-mono w-6 text-right">#{i + 1}</span>
              <span className="text-muted font-mono w-12">{m.similarity.toFixed(3)}</span>
              <span className="text-text flex-1 truncate">{m.short_label}</span>
              {inHumanTop3 && (
                <span className="text-approve text-xs font-mono">→ your #{humanRank + 1}</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// One pick slot: dropdown over (none / existing classes / propose new) plus
// the propose-new fields when that option is chosen.
function PickRow({
  rank,
  pick,
  setPick,
  eventClasses,
  required = false,
}: {
  rank: 1 | 2 | 3;
  pick: PickSlot;
  setPick: (p: PickSlot) => void;
  eventClasses: EventClass[];
  required?: boolean;
}) {
  const isProposing = pick.proposed_label != null;
  const value = isProposing
    ? PICK_SENTINEL.PROPOSE_NEW
    : pick.class_id != null
    ? String(pick.class_id)
    : PICK_SENTINEL.NONE;

  const onSelectChange = (v: string) => {
    if (v === PICK_SENTINEL.NONE) {
      setPick({ class_id: null, proposed_label: null, proposed_description: null });
    } else if (v === PICK_SENTINEL.PROPOSE_NEW) {
      setPick({
        class_id: null,
        proposed_label: pick.proposed_label ?? "",
        proposed_description: pick.proposed_description ?? "",
      });
    } else {
      setPick({ class_id: Number(v), proposed_label: null, proposed_description: null });
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-muted font-mono text-sm w-8 text-right">
          #{rank}
          {required && <span className="text-disapprove">*</span>}
        </span>
        <select
          value={value}
          onChange={(e) => onSelectChange(e.target.value)}
          className="flex-1 text-sm"
        >
          <option value={PICK_SENTINEL.NONE}>{required ? "— pick one —" : "— (skip) —"}</option>
          <optgroup label="Existing event classes">
            {eventClasses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.short_label}
              </option>
            ))}
          </optgroup>
          <option value={PICK_SENTINEL.PROPOSE_NEW}>+ propose a NEW event class</option>
        </select>
      </div>
      {isProposing && (
        <div className="space-y-1 bg-surface2 p-2 rounded border border-border ml-10">
          <input
            type="text"
            placeholder="New class label (e.g. 'Cerco em motos')"
            value={pick.proposed_label ?? ""}
            onChange={(e) =>
              setPick({ ...pick, proposed_label: e.target.value })
            }
            className="w-full text-sm"
          />
          <textarea
            placeholder="What visual/textual pattern does this class capture?"
            value={pick.proposed_description ?? ""}
            onChange={(e) =>
              setPick({ ...pick, proposed_description: e.target.value })
            }
            className="w-full text-sm min-h-[50px]"
          />
        </div>
      )}
    </div>
  );
}
