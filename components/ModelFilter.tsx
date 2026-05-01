"use client";

import { ModelName } from "@/lib/types";

interface Props {
  models: ModelName[];
  // The active model filter. Empty string = all models.
  active: string;
  onChange: (model: string) => void;
  // Optional label override; defaults to "Model".
  label?: string;
}

// Compact pill-row for filtering by model. Used in the dashboard
// header, on the per-frame detail page, and on the random page so a
// reviewer can prioritize one model at a time across the whole app.
//
// Empty string = "all" (no filter).
export function ModelFilter({ models, active, onChange, label = "Model" }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-muted text-sm mr-1">{label}:</span>
      <button
        onClick={() => onChange("")}
        className={`px-2 py-1 rounded text-xs border ${
          active === ""
            ? "bg-accent text-bg border-accent"
            : "bg-surface text-muted border-border hover:border-accent hover:text-text"
        }`}
      >
        all
      </button>
      {models.map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`px-2 py-1 rounded text-xs border whitespace-nowrap ${
            active === m
              ? "bg-accent text-bg border-accent"
              : "bg-surface text-muted border-border hover:border-accent hover:text-text"
          }`}
          title={m}
        >
          {m}
        </button>
      ))}
    </div>
  );
}
