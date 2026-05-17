Review all Supabase migrations, RLS policies, and service-role usage for correctness and security.

## 1. Migration file audit
- Find all `.sql` migration files (typically in `supabase/migrations/` or `database/`)
- For each migration, check:
  - Syntax is valid PostgreSQL
  - No `DROP TABLE` without a paired `IF EXISTS`
  - No irreversible data deletions without a comment explaining why
  - Foreign key constraints are explicitly named
  - Indexes are created for all foreign key columns
  - `created_at` and `updated_at` columns use `DEFAULT now()`
  - UUIDs use `gen_random_uuid()` not `uuid_generate_v4()` (requires extension)

## 2. RLS policies
For each table, verify:
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` is present
- At least one SELECT policy exists (or a deliberate `TO authenticated` policy covers all operations)
- No policies that use `WITH CHECK (true)` or `USING (true)` without a comment explaining why public access is intentional
- Service-role operations are documented — the service role bypasses RLS, so any function using `SUPABASE_SERVICE_ROLE_KEY` has unrestricted write access
- `auth.uid()` is used in user-scoped policies, not a hardcoded ID

## 3. Service-role usage scan
- Search all backend code for uses of `SUPABASE_SERVICE_ROLE_KEY` / `serviceRoleKey`
- For each usage, verify:
  - It is in a server-side file only (never in frontend JS, never in browser code)
  - The operation it performs is documented
  - It is not exposed via a public endpoint without auth check

## 4. Column-level security
- Check for sensitive columns (email, phone, PII, health data, payment data)
- Verify these columns are not returned in SELECT * by any anon-accessible query
- Suggest column-level security or view-based abstraction where appropriate

## 5. Edge cases
- Check for `SECURITY DEFINER` functions — these run as the function owner, bypassing RLS
- Check for `GRANT` statements that give overly broad permissions to `anon` or `authenticated` roles
- Verify `realtime` publication only includes tables that need real-time (not all tables)

## 6. Report format
```
## Supabase RLS + Migration Check — [Date]

### Critical (security risk)
- Table `foo` has RLS enabled but no policies — all rows inaccessible

### Warnings
- Migration 003 drops column without backup step

### Service-role audit
- carlos-chat.js:45 — reads daily_health_context (server-only ✅)
- index.html:1234 — FAIL: service key present in frontend code ❌

### Passed
- ✅ All tables have RLS enabled
- ✅ service role key only in server-side functions
```
