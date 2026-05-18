-- Section 2: Five-Tier Memory Management Architecture
-- verification_state, confidence_score, source_tracking on all memory tables
-- Five-tier storage: active → archived → compressed → verified → decayed

-- ── Shared enum ───────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE verification_state AS ENUM (
    'human_confirmed',
    'ai_inferred',
    'speculative',
    'outdated',
    'contradicted'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── ALTER existing memory tables ──────────────────────────────────────────────

-- philosophy_anchors
ALTER TABLE philosophy_anchors
  ADD COLUMN IF NOT EXISTS verification_state verification_state NOT NULL DEFAULT 'ai_inferred',
  ADD COLUMN IF NOT EXISTS confidence_score float NOT NULL DEFAULT 0.5 CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),
  ADD COLUMN IF NOT EXISTS source_tracking jsonb NOT NULL DEFAULT '{}';

-- stable_truths (already has confidence_score numeric — add verification_state + source_tracking)
ALTER TABLE stable_truths
  ADD COLUMN IF NOT EXISTS verification_state verification_state NOT NULL DEFAULT 'ai_inferred',
  ADD COLUMN IF NOT EXISTS source_tracking jsonb NOT NULL DEFAULT '{}';

-- decision_evolution
ALTER TABLE decision_evolution
  ADD COLUMN IF NOT EXISTS verification_state verification_state NOT NULL DEFAULT 'ai_inferred',
  ADD COLUMN IF NOT EXISTS confidence_score float NOT NULL DEFAULT 0.5 CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),
  ADD COLUMN IF NOT EXISTS source_tracking jsonb NOT NULL DEFAULT '{}';

-- historical_evolution
ALTER TABLE historical_evolution
  ADD COLUMN IF NOT EXISTS verification_state verification_state NOT NULL DEFAULT 'ai_inferred',
  ADD COLUMN IF NOT EXISTS confidence_score float NOT NULL DEFAULT 0.5 CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),
  ADD COLUMN IF NOT EXISTS source_tracking jsonb NOT NULL DEFAULT '{}';

-- unresolved_items
ALTER TABLE unresolved_items
  ADD COLUMN IF NOT EXISTS verification_state verification_state NOT NULL DEFAULT 'ai_inferred',
  ADD COLUMN IF NOT EXISTS confidence_score float NOT NULL DEFAULT 0.5 CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),
  ADD COLUMN IF NOT EXISTS source_tracking jsonb NOT NULL DEFAULT '{}';

-- ── Five-tier memory tables ───────────────────────────────────────────────────

-- Tier 1: active_memory — items accessed within 30 days, fast retrieval
CREATE TABLE IF NOT EXISTS active_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL DEFAULT 'primary',
  memory_type text NOT NULL, -- personal | family | business_thryve | business_estates | health | strategic | temporary
  category text,
  content text NOT NULL,
  summary text,
  verification_state verification_state NOT NULL DEFAULT 'ai_inferred',
  confidence_score float NOT NULL DEFAULT 0.5 CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),
  source_tracking jsonb NOT NULL DEFAULT '{}', -- {type, source_id, conversation_id, model, timestamp}
  last_accessed_at timestamptz NOT NULL DEFAULT now(),
  access_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_active_at timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);

CREATE INDEX IF NOT EXISTS active_memory_user_type ON active_memory(user_id, memory_type);
CREATE INDEX IF NOT EXISTS active_memory_last_accessed ON active_memory(last_accessed_at DESC);
CREATE INDEX IF NOT EXISTS active_memory_verification ON active_memory(verification_state);
CREATE INDEX IF NOT EXISTS active_memory_expires ON active_memory(expires_active_at);

-- Tier 2: archived_memory — older items, compressed summaries, slower retrieval
CREATE TABLE IF NOT EXISTS archived_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL DEFAULT 'primary',
  memory_type text NOT NULL,
  category text,
  content text NOT NULL,
  summary text,
  verification_state verification_state NOT NULL DEFAULT 'ai_inferred',
  confidence_score float NOT NULL DEFAULT 0.5 CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),
  source_tracking jsonb NOT NULL DEFAULT '{}',
  original_active_id uuid,
  archived_at timestamptz NOT NULL DEFAULT now(),
  archive_reason text, -- aged_out | manually_archived | superseded
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS archived_memory_user_type ON archived_memory(user_id, memory_type);
CREATE INDEX IF NOT EXISTS archived_memory_archived_at ON archived_memory(archived_at DESC);

