"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Annotation,
  AnnotationMode,
  ApiData,
  deriveVerdict,
  isAnnotated,
  ModelName,
} from "@/lib/types";
import { StatusDots } from "@/components/StatusDot";
import { ModeToggle } from "@/components/ModeToggle";

type Filter = "all" | "todo" | "done" | "disagreed";

export default function DashboardPage() {
  // Suspense wrapper required because the inner component reads
  // useSearchParams(), which forces a client-side bailout during
  // static prerendering.
  return (
    <Suspense fallback={<div className="text-muted">Loading…</div>}>
      <Dashboard />
    </Suspense>
  );
}

function Dashboard() {
  const router = useRouter();
  const sp = useSearchParams();
  const mode: AnnotationMode = sp.get("mode") === "blind" ? "blind" : "image";
  const filter: Filter =
    (["all", "todo", "done", "disagreed"] as Filter[]).find((f) => f === sp.get("filter")) ??
    "all";
  // Active dataset filter — empty = all datasets shown.
  const datasetFilter = sp.get("dataset") ?? "";

  const [data, setData] = useState<ApiData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/data")
      .then((r) => r.json())
      .then((d) => (d.error ? setErr(d.error) : setData(d)))
      .catch((e) => setErr(String(e)));
  }, []);

  const annotationsByCell = useMemo(() => {
    const out: Record<AnnotationMode, Map<string, Annotation>> = {
      image: new Map(),
      blind: new Map(),
    };
    if (!data) return out;
    for (const a of data.annotations.image) out.image.set(`${a.frame}|${a.model}`, a);
    for (const a of data.annotations.blind) out.blind.set(`${a.frame}|${a.model}`, a);
    return out;
  }, [data]);

  // Per-mode metrics: count of cells reviewed, P@1 / R@3 / NDCG@3 (top-3 ranked).
  // Definitions for derived metrics:
  //   * P@1   — fraction where model's top-1 == human's top-1 (existing class only)
  //   * R@3   — fraction where model's top-1 appears anywhere in human's top-3
  //   * NDCG@3 — graded relevance at rank position; classic IR metric
  const metrics = useMemo(() => {
    const compute = (anns: Annotation[]) => {
      let n = 0, p1 = 0, r3 = 0, ndcgSum = 0;
      const perModel: Record<string, { n: number; p1: number; r3: number; ndcg: number }> = {};
      for (const a of anns) {
        if (!isAnnotated(a)) continue;
        const modelTop1 = a.model_top_matches?.[0]?.ref_id ?? null;
        if (modelTop1 == null) continue;
        const humanIds: number[] = [];
        for (const p of [a.pick1, a.pick2, a.pick3]) if (p.class_id != null) humanIds.push(p.class_id);
        if (humanIds.length === 0) continue;
        const v = deriveVerdict(a);
        n++;
        const exact = v === "exact" ? 1 : 0;
        const inTop3 = (v === "exact" || v === "partial") ? 1 : 0;
        // NDCG@3 with binary relevance, treating model's top-1 as the only
        // ranked item under test. rel = 1 if it's in human's picks, weighted
        // by where it appears in human's top-3 (ideal rank = 1).
        const idx = humanIds.indexOf(modelTop1);
        const dcg = idx === -1 ? 0 : 1 / Math.log2(idx + 2);
        const idealDcg = 1; // ideal: model's top-1 == human's top-1
        const ndcg = idealDcg > 0 ? dcg / idealDcg : 0;
        p1 += exact;
        r3 += inTop3;
        ndcgSum += ndcg;
        const key = a.model;
        perModel[key] = perModel[key] ?? { n: 0, p1: 0, r3: 0, ndcg: 0 };
        perModel[key].n++;
        perModel[key].p1 += exact;
        perModel[key].r3 += inTop3;
        perModel[key].ndcg += ndcg;
      }
      return {
        n,
        p1: n ? p1 / n : 0,
        r3: n ? r3 / n : 0,
        ndcg: n ? ndcgSum / n : 0,
        perModel,
      };
    };
    return {
      image: compute(data?.annotations.image ?? []),
      blind: compute(data?.annotations.blind ?? []),
    };
  }, [data]);

  const counts = useMemo(() => {
    if (!data) return { total: 0, done: 0, frames: 0, framesDone: 0, disapproved: 0, proposedNew: 0 };
    const total = data.frames.length * data.models.length;
    const anns = mode === "image" ? data.annotations.image : data.annotations.blind;
    const map = annotationsByCell[mode];
    const done = anns.filter(isAnnotated).length;
    const frames = data.frames.length;
    const framesDone = data.frames.filter((f) =>
      data.models.every((m) => {
        const a = map.get(`${f}|${m}`);
        return a && isAnnotated(a);
      })
    ).length;
    const disapproved = anns.filter((a) => deriveVerdict(a) === "mismatch").length;
    const proposedNew = anns.filter(
      (a) => !!a.pick1.proposed_label || !!a.pick2.proposed_label || !!a.pick3.proposed_label
    ).length;
    return { total, done, frames, framesDone, disapproved, proposedNew };
  }, [data, annotationsByCell, mode]);

  // Map each frame -> dataset id so we can scope filters/grids by dataset.
  const datasetByFrame = useMemo(() => {
    const m = new Map<string, string>();
    if (!data) return m;
    for (const r of data.rows) m.set(r.frame, r.dataset);
    return m;
  }, [data]);

  const framesInDataset = useMemo(() => {
    if (!data) return [];
    return data.frames.filter((f) =>
      datasetFilter ? datasetByFrame.get(f) === datasetFilter : true
    );
  }, [data, datasetFilter, datasetByFrame]);

  const visibleFrames = useMemo(() => {
    if (!data) return [];
    const map = annotationsByCell[mode];
    return framesInDataset.filter((f) => {
      const cells = data.models.map((m) => map.get(`${f}|${m}`));
      const reviewed = cells.filter((a) => a && isAnnotated(a)).length;
      const allReviewed = reviewed === data.models.length;
      const anyDisagreed = cells.some((a) => deriveVerdict(a) === "mismatch");
      if (filter === "todo") return !allReviewed;
      if (filter === "done") return allReviewed;
      if (filter === "disagreed") return anyDisagreed;
      return true;
    });
  }, [data, filter, mode, annotationsByCell, framesInDataset]);

  const setMode = (m: AnnotationMode) => {
    const params = new URLSearchParams(sp.toString());
    if (m === "image") params.delete("mode");
    else params.set("mode", m);
    router.push(`/?${params.toString()}`);
  };
  const setFilter = (f: Filter) => {
    const params = new URLSearchParams(sp.toString());
    if (f === "all") params.delete("filter");
    else params.set("filter", f);
    router.push(`/?${params.toString()}`);
  };
  const setDataset = (d: string) => {
    const params = new URLSearchParams(sp.toString());
    if (!d) params.delete("dataset");
    else params.set("dataset", d);
    router.push(`/?${params.toString()}`);
  };

  if (err) return <div className="text-disapprove">Error: {err}</div>;
  if (!data) return <div className="text-muted">Loading…</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <ModeToggle mode={mode} onChange={setMode} />
        <div className="text-muted text-xs">
          {mode === "blind"
            ? "BLIND: image hidden when reviewing — judging cosine matches against captions only."
            : "WITH IMAGE: judging the whole pipeline (VLM caption + cosine match) against the actual image."}
        </div>
      </div>

      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label="Frames" value={counts.frames} />
        <Stat label="Models" value={data.models.length} />
        <Stat label={`Cells reviewed (${mode})`} value={`${counts.done} / ${counts.total}`} />
        <Stat label={`Frames complete (${mode})`} value={`${counts.framesDone} / ${counts.frames}`} />
        <Stat label="Mismatches" value={counts.disapproved} accent="disapprove" />
        <Stat label="New-class proposals" value={counts.proposedNew} accent="accent" />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <MetricsCard mode="image" m={metrics.image} models={data.models} active={mode === "image"} />
        <MetricsCard mode="blind" m={metrics.blind} models={data.models} active={mode === "blind"} />
      </section>

      <section className="flex flex-wrap gap-2 items-center">
        <span className="text-muted text-sm">Dataset:</span>
        <button
          onClick={() => setDataset("")}
          className={`px-3 py-1 rounded text-sm border ${
            datasetFilter === ""
              ? "bg-accent text-bg border-accent"
              : "bg-surface text-text border-border hover:border-accent"
          }`}
        >
          all ({data.frames.length})
        </button>
        {data.datasets.map((d) => (
          <button
            key={d.id}
            onClick={() => setDataset(d.id)}
            title={d.label}
            className={`px-3 py-1 rounded text-sm border ${
              datasetFilter === d.id
                ? "bg-accent text-bg border-accent"
                : "bg-surface text-text border-border hover:border-accent"
            }`}
          >
            {d.id} ({d.n_frames})
          </button>
        ))}
      </section>

      <section className="flex flex-wrap gap-2 items-center">
        <span className="text-muted text-sm">Filter ({mode}):</span>
        {(["all", "todo", "done", "disagreed"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded text-sm border ${
              filter === f
                ? "bg-accent text-bg border-accent"
                : "bg-surface text-text border-border hover:border-accent"
            }`}
          >
            {f}
          </button>
        ))}
        <span className="text-muted text-sm ml-2">{visibleFrames.length} shown</span>
        <span className="text-muted text-xs ml-auto">dot rows: top=image, bottom=blind</span>
      </section>

      <section className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-3">
        {visibleFrames.map((f) => (
          <Link
            key={f}
            href={`/frame/${encodeURIComponent(f)}${mode === "blind" ? "?mode=blind" : ""}`}
            className="block bg-surface border border-border rounded overflow-hidden hover:border-accent transition"
          >
            <img
              src={`/api/images/${f}`}
              alt={f}
              loading="lazy"
              className={`w-full h-32 object-cover bg-black ${mode === "blind" ? "opacity-30 blur-sm" : ""}`}
            />
            <div className="p-2 text-xs flex items-center justify-between">
              <span className="font-mono">{f.replace("frame_", "").replace(".jpg", "")}</span>
              <StatusDots frame={f} models={data.models} annotationsByCell={annotationsByCell} />
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}

function Stat({
  label, value, accent,
}: { label: string; value: number | string; accent?: "accent" | "disapprove" }) {
  const color = accent === "disapprove" ? "text-disapprove" : accent === "accent" ? "text-accent" : "text-text";
  return (
    <div className="bg-surface border border-border rounded p-3">
      <div className="text-muted text-xs uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${color}`}>{value}</div>
    </div>
  );
}

