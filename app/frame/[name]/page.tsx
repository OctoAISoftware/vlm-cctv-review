"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Annotation, AnnotationMode, ApiData } from "@/lib/types";
import { AnnotationForm } from "@/components/AnnotationForm";
import { ModeToggle } from "@/components/ModeToggle";

const AUTHOR_LS_KEY = "qwen35-review.author";

export default function FrameDetailPage() {
  // Suspense wrapper required for useSearchParams() in client components.
  return (
    <Suspense fallback={<div className="text-muted">Loading…</div>}>
      <FrameDetail />
    </Suspense>
  );
}

function FrameDetail() {
  const params = useParams<{ name: string }>();
  const router = useRouter();
  const sp = useSearchParams();
  const frame = decodeURIComponent(params.name);
  const mode: AnnotationMode = sp.get("mode") === "blind" ? "blind" : "image";

  const [data, setData] = useState<ApiData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [defaultAuthor, setDefaultAuthor] = useState("");

  useEffect(() => {
    setDefaultAuthor(localStorage.getItem(AUTHOR_LS_KEY) || "general");
  }, []);

  const reload = () => {
    fetch("/api/data")
      .then((r) => r.json())
      .then((d) => (d.error ? setErr(d.error) : setData(d)))
      .catch((e) => setErr(String(e)));
  };
  useEffect(reload, []);

  // Pull annotations for the active mode only
  const annotationsByModel = useMemo(() => {
    const m = new Map<string, Annotation>();
    if (!data) return m;
    const list = mode === "blind" ? data.annotations.blind : data.annotations.image;
    for (const a of list) {
      if (a.frame === frame) m.set(a.model, a);
    }
    return m;
  }, [data, frame, mode]);

  const rowsForFrame = useMemo(() => {
    if (!data) return [];
    return data.rows
      .filter((r) => r.frame === frame)
      .sort((a, b) => a.model.localeCompare(b.model));
  }, [data, frame]);

  const allFrames = data?.frames ?? [];
  const idx = allFrames.indexOf(frame);
  const prev = idx > 0 ? allFrames[idx - 1] : null;
  const next = idx >= 0 && idx < allFrames.length - 1 ? allFrames[idx + 1] : null;

  const navTo = (target: string) => {
    const params = new URLSearchParams(sp.toString());
    router.push(`/frame/${encodeURIComponent(target)}?${params.toString()}`);
  };

  // Keyboard shortcuts: ← → to navigate frames, M to toggle mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName?.match(/INPUT|TEXTAREA|SELECT/)) return;
      if (e.key === "ArrowLeft" && prev) navTo(prev);
      if (e.key === "ArrowRight" && next) navTo(next);
      if (e.key === "m" || e.key === "M") setMode(mode === "image" ? "blind" : "image");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prev, next, mode]);

  const setMode = (m: AnnotationMode) => {
    const params = new URLSearchParams(sp.toString());
    if (m === "image") params.delete("mode");
    else params.set("mode", m);
    router.push(`/frame/${encodeURIComponent(frame)}?${params.toString()}`);
  };

  if (err) return <div className="text-disapprove">Error: {err}</div>;
  if (!data) return <div className="text-muted">Loading…</div>;

  const blind = mode === "blind";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <ModeToggle mode={mode} onChange={setMode} />
        <span className="text-muted text-xs">
          {blind
            ? "BLIND: image hidden. Judge cosine matches against the captions only."
            : "Image visible. Judge against what's actually in the image."}
        </span>
      </div>

      <nav className="flex items-center gap-3 text-sm">
        <Link
          href={`/${blind ? "?mode=blind" : ""}`}
          className="text-muted hover:text-accent"
        >
          ← Back to dashboard
        </Link>
        <span className="text-muted">|</span>
        {prev ? (
          <button onClick={() => navTo(prev)} className="text-muted hover:text-accent">
            ← {prev.replace("frame_", "").replace(".jpg", "")}
          </button>
        ) : (
          <span className="text-border">← prev</span>
        )}
        <span className="text-text font-mono">{frame}</span>
        {next ? (
          <button onClick={() => navTo(next)} className="text-muted hover:text-accent">
            {next.replace("frame_", "").replace(".jpg", "")} →
          </button>
        ) : (
          <span className="text-border">next →</span>
        )}
        <span className="text-muted text-xs ml-2">arrow keys nav · M toggles mode</span>
      </nav>

      <div className={`grid grid-cols-1 ${blind ? "" : "lg:grid-cols-[480px_1fr]"} gap-6`}>
        {!blind && (
          <div className="lg:sticky lg:top-4 self-start space-y-2">
            <img
              src={`/api/images/${frame}`}
              alt={frame}
              className="w-full max-w-[480px] rounded border border-border bg-black"
            />
            <div className="text-muted text-xs">
              Frame {idx + 1} of {allFrames.length}
            </div>
          </div>
        )}

        <div className="space-y-4">
          {blind && (
            <div className="bg-surface2 border border-yellow-700/60 rounded p-3 text-sm text-yellow-200">
              <strong>Blind mode.</strong> The image is intentionally hidden. Pick the
              event_class that best matches each <em>caption text</em>, regardless of
              whether the caption is faithful to what the image actually shows.
            </div>
          )}
          {rowsForFrame.map((r) => (
            <AnnotationForm
              key={r.model}
              mode={mode}
              frame={frame}
              model={r.model}
              prompts={r.prompts}
              promptInfos={data.prompts}
              eventClasses={data.event_classes}
              initial={annotationsByModel.get(r.model) ?? null}
              defaultAuthor={defaultAuthor}
              onSaved={(a) => {
                if (a.author) {
                  localStorage.setItem(AUTHOR_LS_KEY, a.author);
                  setDefaultAuthor(a.author);
                }
                reload();
              }}
              onCleared={reload}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
