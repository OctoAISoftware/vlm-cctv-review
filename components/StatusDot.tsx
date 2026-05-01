"use client";

import { Annotation, AnnotationMode, ModelName, deriveVerdict } from "@/lib/types";

interface Props {
  frame: string;
  models: ModelName[];
  annotationsByCell: { image: Map<string, Annotation>; blind: Map<string, Annotation> };
}

const VERDICT_CLS: Record<string, string> = {
  exact: "bg-approve",
  partial: "bg-yellow-400",
  mismatch: "bg-disapprove",
  unreviewed: "bg-border",
};

// Two stacked rows of 3 dots each:
//   row 1 = with-image annotations
//   row 2 = blind annotations
// Each dot shows derived verdict color (exact / partial / mismatch / unreviewed).
export function StatusDots({ frame, models, annotationsByCell }: Props) {
  return (
    <div className="flex flex-col gap-0.5" title="top: with-image | bottom: blind">
      {(["image", "blind"] as AnnotationMode[]).map((mode) => (
        <div key={mode} className="flex gap-1">
          {models.map((m) => {
            const a = annotationsByCell[mode].get(`${frame}|${m}`);
            const v = deriveVerdict(a);
            return (
              <span
                key={m}
                className={`block w-2 h-2 rounded-full ${VERDICT_CLS[v]}`}
                title={`${mode} · ${m}: ${v}`}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