function MetricsCard({
  mode, m, models, active,
}: {
  mode: AnnotationMode;
  m: { n: number; p1: number; r3: number; ndcg: number; perModel: Record<string, { n: number; p1: number; r3: number; ndcg: number }> };
  models: ModelName[];
  active: boolean;
}) {
  return (
    <div className={`bg-surface border rounded p-3 ${active ? "border-accent" : "border-border"}`}>
      <div className="flex items-baseline justify-between">
        <h3 className="font-semibold">
          {mode === "image" ? "With image" : "Blind"} metrics
        </h3>
        <span className="text-muted text-xs">{m.n} cells</span>
      </div>
      <table className="text-sm w-full mt-2">
        <thead className="text-muted text-xs">
          <tr>
            <th className="text-left font-normal">Model</th>
            <th className="text-right font-normal">N</th>
            <th className="text-right font-normal" title="precision@1: human #1 == model #1">P@1</th>
            <th className="text-right font-normal" title="recall@3: model #1 anywhere in human top-3">R@3</th>
            <th className="text-right font-normal" title="normalized DCG @ 3">NDCG@3</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-border text-text">
            <td>overall</td>
            <td className="text-right font-mono">{m.n}</td>
            <td className="text-right font-mono">{(m.p1 * 100).toFixed(0)}%</td>
            <td className="text-right font-mono">{(m.r3 * 100).toFixed(0)}%</td>
            <td className="text-right font-mono">{m.ndcg.toFixed(3)}</td>
          </tr>
          {models.map((mn) => {
            const r = m.perModel[mn];
            if (!r || r.n === 0) {
              return (
                <tr key={mn} className="text-muted">
                  <td>{mn}</td>
                  <td className="text-right font-mono">0</td>
                  <td className="text-right font-mono">—</td>
                  <td className="text-right font-mono">—</td>
                  <td className="text-right font-mono">—</td>
                </tr>
              );
            }
            return (
              <tr key={mn} className="text-text">
                <td>{mn}</td>
                <td className="text-right font-mono">{r.n}</td>
                <td className="text-right font-mono">{((r.p1 / r.n) * 100).toFixed(0)}%</td>
                <td className="text-right font-mono">{((r.r3 / r.n) * 100).toFixed(0)}%</td>
                <td className="text-right font-mono">{(r.ndcg / r.n).toFixed(3)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
