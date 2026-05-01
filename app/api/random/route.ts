// POST /api/random — store one random annotation (append-only, multi-opinion).

import { NextRequest, NextResponse } from "next/server";
import { PickSlot } from "@/lib/types";
import { insertRandom } from "@/lib/random";

export const dynamic = "force-dynamic";

function readPick(body: any, key: "pick1" | "pick2" | "pick3"): PickSlot {
  const p = body?.[key];
  if (!p || typeof p !== "object") {
    return { class_id: null, proposed_label: null, proposed_description: null };
  }
  return {
    class_id: typeof p.class_id === "number" ? p.class_id : null,
    proposed_label:
      typeof p.proposed_label === "string" && p.proposed_label.trim()
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
    const body = await req.json();
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

    // Best-effort source IP. Behind cloudflared the request arrives via
    // a tunnel — capture the original IP from cf-connecting-ip; falls
    // back to x-forwarded-for, then to "tunnel" sentinel.
    const ip =
      req.headers.get("cf-connecting-ip") ??
      (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ??
      null;
    const ua = req.headers.get("user-agent") ?? null;

    const saved = await insertRandom({
      frame: body.frame,
      model: body.model,
      pick1,
      pick2: readPick(body, "pick2"),
      pick3: readPick(body, "pick3"),
      comment: body.comment?.trim() || null,
      author: body.author?.trim() || null,
      model_top_matches: Array.isArray(body.model_top_matches)
        ? body.model_top_matches
        : null,
      source_ip: ip,
      user_agent: ua,
    });
    return NextResponse.json(saved);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
