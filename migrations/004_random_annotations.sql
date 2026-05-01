-- Migration: separate "random" annotation table for crowdsourced
-- text-only review by external participants.
--
-- Why a third separate table (vs reusing qwen35_review_blind_annotations):
--
--   * No UNIQUE (frame, model) constraint here — random mode is
--     INTENTIONALLY multi-opinion. Many external reviewers will hit the
--     same cell; we want all their picks captured so we can later
--     measure inter-rater agreement, average across reviewers, etc.
--
--   * Different access pattern: anonymous external users via the public
--     tunnel. Auditing / abuse handling will live closer to this table
--     than to the curated internal ones.
--
--   * Curated (image / blind) annotations and crowdsourced random
--     annotations are different epistemic objects. We want to be able
--     to compare them, not blend them.

CREATE TABLE IF NOT EXISTS qwen35_review_random_annotations (
  id            SERIAL PRIMARY KEY,
  frame         TEXT NOT NULL,
  model         TEXT NOT NULL,
  -- Same ranked-top-3 shape as the other tables so we can compare like for like.
  pick1_class_id INTEGER REFERENCES octave_reference(id) ON DELETE SET NULL,
  pick2_class_id INTEGER REFERENCES octave_reference(id) ON DELETE SET NULL,
  pick3_class_id INTEGER REFERENCES octave_reference(id) ON DELETE SET NULL,
  pick1_proposed_label       TEXT,
  pick1_proposed_description TEXT,
  pick2_proposed_label       TEXT,
  pick2_proposed_description TEXT,
  pick3_proposed_label       TEXT,
  pick3_proposed_description TEXT,
  -- Snapshot the model cosines as shown to this particular reviewer,
  -- in case we tweak the bench rerun later.
  model_top_matches JSONB,
  comment       TEXT,
  -- Free-text — reviewers in random mode are typically external/anonymous.
  -- May contain a name, an email, a session id, or 'anon'.
  author        TEXT,
  -- Lightweight provenance: which IP / UA hit us. Keep small + truncated
  -- so we have something to point at if abuse shows up.
  source_ip     TEXT,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hot-path indexes:
--   * (frame, model) — for "how many times has this cell been reviewed?"
--     used by the weighted random selector below.
--   * created_at — recency dashboards / abuse-detection.
CREATE INDEX IF NOT EXISTS qwen35_review_random_frame_model_idx
  ON qwen35_review_random_annotations (frame, model);
CREATE INDEX IF NOT EXISTS qwen35_review_random_created_at_idx
  ON qwen35_review_random_annotations (created_at DESC);
CREATE INDEX IF NOT EXISTS qwen35_review_random_author_idx
  ON qwen35_review_random_annotations (author);

NOTIFY pgrst, 'reload schema';
