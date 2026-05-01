-- Migration: evolve qwen35_review_annotations from
--   "single verdict + one suggested class"
-- to
--   "ranked top-3 of correct classes (rank #1 required, #2/#3 optional)
--    + persisted snapshot of the model's cosine scores at annotation time
--    + verdict derived from rank picks (no more required column)"
--
-- Why each change:
--
-- * pickN_class_id  -- which existing event_class is the Nth-best fit for
--   this image. Rank 1 should always be filled when the row exists; 2/3
--   are optional so reviewers don't have to invent ranks they don't feel.
--
-- * pickN_proposed_label / pickN_proposed_description -- if the right
--   class doesn't exist in the library yet, the reviewer can propose a
--   new one at ANY rank slot (not just disapprove anymore).
--
-- * model_top_matches -- jsonb snapshot of the model's top-3 (ref_id +
--   short_label + similarity) AT THE TIME of annotation. We pull these
--   from the bench JSON today, but persisting them here means the engine
--   that later calibrates "high-single-score" vs "soft-three-cluster"
--   thresholds can join everything in one SQL query without re-deriving.
--
-- * verdict -- now nullable + auto-computable. We keep the column for
--   backward compat with anything that already queried it, but the app
--   no longer requires it; if NULL, the dashboard derives:
--     pick1 == model_top_matches[0].ref_id  -> 'approve'
--     model_top_matches[0..2] contains pick1 -> 'partial'
--     otherwise                              -> 'disapprove'
--
-- Migration is additive + idempotent so it's safe to run multiple times.

-- 1) add the new columns (idempotent via IF NOT EXISTS on each).
ALTER TABLE qwen35_review_annotations
  ADD COLUMN IF NOT EXISTS pick1_class_id INTEGER REFERENCES octave_reference(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pick2_class_id INTEGER REFERENCES octave_reference(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pick3_class_id INTEGER REFERENCES octave_reference(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pick1_proposed_label       TEXT,
  ADD COLUMN IF NOT EXISTS pick1_proposed_description TEXT,
  ADD COLUMN IF NOT EXISTS pick2_proposed_label       TEXT,
  ADD COLUMN IF NOT EXISTS pick2_proposed_description TEXT,
  ADD COLUMN IF NOT EXISTS pick3_proposed_label       TEXT,
  ADD COLUMN IF NOT EXISTS pick3_proposed_description TEXT,
  ADD COLUMN IF NOT EXISTS model_top_matches          JSONB;

-- 2) verdict was NOT NULL CHECK (verdict IN ('approve','disapprove')).
--    Make it nullable so the new flow can omit it. Keep the CHECK so any
--    explicit value is still validated.
ALTER TABLE qwen35_review_annotations
  ALTER COLUMN verdict DROP NOT NULL;

-- 3) Indexes for the most common pick queries (which class shows up
--    where in the rank order, which proposed labels recur).
CREATE INDEX IF NOT EXISTS qwen35_review_annotations_pick1_idx
  ON qwen35_review_annotations (pick1_class_id);
CREATE INDEX IF NOT EXISTS qwen35_review_annotations_proposed_idx
  ON qwen35_review_annotations (pick1_proposed_label)
  WHERE pick1_proposed_label IS NOT NULL;

-- 4) NOTE: we deliberately keep the legacy columns (suggested_class_id,
--    proposed_class_label, proposed_class_description). Any rows
--    annotated under the old schema still hold their data there; the
--    app reads BOTH the new picks and the legacy fields when
--    rendering / aggregating until we explicitly drop them.

-- 5) Ask PostgREST to reload its schema cache so the new columns are
--    visible via /rest/v1/.
NOTIFY pgrst, 'reload schema';
