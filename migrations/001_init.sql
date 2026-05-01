-- vlm-cctv-batch review app — annotation schema
-- Lives in the same Supabase as Octave (10.5.255.107:54321), but in its
-- own table namespace (qwen35_review_*) so it never touches octave_*.
--
-- Goal: collect curated (frame × model_caption → correct event_class)
-- triples so we can later improve octave_reference. The suggested_class_id
-- FK into octave_reference makes promotion of proposed labels trivial.

CREATE TABLE IF NOT EXISTS qwen35_review_annotations (
  id            SERIAL PRIMARY KEY,
  frame         TEXT NOT NULL,                -- e.g. 'frame_00003.jpg'
  model         TEXT NOT NULL,                -- 'Qwen3.5-2B' / '-4B' / '-9B'
  -- The reviewer's verdict on whether the model's TOP-1 event_class match
  -- was actually correct for what's in the image.
  verdict       TEXT NOT NULL CHECK (verdict IN ('approve', 'disapprove')),
  comment       TEXT,
  -- If disapprove, which existing event_class would have been right?
  -- NULL = none of the existing classes fit (see proposed_class_label).
  suggested_class_id INTEGER
    REFERENCES octave_reference(id) ON DELETE SET NULL,
  -- If disapprove AND none of the existing 25 fit, the reviewer can
  -- propose a brand-new class label here. We aggregate these later to
  -- decide which deserve to become real octave_reference entries.
  proposed_class_label       TEXT,
  proposed_class_description TEXT,
  author        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One annotation per (frame, model) cell; updates are upserts.
  UNIQUE (frame, model)
);

CREATE INDEX IF NOT EXISTS qwen35_review_annotations_frame_idx
  ON qwen35_review_annotations (frame);
CREATE INDEX IF NOT EXISTS qwen35_review_annotations_class_idx
  ON qwen35_review_annotations (suggested_class_id);
CREATE INDEX IF NOT EXISTS qwen35_review_annotations_model_idx
  ON qwen35_review_annotations (model);

CREATE OR REPLACE FUNCTION qwen35_review_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS qwen35_review_annotations_touch
  ON qwen35_review_annotations;
CREATE TRIGGER qwen35_review_annotations_touch
  BEFORE UPDATE ON qwen35_review_annotations
  FOR EACH ROW EXECUTE FUNCTION qwen35_review_touch_updated_at();
