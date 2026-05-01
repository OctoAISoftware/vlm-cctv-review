"use client";

import { useState } from "react";
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
// inline "propose new" form + a tiny ⓘ button that toggles a panel
// showing the description of whatever class is currently selected.
//
// Used by AnnotationForm and the random page so the categorization +
// info-tooltip live in exactly one place.
export function EventClassPicker({
  rank,
  pick,
  setPick,
  eventClasses,
  required = false,
  size = "sm",
}: Props) {
  const [showDescription, setShowDescription] = useState(false);

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

  // Look up the currently-selected class's description for the ⓘ panel.
  // Only meaningful when an existing class is picked (not for "propose new").
  const selectedClass =
    pick.class_id != null
      ? eventClasses.find((c) => c.id === pick.class_id) ?? null
      : null;
  const canShowInfo = selectedClass !== null;

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
                // `title` gives a native browser tooltip on hover with the
                // class description — works in Chrome/Firefox/Safari with
                // a short delay. Doesn't help on mobile, where the ⓘ
                // button below covers the same use case.
                <option
                  key={c.id}
                  value={c.id}
                  title={c.content_ptbr ?? c.short_label}
                >
                  {c.short_label}
                </option>
              ))}
            </optgroup>
          ))}
          <option value={PICK_SENTINEL.PROPOSE_NEW}>+ propose a NEW class</option>
        </select>
        <button
          type="button"
          onClick={() => setShowDescription((v) => !v)}
          disabled={!canShowInfo}
          title={
            canShowInfo
              ? "Show this class's description"
              : "Select a class to see its description"
          }
          className={`px-2 py-1 rounded border text-xs ${
            canShowInfo
              ? showDescription
                ? "bg-accent text-bg border-accent"
                : "bg-surface text-muted border-border hover:border-accent hover:text-text"
              : "bg-surface text-border border-border cursor-not-allowed opacity-40"
          }`}
        >
          ⓘ
        </button>
      </div>

      {/* Inline panel: description of the currently-selected class. Toggled
          via the ⓘ button. Auto-hides when no class is selected (e.g. user
          switches back to "skip" or to "propose new"). */}
      {showDescription && selectedClass && (
        <div className={`bg-surface2 border border-accent/40 rounded p-2 ml-10 ${fontCls}`}>
          <div className="text-accent font-semibold mb-1">
            {selectedClass.short_label}
            {selectedClass.category && (
              <span className="text-muted text-xs font-normal ml-2">
                · {selectedClass.category}
              </span>
            )}
          </div>
          <div className="text-text leading-relaxed text-sm">
            {selectedClass.content_ptbr ?? "(no description available)"}
          </div>
        </div>
      )}

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
