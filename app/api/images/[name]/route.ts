// GET /api/images/<frame>.jpg
// Streams the JPEG from disk. Path-traversal hardened via a strict
// allowlist regex.

import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import { resolveImagePath } from "@/lib/data";

export const dynamic = "force-dynamic";

// Allowlist: <prefix>_<5+ digits>.jpg, where <prefix> is lowercase alpha
// + optional digits/hyphens. Matches both 'frame_00003.jpg' and
// 'testaci_00012.jpg' but rejects '../', absolute paths, etc.
const NAME_RE = /^[a-z][a-z0-9-]*_\d{4,6}\.jpg$/;

export async function GET(
  _req: Request,
  ctx: { params: { name: string } }
) {
  const name = ctx.params.name;
  if (!NAME_RE.test(name)) {
    return NextResponse.json({ error: "invalid frame name" }, { status: 400 });
  }
  const file = await resolveImagePath(name);
  if (!file) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  try {
    const buf = await fs.readFile(file);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "read failed" }, { status: 500 });
  }
}
