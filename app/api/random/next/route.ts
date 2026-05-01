// GET /api/random/next?exclude=frame_00000.jpg|Qwen3.5-2B,frame_00001.jpg|Qwen3.5-4B
// Returns the next cell to review (weighted toward under-reviewed cells).

import { NextRequest, NextResponse } from "next/server";
import { loadData } from "@/lib/data";
import { loadReviewCounts, pickRandomCell } from "@/lib/random";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const excludeRaw = url.searchParams.get("exclude") ?? "";
    const exclude = new Set(
      excludeRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    );

    const [data, counts] = await Promise.all([loadData(), loadReviewCounts()]);
    const labelById = Object.fromEntries(data.prompts.map((p) => [p.id, p.label]));
    const cell = pickRandomCell(data.rows, counts, labelById, exclude);
    if (!cell) {
      return NextResponse.json({ error: "no cells available" }, { status: 404 });
    }
    return NextResponse.json({
      ...cell,
      event_classes: data.event_classes,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
