-- ════════════════════════════════════════════════════════════
-- StockFest — Auth & Roles
-- Run this AFTER setup.sql in the Supabase SQL Editor.
--
-- Roles:
--   • superuser  — full access to everything (first sign-up becomes superuser)
--   • admin      — full access to events they're assigned to
--   • runner     — sales-only access to events they're assigned to
--
-- Invite flow: superuser creates an invite (email + role [+ optional event]).
-- When a user signs up with that email, the trigger auto-applies the invite.
-- ════════════════════════════════════════════════════════════

-- ── Clean slate (safe to re-run) ───────────────────────────
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS current_platform_role() CASCADE;
DROP FUNCTION IF EXISTS is_superuser() CASCADE;
DROP FUNCTION IF EXISTS has_event_access(uuid) CASCADE;
DROP FUNCTION IF EXISTS accept_invite(text) CASCADE;

DROP TABLE IF EXISTS invites           CASCADE;
DROP TABLE IF EXISTS event_assignments CASCADE;
DROP TABLE IF EXISTS profiles          CASCADE;

-- Drop old "open_*" policies from setup.sql
DROP POLICY IF EXISTS "open_events"       ON events;
DROP POLICY IF EXISTS "open_locations"    ON locations;
DROP POLICY IF EXISTS "open_skus"         ON skus;
DROP POLICY IF EXISTS "open_stock_counts" ON stock_counts;
DROP POLICY IF EXISTS "open_movements"    ON movements;

-- ── Profiles (1 per auth.users) ────────────────────────────
CREATE TABLE profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  full_name     TEXT,
  platform_role TEXT NOT NULL DEFAULT 'runner'
                CHECK (platform_role IN ('superuser', 'admin', 'runner')),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Event Assignments ──────────────────────────────────────
CREATE TABLE event_assignments (
  event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (event_id, user_id)
);

-- ── Invites ────────────────────────────────────────────────
CREATE TABLE invites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL,
  platform_role TEXT NOT NULL CHECK (platform_role IN ('admin', 'runner')),
  event_id      UUID REFERENCES events(id) ON DELETE CASCADE,
  token         TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  invited_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  accepted_at   TIMESTAMPTZ
);

CREATE INDEX ON invites(email);
CREATE INDEX ON invites(token);
CREATE INDEX ON event_assignments(user_id);

-- ════════════════════════════════════════════════════════════
-- Helper functions (SECURITY DEFINER — bypass RLS for lookups)
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION current_platform_role()
RETURNS TEXT
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT platform_role FROM profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION is_superuser()
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT platform_role = 'superuser' FROM profiles WHERE id = auth.uid()),
    FALSE
  );
$$;

CREATE OR REPLACE FUNCTION has_event_access(_event_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    is_superuser()
    OR EXISTS (
      SELECT 1 FROM event_assignments
      WHERE event_id = _event_id AND user_id = auth.uid()
    );
$$;

-- ════════════════════════════════════════════════════════════
-- Signup trigger: bootstrap superuser + auto-apply invites
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _role   TEXT := 'runner';
  _invite invites%ROWTYPE;
BEGIN
  -- First user ever → superuser
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE platform_role = 'superuser') THEN
    _role := 'superuser';
  ELSE
    -- Match open invite by email (case-insensitive)
    SELECT * INTO _invite FROM invites
      WHERE LOWER(email) = LOWER(NEW.email)
        AND accepted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1;

    IF FOUND THEN
      _role := _invite.platform_role;
    END IF;
  END IF;

  INSERT INTO profiles (id, email, platform_role)
  VALUES (NEW.id, NEW.email, _role);

  -- Apply event assignment from invite, if any
  IF _invite.id IS NOT NULL THEN
    IF _invite.event_id IS NOT NULL THEN
      INSERT INTO event_assignments (event_id, user_id)
      VALUES (_invite.event_id, NEW.id)
      ON CONFLICT DO NOTHING;
    END IF;
    UPDATE invites SET accepted_at = NOW() WHERE id = _invite.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ════════════════════════════════════════════════════════════
-- RLS Policies
-- ════════════════════════════════════════════════════════════

