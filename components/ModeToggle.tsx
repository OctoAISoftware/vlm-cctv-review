"use client";

import { AnnotationMode, MODES } from "@/lib/types";

interface Props {
  mode: AnnotationMode;
  onChange: (m: AnnotationMode) => void;
}

const LABELS: Record<AnnotationMode, string> = {
  image: "With image",
  blind: "Blind (text only)",
};

const TOOLTIPS: Record<AnnotationMode, string> = {
  image:
    "Judge each model's caption + cosine matches against what's actually in the image. Tests the WHOLE pipeline (VLM + embedder + library).",
  blind:
    "Image hidden — judge cosine matches against the caption text alone. Tests JUST the embedder + library, decoupled from caption accuracy.",
};

export function ModeToggle({ mode, onChange }: Props) {
  return (
    <div className="inline-flex items-center gap-1 bg-surface2 border border-border rounded p-0.5">
      {MODES.map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          title={TOOLTIPS[m]}
          className={`px-3 py-1 rounded text-xs font-medium transition ${
            mode === m
              ? "bg-accent text-bg"
              : "text-muted hover:text-text"
          }`}
        >
          {LABELS[m]}
        </button>
      ))}
    </div>
  );
}
