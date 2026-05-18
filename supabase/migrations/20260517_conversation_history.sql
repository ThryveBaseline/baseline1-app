-- Carlos conversation history — stores ElevenLabs post-call data
CREATE TABLE IF NOT EXISTS conversation_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         text NOT NULL DEFAULT 'primary',
  conversation_id text NOT NULL UNIQUE,
  agent_id        text,
  summary         text,
  duration_seconds integer,
  transcript      jsonb,
  status          text DEFAULT 'completed',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversation_history_user_id_idx ON conversation_history(user_id);
CREATE INDEX IF NOT EXISTS conversation_history_created_at_idx ON conversation_history(created_at DESC);

-- Row level security: service role only (this table is server-side only)
ALTER TABLE conversation_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON conversation_history
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
