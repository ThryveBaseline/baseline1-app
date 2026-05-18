-- Carlos routing log enhancements (table already created 2026-05-17)
ALTER TABLE carlos_routing_log
  ADD COLUMN IF NOT EXISTS confidence_score float,
  ADD COLUMN IF NOT EXISTS needs_memory boolean,
  ADD COLUMN IF NOT EXISTS needs_web boolean,
  ADD COLUMN IF NOT EXISTS needs_execution boolean,
  ADD COLUMN IF NOT EXISTS emotional_tone text,
  ADD COLUMN IF NOT EXISTS urgency text,
  ADD COLUMN IF NOT EXISTS risk_level text,
  ADD COLUMN IF NOT EXISTS hop_count integer,
  ADD COLUMN IF NOT EXISTS models_used_array jsonb DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS layer_times jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS retrieval_sources jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS layer0_result text,
  ADD COLUMN IF NOT EXISTS user_rating smallint; -- 1 = thumbs up, -1 = thumbs down

-- Carlos session state — tracks active task context per user
CREATE TABLE IF NOT EXISTS carlos_session_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL DEFAULT 'primary',
  active_intent text,
  active_models text[],
  active_context text,
  hop_count integer DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_updated timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'active' -- active | completed | interrupted
);

CREATE INDEX IF NOT EXISTS carlos_session_state_user_status ON carlos_session_state(user_id, status);