ALTER TABLE profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites           ENABLE ROW LEVEL SECURITY;

-- ── profiles ───────────────────────────────────────────────
-- Everyone can read their own; superusers read/update all
CREATE POLICY "profiles_self_read" ON profiles
  FOR SELECT USING (id = auth.uid() OR is_superuser());

CREATE POLICY "profiles_superuser_update" ON profiles
  FOR UPDATE USING (is_superuser());

CREATE POLICY "profiles_superuser_delete" ON profiles
  FOR DELETE USING (is_superuser());

-- (No INSERT policy — only the trigger inserts, as SECURITY DEFINER)

-- ── event_assignments ──────────────────────────────────────
CREATE POLICY "assignments_self_read" ON event_assignments
  FOR SELECT USING (user_id = auth.uid() OR is_superuser());

CREATE POLICY "assignments_superuser_all" ON event_assignments
  FOR ALL USING (is_superuser()) WITH CHECK (is_superuser());

-- ── invites (superuser-only) ───────────────────────────────
CREATE POLICY "invites_superuser_all" ON invites
  FOR ALL USING (is_superuser()) WITH CHECK (is_superuser());

-- ── events ─────────────────────────────────────────────────
-- Read: superuser sees all, others see events they're assigned to
CREATE POLICY "events_read" ON events
  FOR SELECT USING (
    is_superuser()
    OR EXISTS (
      SELECT 1 FROM event_assignments
      WHERE event_id = events.id AND user_id = auth.uid()
    )
  );

-- Insert/Delete: superuser only
CREATE POLICY "events_superuser_insert" ON events
  FOR INSERT WITH CHECK (is_superuser());

CREATE POLICY "events_superuser_delete" ON events
  FOR DELETE USING (is_superuser());

-- Update: superuser, or assigned admin
CREATE POLICY "events_update" ON events
  FOR UPDATE USING (
    is_superuser()
    OR (current_platform_role() = 'admin' AND has_event_access(events.id))
  );

-- ── locations ──────────────────────────────────────────────
CREATE POLICY "locations_read" ON locations
  FOR SELECT USING (has_event_access(event_id));

CREATE POLICY "locations_admin_write" ON locations
  FOR ALL USING (
    is_superuser()
    OR (current_platform_role() = 'admin' AND has_event_access(event_id))
  ) WITH CHECK (
    is_superuser()
    OR (current_platform_role() = 'admin' AND has_event_access(event_id))
  );

-- ── skus (global catalog) ──────────────────────────────────
-- Any authenticated user with at least one event assignment can read
CREATE POLICY "skus_read" ON skus
  FOR SELECT USING (
    auth.uid() IS NOT NULL
    AND (
      is_superuser()
      OR EXISTS (SELECT 1 FROM event_assignments WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "skus_admin_write" ON skus
  FOR ALL USING (
    current_platform_role() IN ('superuser', 'admin')
  ) WITH CHECK (
    current_platform_role() IN ('superuser', 'admin')
  );

-- ── stock_counts ───────────────────────────────────────────
CREATE POLICY "counts_read" ON stock_counts
  FOR SELECT USING (has_event_access(event_id));

CREATE POLICY "counts_admin_write" ON stock_counts
  FOR ALL USING (
    is_superuser()
    OR (current_platform_role() = 'admin' AND has_event_access(event_id))
  ) WITH CHECK (
    is_superuser()
    OR (current_platform_role() = 'admin' AND has_event_access(event_id))
  );

-- ── movements ──────────────────────────────────────────────
CREATE POLICY "movements_read" ON movements
  FOR SELECT USING (has_event_access(event_id));

CREATE POLICY "movements_admin_all" ON movements
  FOR ALL USING (
    is_superuser()
    OR (current_platform_role() = 'admin' AND has_event_access(event_id))
  ) WITH CHECK (
    is_superuser()
    OR (current_platform_role() = 'admin' AND has_event_access(event_id))
  );

-- Runners: can INSERT sale-type movements only, on their assigned events
CREATE POLICY "movements_runner_sales" ON movements
  FOR INSERT WITH CHECK (
    current_platform_role() = 'runner'
    AND type = 'sale'
    AND has_event_access(event_id)
  );
