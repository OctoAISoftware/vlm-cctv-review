// GET /api/data — full bench dataset + current annotations for BOTH modes.
// Single fat endpoint because the dataset is small; client filters by mode.

import { NextResponse } from "next/server";
import { loadData } from "@/lib/data";
import { listAnnotations } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [data, image, blind] = await Promise.all([
      loadData(),
      listAnnotations("image"),
      listAnnotations("blind"),
    ]);
    return NextResponse.json({
      ...data,
      annotations: { image, blind },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
