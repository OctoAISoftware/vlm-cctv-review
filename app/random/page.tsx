"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { EventClass, ModelName, PickSlot, PromptId, TopMatch } from "@/lib/types";
import { TranslateButton } from "@/components/TranslateButton";
import { EventClassPicker } from "@/components/EventClassPicker";
import { ModelFilter } from "@/components/ModelFilter";

interface RandomCell {
  frame: string;
  model: ModelName;
  // Now includes prompt info — random mode lands on a (frame, model, prompt) triple.
  prompt_id: PromptId;
  prompt_label: string;
  caption: string;
  top_matches: TopMatch[];
  reviews_so_far: number;
  cells_total: number;
  cells_seen: number;
  event_classes: EventClass[];
}

const AUTHOR_LS_KEY = "qwen35-review.author";
const SEEN_LS_KEY = "qwen35-review.random.seen";

function emptyPick(): PickSlot {
  return { class_id: null, proposed_label: null, proposed_description: null };
}

export default function RandomPage() {
  // Suspense wrapper: useSearchParams forces a CSR bailout during build.
  return (
    <Suspense fallback={<div className="text-muted p-4">Loading…</div>}>
      <RandomInner />
    </Suspense>
  );
}

function RandomInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const modelFilter = sp.get("model") ?? "";
  // Set of model names known to the system, populated from the first
  // /api/random/next response (which includes event_classes anyway). We
  // hold it in state so the ModelFilter pills render once we have data.
  const [knownModels, setKnownModels] = useState<ModelName[]>([]);

  const [cell, setCell] = useState<RandomCell | null>(null);
  const [nextCell, setNextCell] = useState<RandomCell | null>(null);
  const [pick1, setPick1] = useState<PickSlot>(emptyPick());
  const [pick2, setPick2] = useState<PickSlot>(emptyPick());
  const [pick3, setPick3] = useState<PickSlot>(emptyPick());
  const [comment, setComment] = useState("");
  const [author, setAuthor] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [submittedCount, setSubmittedCount] = useState(0);

  // Track which cells this browser has already seen this session, so the
  // weighted picker on the server doesn't keep handing us the same one.
  const seenRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(SEEN_LS_KEY) || "[]");
      if (Array.isArray(stored)) seenRef.current = new Set(stored);
    } catch {}
    setAuthor(localStorage.getItem(AUTHOR_LS_KEY) || "");
  }, []);

  const persistSeen = (cellKey: string) => {
    seenRef.current.add(cellKey);
    try {
      localStorage.setItem(SEEN_LS_KEY, JSON.stringify(Array.from(seenRef.current)));
    } catch {}
  };

  const fetchOne = useCallback(async (): Promise<RandomCell | null> => {
    const params = new URLSearchParams();
    const exclude = Array.from(seenRef.current).join(",");
    if (exclude) params.set("exclude", exclude);
    if (modelFilter) params.set("model", modelFilter);
    const url = `/api/random/next${params.toString() ? `?${params.toString()}` : ""}`;
    const r = await fetch(url);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.error || `HTTP ${r.status}`);
    }
    return r.json();
  }, [modelFilter]);

  // Discover the full model list once so the ModelFilter pill row can
  // render. /api/data is the cheapest way to learn it.
  useEffect(() => {
    fetch("/api/data")
      .then((r) => r.json())
      .then((d) => Array.isArray(d?.models) && setKnownModels(d.models))
      .catch(() => {});
  }, []);

  const setModel = (m: string) => {
    const params = new URLSearchParams(sp.toString());
    if (!m) params.delete("model");
    else params.set("model", m);
    router.push(`/random${params.toString() ? `?${params.toString()}` : ""}`);
    // Force a re-pick by clearing the current cell — the fetchOne dep
    // change in useCallback will trigger via the next call.
    setCell(null);
    setNextCell(null);
  };

  // The "seen" key is now per (frame, model, prompt) triple so the same
  // anonymous user can still land on the OTHER prompt for the same image.
  const seenKeyOf = (c: { frame: string; model: string; prompt_id: PromptId }) =>
    `${c.frame}|${c.model}|${c.prompt_id}`;

  // Initial load + prefetch the next one. Re-runs when modelFilter changes
  // (changing the URL ?model= triggers a refetch with the narrower scope).
  useEffect(() => {
    (async () => {
      try {
        const first = await fetchOne();
        setCell(first);
        if (first) {
          persistSeen(seenKeyOf(first));
          fetchOne().then(setNextCell).catch(() => {});
        } else {
          setNextCell(null);
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelFilter]);

  const resetForm = () => {
    setPick1(emptyPick());
    setPick2(emptyPick());
    setPick3(emptyPick());
    setComment("");
    setErr(null);
  };

  const advance = useCallback((newCell: RandomCell | null) => {
    setCell(newCell);
    resetForm();
    if (newCell) {
      persistSeen(seenKeyOf(newCell));
      fetchOne().then(setNextCell).catch(() => setNextCell(null));
    } else {
      setNextCell(null);
    }
  }, [fetchOne]);

  const submit = async () => {
    if (!cell) return;
    if (pick1.class_id == null && !pick1.proposed_label?.trim()) {
      setErr("Pick #1 is required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      if (author.trim()) localStorage.setItem(AUTHOR_LS_KEY, author.trim());
      const r = await fetch("/api/random", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          frame: cell.frame,
          model: cell.model,
          pick1, pick2, pick3,
          comment: comment.trim() || null,
          author: author.trim() || null,
          model_top_matches: cell.top_matches,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setSubmittedCount((c) => c + 1);
      // Advance to the prefetched next, then refill the pre-fetch slot.
      advance(nextCell ?? (await fetchOne()));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    if (!cell) return;
    setBusy(true);
    try {
      advance(nextCell ?? (await fetchOne()));
    } finally {
      setBusy(false);
    }
  };

  if (err && !cell) {
    return <div className="text-disapprove p-4">Error: {err}</div>;
  }
  if (!cell) {
    return <div className="text-muted p-4">Loading…</div>;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="bg-surface border border-border rounded p-3 text-sm">
        <p className="text-text">
          <strong>Random review.</strong> Read the description below and pick the{" "}
          <strong>top 3 event classes</strong> you'd assign to it (rank #1 = best fit).
          We're not showing the image — judge the text only.
        </p>
        <p className="text-muted text-xs mt-1">
          Your picks help us decide which curated classes match real CCTV captions.
          Submitted: <strong className="text-accent">{submittedCount}</strong> ·{" "}
          {cell.cells_seen}/{cell.cells_total} cells touched globally.
          {modelFilter && (
            <span className="block mt-0.5 text-accent">
              filtering to: {modelFilter}
            </span>
          )}
        </p>
      </div>

      {knownModels.length > 0 && (
        <div className="bg-surface border border-border rounded p-2">
          <ModelFilter models={knownModels} active={modelFilter} onChange={setModel} />
        </div>
      )}

      <input
        type="text"
        placeholder="Your name or handle (optional)"
        value={author}
        onChange={(e) => setAuthor(e.target.value)}
        className="w-full text-base"
        autoComplete="off"
      />

      <div className="bg-surface border border-border rounded p-4 space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-muted text-xs uppercase tracking-wide">
            Caption #{submittedCount + 1}
          </span>
          <span className="text-muted text-xs" title={`prompt id: ${cell.prompt_id}`}>
            from prompt: <span className="text-accent">{cell.prompt_label}</span>
          </span>
        </div>
        <div className="text-text text-base leading-relaxed">{cell.caption}</div>
        <TranslateButton text={cell.caption} />
      </div>

      <div className="space-y-2">
        <div className="text-muted text-xs uppercase tracking-wide">
          Your top-3 (most adequate first)
        </div>
        <EventClassPicker rank={1} pick={pick1} setPick={setPick1} eventClasses={cell.event_classes} required size="base" />
        <EventClassPicker rank={2} pick={pick2} setPick={setPick2} eventClasses={cell.event_classes} size="base" />
        <EventClassPicker rank={3} pick={pick3} setPick={setPick3} eventClasses={cell.event_classes} size="base" />
      </div>

      <textarea
        placeholder="Comment (optional)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        className="w-full text-base min-h-[60px]"
      />

      {err && <div className="text-sm text-disapprove">{err}</div>}

      <div className="grid grid-cols-2 gap-2 sticky bottom-2 bg-bg/95 backdrop-blur p-2 rounded border border-border">
        <button
          onClick={skip}
          disabled={busy}
          className="py-3 px-4 rounded border border-border text-muted hover:border-disapprove hover:text-disapprove disabled:opacity-50 text-base"
        >
          Skip
        </button>
        <button
          onClick={submit}
          disabled={busy || (!pick1.class_id && !pick1.proposed_label?.trim())}
          className="py-3 px-4 rounded bg-accent text-bg font-semibold hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed text-base"
        >
          {busy ? "Saving…" : "Submit & next"}
        </button>
      </div>

      <div className="text-center text-xs text-muted">
        <Link href="/" className="hover:text-accent">← back to dashboard</Link>
      </div>
    </div>
  );
}

// PickRow used to live here; consolidated into components/EventClassPicker.tsx
// so it shares the optgroup-grouped class list with AnnotationForm instead
// of drifting copies.