-- Tier 3: compressed_memory — summarized batches of conversation sets
CREATE TABLE IF NOT EXISTS compressed_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL DEFAULT 'primary',
  memory_type text NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  summary text NOT NULL,
  key_insights text[],
  source_count integer NOT NULL DEFAULT 0,
  verification_state verification_state NOT NULL DEFAULT 'ai_inferred',
  confidence_score float NOT NULL DEFAULT 0.5 CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),
  source_tracking jsonb NOT NULL DEFAULT '{}',
  compressed_at timestamptz NOT NULL DEFAULT now(),
  compressed_by text -- model that generated this compression
);

CREATE INDEX IF NOT EXISTS compressed_memory_user_period ON compressed_memory(user_id, period_start DESC);

-- Tier 4: verified_memory — human_confirmed multiple times, highest confidence, fastest retrieval
CREATE TABLE IF NOT EXISTS verified_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL DEFAULT 'primary',
  memory_type text NOT NULL,
  category text,
  content text NOT NULL,
  summary text,
  verification_state verification_state NOT NULL DEFAULT 'human_confirmed',
  confidence_score float NOT NULL DEFAULT 0.9 CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),
  source_tracking jsonb NOT NULL DEFAULT '{}',
  confirmation_count integer NOT NULL DEFAULT 1,
  first_confirmed_at timestamptz NOT NULL DEFAULT now(),
  last_confirmed_at timestamptz NOT NULL DEFAULT now(),
  confirmed_by text NOT NULL DEFAULT 'primary',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS verified_memory_user_type ON verified_memory(user_id, memory_type);
CREATE INDEX IF NOT EXISTS verified_memory_last_confirmed ON verified_memory(last_confirmed_at DESC);
-- Partial index for fast retrieval of highest-confidence items
CREATE INDEX IF NOT EXISTS verified_memory_high_confidence ON verified_memory(confidence_score DESC) WHERE confidence_score >= 0.8;

-- Tier 5: decayed_memory — outdated flagged items awaiting Chris review or deletion
CREATE TABLE IF NOT EXISTS decayed_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL DEFAULT 'primary',
  memory_type text NOT NULL,
  category text,
  content text NOT NULL,
  original_content text, -- original before decay was detected
  verification_state verification_state NOT NULL DEFAULT 'outdated',
  confidence_score float NOT NULL DEFAULT 0.1 CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),
  source_tracking jsonb NOT NULL DEFAULT '{}',
  decay_reason text, -- contradicted | aged_out | superseded | flagged_by_ai
  decay_detected_at timestamptz NOT NULL DEFAULT now(),
  source_tier text, -- which tier this decayed from: active | archived | verified
  original_id uuid,
  review_requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  review_action text -- keep | delete | restore | update
);

CREATE INDEX IF NOT EXISTS decayed_memory_user ON decayed_memory(user_id);
CREATE INDEX IF NOT EXISTS decayed_memory_review_requested ON decayed_memory(review_requested_at DESC);
CREATE INDEX IF NOT EXISTS decayed_memory_unreviewed ON decayed_memory(review_requested_at) WHERE reviewed_at IS NULL;

-- ── Confidence enforcement ────────────────────────────────────────────────────
-- Prevent AI from elevating confidence above 0.8 without human confirmation

CREATE OR REPLACE FUNCTION enforce_confidence_ceiling()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.verification_state != 'human_confirmed' AND NEW.confidence_score > 0.8 THEN
    NEW.confidence_score := 0.8;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply ceiling trigger to all five tier tables
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['active_memory','archived_memory','compressed_memory','verified_memory','decayed_memory'] LOOP
    EXECUTE format('
      DROP TRIGGER IF EXISTS enforce_confidence_ceiling_%I ON %I;
      CREATE TRIGGER enforce_confidence_ceiling_%I
        BEFORE INSERT OR UPDATE ON %I
        FOR EACH ROW EXECUTE FUNCTION enforce_confidence_ceiling();
    ', t, t, t, t);
  END LOOP;
END $$;

-- Apply to existing memory tables too
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['philosophy_anchors','decision_evolution','historical_evolution','unresolved_items'] LOOP
    EXECUTE format('
      DROP TRIGGER IF EXISTS enforce_confidence_ceiling_%I ON %I;
      CREATE TRIGGER enforce_confidence_ceiling_%I
        BEFORE INSERT OR UPDATE ON %I
        FOR EACH ROW EXECUTE FUNCTION enforce_confidence_ceiling();
    ', t, t, t, t);
  END LOOP;
END $$;
