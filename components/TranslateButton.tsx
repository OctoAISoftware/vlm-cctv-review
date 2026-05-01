"use client";

import { useState } from "react";

interface Props {
  text: string;
  // Same wording as Octave's translate UI per user request: "Traduzir com Google".
  // Click → POST to /api/translate → render translated text below.
  // Caches in component state so a second click on the same text is free.
}

export function TranslateButton({ text }: Props) {
  const [translated, setTranslated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

  const trigger = async () => {
    if (translated) {
      setShown(s => !s);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, source: "en", target: "pt-BR" }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setTranslated(data.translated as string);
      setShown(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={trigger}
        disabled={busy}
        className="text-xs text-muted hover:text-accent underline-offset-2 hover:underline disabled:opacity-50"
        title={translated && shown ? "Esconder tradução" : "Traduzir com Google"}
      >
        {busy
          ? "Traduzindo…"
          : translated && shown
          ? "▾ Traduzir com Google"
          : "▸ Traduzir com Google"}
      </button>
      {translated && shown && (
        <div className="text-sm text-text leading-relaxed bg-surface2 border border-border rounded p-2 italic">
          {translated}
        </div>
      )}
      {err && <div className="text-xs text-disapprove">{err}</div>}
    </div>
  );
}
