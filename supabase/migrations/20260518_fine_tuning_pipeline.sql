-- Section 3: Fine Tuning Pipeline
-- carlos_training_data table + shadow mode columns on carlos_routing_log

-- ── Shadow mode columns on routing log ────────────────────────────────────────
ALTER TABLE carlos_routing_log
  ADD COLUMN IF NOT EXISTS local_response text,
  ADD COLUMN IF NOT EXISTS cloud_response text,
  ADD COLUMN IF NOT EXISTS shadow_similarity_score float;

-- ── Training data table ────────────────────────────────────────────────────────
-- PII is stripped BEFORE any row is inserted. pii_stripped_at is NOT NULL —
-- insert will fail if the application layer skips the strip step.
CREATE TABLE IF NOT EXISTS carlos_training_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_hash text NOT NULL,
  safe_prompt_summary text NOT NULL,
  cloud_response text,
  local_response text,
  similarity_score float,
  task_category text NOT NULL,
  timestamp timestamptz NOT NULL DEFAULT now(),
  pii_stripped_at timestamptz NOT NULL, -- enforced NOT NULL: row cannot exist without strip proof
  approved_for_training boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS carlos_training_data_category ON carlos_training_data(task_category);
CREATE INDEX IF NOT EXISTS carlos_training_data_candidates
  ON carlos_training_data(approved_for_training, similarity_score)
  WHERE approved_for_training = false AND similarity_score < 0.85;
CREATE INDEX IF NOT EXISTS carlos_training_data_approved
  ON carlos_training_data(approved_for_training, timestamp)
  WHERE approved_for_training = true;

-- Prevent inserting rows with future pii_stripped_at (clock skew guard)
ALTER TABLE carlos_training_data
  ADD CONSTRAINT pii_strip_not_future
  CHECK (pii_stripped_at <= now() + interval '5 minutes');
