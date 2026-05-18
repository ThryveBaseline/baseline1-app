-- Section 5: Self Improvement Infrastructure
-- model_evaluations + system_performance_weekly tables

CREATE TABLE IF NOT EXISTS model_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name text NOT NULL,
  category text NOT NULL,
  quality_score float NOT NULL,
  vs_current_delta float, -- positive = better than current
  example_count integer NOT NULL DEFAULT 0,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  recommendation text NOT NULL DEFAULT 'pending', -- promote | skip | monitor
  promoted boolean NOT NULL DEFAULT false,
  promoted_at timestamptz,
  evaluation_notes text
);

CREATE INDEX IF NOT EXISTS model_evaluations_model ON model_evaluations(model_name, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS model_evaluations_category ON model_evaluations(category);

CREATE TABLE IF NOT EXISTS system_performance_weekly (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start date NOT NULL UNIQUE,
  thumbs_up_rate_by_category jsonb NOT NULL DEFAULT '{}',
  avg_response_ms_by_category jsonb NOT NULL DEFAULT '{}',
  cost_per_conversation_usd float,
  total_conversations integer NOT NULL DEFAULT 0,
  total_cost_usd float,
  monthly_cost_trajectory_usd float,
  alerts jsonb NOT NULL DEFAULT '[]', -- [{type, message, value, threshold}]
  recommendations jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS system_performance_weekly_week ON system_performance_weekly(week_start DESC);
