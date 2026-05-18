-- Carlos Constitution version tracking and enforcement

-- Stores the active constitution content (source of truth in DB)
CREATE TABLE IF NOT EXISTS carlos_constitution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE,
  content text NOT NULL,
  content_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  created_by text DEFAULT 'system'
);

-- Only one version active at a time
CREATE UNIQUE INDEX IF NOT EXISTS carlos_constitution_active_idx
  ON carlos_constitution(is_active) WHERE is_active = true;

-- Logs which constitution version was loaded per session
CREATE TABLE IF NOT EXISTS carlos_constitution_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text,
  version text NOT NULL,
  content_hash text,
  loaded_at timestamptz NOT NULL DEFAULT now(),
  user_id text DEFAULT 'primary',
  load_result text NOT NULL DEFAULT 'ok' -- ok | missing | corrupted | fallback
);

CREATE INDEX IF NOT EXISTS carlos_constitution_version_loaded_at
  ON carlos_constitution_version(loaded_at DESC);
