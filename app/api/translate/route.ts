// POST /api/translate
// Translate one short text via Google Cloud Translation API v2 (Basic).
// Reuses the same key Octave uses (env GOOGLE_TRANSLATE_KEY, with the
// production fallback baked in so the review-app keeps working out of
// the box on the same host).
//
// Body: { text: string, source?: "en", target?: "pt-BR" }
// Response: { translated: string, source: string, target: string }
//
// Per-process LRU cache so repeat translations of identical caption text
// are free. The dataset has 600 captions max — the cache stays tiny.

import { NextRequest, NextResponse } from "next/server";

const KEY = process.env.GOOGLE_TRANSLATE_KEY || "";
const URL_BASE = "https://translation.googleapis.com/language/translate/v2";

const cache = new Map<string, string>();
const MAX_CACHE = 4096;

function cacheKey(text: string, source: string, target: string) {
  return `${source}|${target}|${text}`;
}

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    if (!KEY) {
      return NextResponse.json(
        { error: "GOOGLE_TRANSLATE_KEY env var is not configured on the server" },
        { status: 503 }
      );
    }
    const body = (await req.json()) as { text?: string; source?: string; target?: string };
    const text = (body.text ?? "").trim();
    if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });
    if (text.length > 4500) {
      // Google v2 caps individual q values around 5000 chars; we don't expect
      // anything close to that here, so we just refuse rather than splitting.
      return NextResponse.json({ error: "text too long (>4500 chars)" }, { status: 413 });
    }
    const source = (body.source ?? "en").trim();
    const target = (body.target ?? "pt-BR").trim();

    const key = cacheKey(text, source, target);
    const cached = cache.get(key);
    if (cached !== undefined) {
      return NextResponse.json({ translated: cached, source, target, cached: true });
    }

    const r = await fetch(`${URL_BASE}?key=${KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: [text], source, target, format: "text" }),
    });
    if (!r.ok) {
      const detail = await r.text();
      return NextResponse.json(
        { error: `Google Translate ${r.status}`, detail: detail.slice(0, 500) },
        { status: 502 }
      );
    }
    const data = (await r.json()) as { data?: { translations?: Array<{ translatedText: string }> } };
    const translated = data?.data?.translations?.[0]?.translatedText ?? "";

    if (cache.size >= MAX_CACHE) {
      // crude LRU: drop the oldest insertion key
      const firstKey = cache.keys().next().value;
      if (firstKey !== undefined) cache.delete(firstKey);
    }
    cache.set(key, translated);

    return NextResponse.json({ translated, source, target, cached: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
