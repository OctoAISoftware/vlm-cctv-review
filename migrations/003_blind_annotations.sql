-- Migration: separate "blind" annotation table for text-only evaluation.
--
-- Same shape as qwen35_review_annotations (post-migration 002), but
-- physically separate so the two evaluation modes never contaminate
-- each other's data. The split lets us measure the DELTA between
-- "judging with the image" and "judging from the caption alone":
--
--   * with-image annotations   → judges the WHOLE pipeline
--                                 (VLM caption quality + embedder + library)
--   * blind annotations        → judges JUST the embedder + library
--                                 (decoupled from caption accuracy)
--
-- The delta isolates the bottleneck:
--   * captions wrong but blind picks right → VLM is the problem
--   * captions right but blind picks wrong → embedder/library is the problem
--
-- Two-table design (vs. single table with a 'mode' column) chosen for:
--   - cleaner aggregation queries (no WHERE mode='...' on every read)
--   - independent evolution (blind table could grow per-mode-only fields)
--   - safer access patterns (no risk of accidentally writing to wrong mode)

CREATE TABLE IF NOT EXISTS qwen35_review_blind_annotations (
  id            SERIAL PRIMARY KEY,
  frame         TEXT NOT NULL,
  model         TEXT NOT NULL,
  -- Optional/derived. Same convention as the image-aware table after mig 002.
  verdict       TEXT CHECK (verdict IN ('approve', 'disapprove')),
  comment       TEXT,
  -- Ranked top-3 of correct event_classes (rank 1 expected, 2/3 optional).
  pick1_class_id INTEGER REFERENCES octave_reference(id) ON DELETE SET NULL,
  pick2_class_id INTEGER REFERENCES octave_reference(id) ON DELETE SET NULL,
  pick3_class_id INTEGER REFERENCES octave_reference(id) ON DELETE SET NULL,
  -- New-class proposal slots (one per rank position).
  pick1_proposed_label       TEXT,
  pick1_proposed_description TEXT,
  pick2_proposed_label       TEXT,
  pick2_proposed_description TEXT,
  pick3_proposed_label       TEXT,
  pick3_proposed_description TEXT,
  -- Snapshot of the model's cosine top-3 at annotation time. Stored
  -- here too so the future risk-engine calibration query can compare
  -- "model said X with cosine Y" to "human said Z" in one SQL.
  model_top_matches JSONB,
  author        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (frame, model)
);

CREATE INDEX IF NOT EXISTS qwen35_review_blind_annotations_frame_idx
  ON qwen35_review_blind_annotations (frame);
CREATE INDEX IF NOT EXISTS qwen35_review_blind_annotations_model_idx
  ON qwen35_review_blind_annotations (model);
CREATE INDEX IF NOT EXISTS qwen35_review_blind_annotations_pick1_idx
  ON qwen35_review_blind_annotations (pick1_class_id);
CREATE INDEX IF NOT EXISTS qwen35_review_blind_annotations_proposed_idx
  ON qwen35_review_blind_annotations (pick1_proposed_label)
  WHERE pick1_proposed_label IS NOT NULL;

DROP TRIGGER IF EXISTS qwen35_review_blind_annotations_touch
  ON qwen35_review_blind_annotations;
CREATE TRIGGER qwen35_review_blind_annotations_touch
  BEFORE UPDATE ON qwen35_review_blind_annotations
  FOR EACH ROW EXECUTE FUNCTION qwen35_review_touch_updated_at();

NOTIFY pgrst, 'reload schema';
