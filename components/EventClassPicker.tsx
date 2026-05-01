"use client";

import { EventClass, PickSlot } from "@/lib/types";
import { groupByCategory } from "@/lib/event_class_groups";

const PICK_SENTINEL = {
  NONE: "",
  PROPOSE_NEW: "__new__",
} as const;

interface Props {
  rank: 1 | 2 | 3;
  pick: PickSlot;
  setPick: (p: PickSlot) => void;
  eventClasses: EventClass[];
  required?: boolean;
  // Larger inputs on the random page (mobile-first); smaller on the
  // dense annotation card on the frame-detail page.
  size?: "sm" | "base";
}

// One pick slot dropdown with optgroup-grouped class options + an
// inline "propose new" form. Used by AnnotationForm and the random
// page so the categorization lives in exactly one place.
export function EventClassPicker({
  rank,
  pick,
  setPick,
  eventClasses,
  required = false,
  size = "sm",
}: Props) {
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

  const grouped = groupByCategory(eventClasses);
  const fontCls = size === "base" ? "text-base" : "text-sm";
  const rankCls = size === "base" ? "text-base w-10" : "text-sm w-8";

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className={`text-muted font-mono text-right ${rankCls}`}>
          #{rank}
          {required && <span className="text-disapprove">*</span>}
        </span>
        <select
          value={value}
          onChange={(e) => onSelectChange(e.target.value)}
          className={`flex-1 ${fontCls}`}
        >
          <option value={PICK_SENTINEL.NONE}>
            {required ? "— pick one —" : "— (skip) —"}
          </option>
          {grouped.map(({ category, items }) => (
            <optgroup key={category} label={category}>
              {items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.short_label}
                </option>
              ))}
            </optgroup>
          ))}
          <option value={PICK_SENTINEL.PROPOSE_NEW}>+ propose a NEW class</option>
        </select>
      </div>
      {isProposing && (
        <div className={`space-y-1 bg-surface2 p-2 rounded border border-border ${size === "base" ? "ml-12" : "ml-10"}`}>
          <input
            type="text"
            placeholder="New class label (e.g. 'Cerco em motos')"
            value={pick.proposed_label ?? ""}
            onChange={(e) => setPick({ ...pick, proposed_label: e.target.value })}
            className={`w-full ${fontCls}`}
          />
          <textarea
            placeholder="What visual/textual pattern does this class capture?"
            value={pick.proposed_description ?? ""}
            onChange={(e) => setPick({ ...pick, proposed_description: e.target.value })}
            className={`w-full ${fontCls} min-h-[50px]`}
          />
        </div>
      )}
    </div>
  );
}
