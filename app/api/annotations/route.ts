// POST   /api/annotations?mode=image|blind   — upsert one annotation
// DELETE /api/annotations?mode=...&frame=...&model=...  — clear one annotation

import { NextRequest, NextResponse } from "next/server";
import { Annotation, AnnotationMode, PickSlot } from "@/lib/types";
import { upsertAnnotation, deleteAnnotation } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function parseMode(req: NextRequest): AnnotationMode {
  const m = new URL(req.url).searchParams.get("mode");
  return m === "blind" ? "blind" : "image";
}

function emptyPick(): PickSlot {
  return { class_id: null, proposed_label: null, proposed_description: null };
}

function readPick(body: any, key: "pick1" | "pick2" | "pick3"): PickSlot {
  const p = body?.[key];
  if (!p || typeof p !== "object") return emptyPick();
  return {
    class_id: typeof p.class_id === "number" ? p.class_id : null,
    proposed_label: typeof p.proposed_label === "string" && p.proposed_label.trim()
      ? p.proposed_label.trim()
      : null,
    proposed_description:
      typeof p.proposed_description === "string" && p.proposed_description.trim()
        ? p.proposed_description.trim()
        : null,
  };
}

export async function POST(req: NextRequest) {
  try {
    const mode = parseMode(req);
    const body = (await req.json()) as Partial<Annotation>;
    if (!body.frame || !body.model) {
      return NextResponse.json({ error: "frame and model are required" }, { status: 400 });
    }
    const pick1 = readPick(body, "pick1");
    if (pick1.class_id == null && !pick1.proposed_label) {
      return NextResponse.json(
        { error: "pick1 is required (must have class_id or proposed_label)" },
        { status: 400 }
      );
    }
    const a: Annotation = {
      frame: body.frame,
      model: body.model as Annotation["model"],
      verdict: body.verdict ?? null,
      comment: body.comment?.trim() || null,
      pick1,
      pick2: readPick(body, "pick2"),
      pick3: readPick(body, "pick3"),
      model_top_matches: Array.isArray(body.model_top_matches)
        ? body.model_top_matches
        : null,
      author: body.author?.trim() || null,
    };
    const saved = await upsertAnnotation(mode, a);
    return NextResponse.json(saved);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const mode = parseMode(req);
  const url = new URL(req.url);
  const frame = url.searchParams.get("frame");
  const model = url.searchParams.get("model");
  if (!frame || !model) {
    return NextResponse.json({ error: "frame and model are required" }, { status: 400 });
  }
  try {
    await deleteAnnotation(mode, frame, model);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
