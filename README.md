# vlm-cctv-review

Next.js review app for curating per-frame VLM captions (Qwen3.5,
Cosmos-Reason2, …) against Octave's `event_class` reference library.
Companion to [`OctoAISoftware/vlm-cctv-batch`](https://github.com/OctoAISoftware/vlm-cctv-batch),
which generates the captions + cosine matches that this UI consumes.

The goal is to build a curated dataset of `(image, caption, correct event_class)`
triples that later feed into:

1. Embedder fine-tuning on real CCTV captions
2. Calibration of Octave's eventual two-trigger risk engine
   (high-single-score vs soft-three-cluster)
3. Promotion of frequently-proposed new classes into the live
   `octave_reference` library

## Repo split

This used to live as `vlm-cctv-batch/review-app/`. It was split out into
its own repo on 2026-04-30 because:

* The bench harness (`vlm-cctv-batch`) is Python + Docker for generating
  data; this is a Next.js UI with its own deps and CI surface. Mixing
  them inflated the batch repo with `node_modules`-class concerns and
  made `npm install` annoying for batch-only contributors.
* The two repos are independently versioned now. The UI advertises which
  bench-result schema versions it supports in its README.

## Stack

- Next.js 14 (App Router) + TypeScript + TailwindCSS, no SSR-incompatible deps
- Reads match files from `BENCH_RESULTS_DIR` (default: `../vlm-cctv-batch/bench_results`)
- Reads frame images from `FRAMES_DIRS` (colon-separated list, default
  `/home/suporte/datasets/cctv-sample-100:/home/suporte/datasets/testaci-frames`)
- Persists annotations to a local Supabase via raw PostgREST — no
  `@supabase/supabase-js` dependency, keeps the bundle tiny
- Translation proxy to Google Cloud Translation v2 (Basic) for the
  "Traduzir com Google" button on every caption

## Three evaluation modes

The app supports three complementary review modes that each write to
**separate Supabase tables** so they never contaminate each other:

- **With image** (default): you see the image *and* the caption *and* the
  cosine matches. Judging the WHOLE pipeline (VLM caption quality +
  embedder + library) against ground truth.
- **Blind** (text only): the image is hidden. Judge cosine matches against
  the caption text alone. Tests JUST the embedder + library, decoupled
  from caption accuracy.
- **Random** (one caption at a time, mobile-first): designed for fast
  crowdsourced contributions. Shows a random under-reviewed caption,
  asks for top-3 picks, submit → next. Multiple opinions per cell are
  the point — the table has no `(frame, model)` unique constraint.

The **delta** between with-image and blind isolates the bottleneck:
- Captions wrong but blind picks right → VLM is the problem
- Captions right but blind picks wrong → embedder/library is the problem

Toggle modes via the header. URL params: `?mode=blind`, or visit `/random`.
Press **M** on a frame page to flip image⇄blind.

## Public access (tunnel)

For sharing the random-mode flow with people outside our LAN we run a
localtunnel via PM2 with a stable subdomain:

```bash
# Process: qwen35-tunnel
pm2 logs qwen35-tunnel        # tail traffic
pm2 restart qwen35-tunnel     # if URL stops responding
```

Public URL (stable across restarts): **https://qwen35-octoai-review.loca.lt**

Most visitors land directly on the app; some networks/browsers show a
one-time interstitial asking for the host's public IP as a "tunnel
password" (`187.19.3.18`). After they enter it once, it's bypassed for
their session.

If localtunnel ever goes down, the script is `scripts/run-tunnel.sh` —
restart with `pm2 restart qwen35-tunnel` or fall back to:

```bash
~/.local/bin/cloudflared tunnel --url http://localhost:3030
```

## Ranked top-3 picks

For each (frame, model) cell the reviewer picks an ordered top-3 of the
event_classes that *should* match — `#1` is required, `#2` and `#3` are
optional (so reviewers don't have to invent ranks they don't feel). Any
slot can also `+ propose a NEW event class` if the existing 25 don't fit.

The verdict is **derived** from the picks — no separate approve/disapprove
buttons:
- **exact** (green) — model's #1 == your #1
- **partial** (yellow) — model's #1 is somewhere in your top-3
- **mismatch** (red) — model's #1 is nowhere in your top-3

The form draws **green/red borders** around each of the model's top-3
cosine match lines based on whether each appears in your top-3, so the
agreement is visible at a glance.

## Why ranked top-3 (vs. single pick)

Two reasons that matter for the eventual risk-detection engine:

1. **IR-grade evaluation metrics**: the dashboard shows `precision@1`,
   `recall@3`, and `NDCG@3` per model per mode. These are how
   library/embedder changes will be scored apples-to-apples in the future.
2. **Calibration data for both risk triggers**: the planned engine fires
   on either (a) one class with a very high score *or* (b) three classes
   with softly-lower scores. Trigger (b) needs ranked human data to
   calibrate against — single-class annotation cannot answer "are model's
   #2 and #3 in the right neighborhood?" but ranked top-3 measures it
   directly via `recall@3` and set overlap.

Each annotation also persists a snapshot of the model's cosine top-3 at
annotation time (`model_top_matches` jsonb column), so the future
engine-calibration query can join human picks ↔ model cosines in one SQL
without re-deriving anything.

## Schema

| File | What |
|---|---|
| `migrations/001_init.sql` | original `qwen35_review_annotations` table (single suggested class + verdict). Kept for back-compat. |
| `migrations/002_ranked_picks.sql` | adds `pick1/2/3_class_id` + `pick1/2/3_proposed_*` + `model_top_matches` to the image-aware table; makes verdict nullable. |
| `migrations/003_blind_annotations.sql` | creates the separate `qwen35_review_blind_annotations` table with the same shape as the post-002 image table. |
| `migrations/004_random_annotations.sql` | creates the `qwen35_review_random_annotations` table — same ranked-top-3 shape, but **NO** `(frame, model)` unique constraint (multi-opinion crowdsourced reviews) and adds `source_ip` + `user_agent` columns. |

All three are idempotent; safe to re-run. Suggested-class FKs point into
`octave_reference(id)` so promoting a proposed-new label to a real
event_class is a one-INSERT operation that all existing annotations
keep referencing correctly.

## Running

```bash
npm install
npm run build

# REQUIRED env vars before npm start (or via PM2 ecosystem.config.js):
export SUPABASE_KEY="sb_secret_xxxxx"          # Octave Supabase service-role key
export GOOGLE_TRANSLATE_KEY="AIza_xxxxx"       # Google Cloud Translation v2 (Basic) — for the "Traduzir com Google" button

# Optional (sane defaults for the LocalDC Spark host):
export SUPABASE_URL="http://10.5.255.107:54321"
export BENCH_RESULTS_DIR="/path/to/vlm-cctv-batch/bench_results"
export FRAMES_DIRS="/home/suporte/datasets/cctv-sample-100:/home/suporte/datasets/testaci-frames"

pm2 start npm --name vlm-cctv-review -- run start
```

Then open http://10.5.255.107:3030/

`npm run dev` serves on port 3030 too if you want hot reload.

### Environment overrides

| var | required | default | what |
|---|---|---|---|
| `SUPABASE_KEY` | **yes** | (none) | Service-role key for the Supabase that hosts `qwen35_review_*` tables. The app warns at boot and 401s on writes if missing. |
| `GOOGLE_TRANSLATE_KEY` | for translate | (none) | Google Cloud Translation v2 Basic API key. Without it the "Traduzir com Google" button returns 503. |
| `SUPABASE_URL` | no | `http://10.5.255.107:54321` | PostgREST endpoint base URL |
| `BENCH_RESULTS_DIR` | no | `../bench_results` | Match JSONs from `vlm-cctv-batch` |
| `FRAMES_DIRS` | no | `…/cctv-sample-100:…/testaci-frames` | Colon-separated list of frame-image directories. The image route searches each in order. |

> **Why no defaults for the secret keys?** GitHub push protection
> rejects commits containing recognized secret patterns. Hardcoded
> fallbacks are also a code smell — secrets belong in env vars.

## URL map

- `/` — dashboard: 100-frame grid + per-mode KPI cards + per-mode IR
  metrics (P@1 / R@3 / NDCG@3) overall and per-model + filters
  (`all` / `todo` / `done` / `disagreed`). Each thumbnail shows two
  rows of dots: top row = with-image annotations, bottom row = blind.
- `/?mode=blind` — same dashboard scoped to the blind mode (thumbs
  blurred to discourage cheating, still shown so you can navigate).
- `/frame/frame_NNNNN.jpg` — per-frame detail in image mode.
- `/frame/frame_NNNNN.jpg?mode=blind` — same page in blind mode (image
  hidden). Arrow keys navigate prev/next; **M** toggles modes.
- `/random` — mobile-first single-caption-at-a-time flow. Picks an
  under-reviewed cell (weighted toward zero-reviews-so-far), asks for
  top-3, submit → next. Best path for sharing externally.

## API

- `GET /api/data` — full bench dataset + annotations for BOTH curated
  modes (image + blind).
- `POST /api/annotations?mode=image|blind` — upsert one annotation by
  `(frame, model)`. Body must include `pick1` (existing or proposed).
- `DELETE /api/annotations?mode=...&frame=...&model=...` — clear one.
- `GET /api/images/frame_NNNNN.jpg` — serve image from disk
  (path-traversal hardened, allowlist regex).
- `GET /api/random/next?exclude=frame|model,…` — fetch one cell to
  review. Picks the lowest-review-count bucket then uniform-randoms
  inside. `exclude` lets the client skip cells the same anonymous
  visitor has already seen this session.
- `POST /api/random` — append one random annotation. Captures
  `cf-connecting-ip` / `x-forwarded-for` as `source_ip` and
  `user-agent` as light provenance for abuse handling.

## Promoting a new class

Aggregating proposed-class labels across both tables and all rank slots:

```sql
WITH all_proposals AS (
  SELECT 'image' AS src, frame, model, author,
         pick1_proposed_label   AS lbl, pick1_proposed_description   AS descr, 1 AS rank
  FROM qwen35_review_annotations WHERE pick1_proposed_label IS NOT NULL
  UNION ALL SELECT 'image', frame, model, author, pick2_proposed_label, pick2_proposed_description, 2
  FROM qwen35_review_annotations WHERE pick2_proposed_label IS NOT NULL
  UNION ALL SELECT 'image', frame, model, author, pick3_proposed_label, pick3_proposed_description, 3
  FROM qwen35_review_annotations WHERE pick3_proposed_label IS NOT NULL
  UNION ALL SELECT 'blind', frame, model, author, pick1_proposed_label, pick1_proposed_description, 1
  FROM qwen35_review_blind_annotations WHERE pick1_proposed_label IS NOT NULL
  UNION ALL SELECT 'blind', frame, model, author, pick2_proposed_label, pick2_proposed_description, 2
  FROM qwen35_review_blind_annotations WHERE pick2_proposed_label IS NOT NULL
  UNION ALL SELECT 'blind', frame, model, author, pick3_proposed_label, pick3_proposed_description, 3
  FROM qwen35_review_blind_annotations WHERE pick3_proposed_label IS NOT NULL
)
SELECT lbl, count(*) AS votes,
       count(*) FILTER (WHERE rank = 1) AS rank1_votes,
       array_agg(DISTINCT author) AS reviewers,
       string_agg(DISTINCT descr, E'\n---\n') AS rationales
FROM all_proposals
GROUP BY lbl
ORDER BY votes DESC;
```

Then for the labels we want, INSERT into `octave_reference` with
`type='event_class'` and `metadata.short_label` set, run the embedding
backfill, and Octave's live classifier picks them up automatically.
