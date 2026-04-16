-- ════════════════════════════════════════════════════════════
-- StockFest — Clean-build schema (app + auth + RLS)
--
-- Run this in the Supabase SQL Editor. Safe to re-run — it
-- drops and recreates everything from scratch.
--
-- ── Before running, ALSO clear auth users ──────────────────
-- This SQL only resets app tables. If you had previous sign-ups,
-- clear them in the Supabase dashboard:
--   Authentication → Users → select all → Delete
-- Otherwise existing auth.users without matching profiles will
-- be in a broken state.
-- ════════════════════════════════════════════════════════════


-- ─── 1. DROP EVERYTHING ─────────────────────────────────────
DROP TRIGGER  IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS current_platform_role() CASCADE;
DROP FUNCTION IF EXISTS is_superuser() CASCADE;
DROP FUNCTION IF EXISTS has_event_access(uuid) CASCADE;

DROP TABLE IF EXISTS invites           CASCADE;
DROP TABLE IF EXISTS event_assignments CASCADE;
DROP TABLE IF EXISTS profiles          CASCADE;
DROP TABLE IF EXISTS stock_counts      CASCADE;
DROP TABLE IF EXISTS movements         CASCADE;
DROP TABLE IF EXISTS locations         CASCADE;
DROP TABLE IF EXISTS skus              CASCADE;
DROP TABLE IF EXISTS events            CASCADE;

-- Legacy table names from earlier iterations
DROP TABLE IF EXISTS location_skus  CASCADE;
DROP TABLE IF EXISTS stock_entries  CASCADE;
DROP TABLE IF EXISTS bar_skus       CASCADE;
DROP TABLE IF EXISTS bars           CASCADE;


-- ─── 2. APP TABLES ──────────────────────────────────────────

-- Events -----------------------------------------------------
CREATE TABLE events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  date        DATE NOT NULL,
  start_time  TIME,
  end_time    TIME,
  latitude    NUMERIC,
  longitude   NUMERIC,
  temperature NUMERIC,
  weather     TEXT CHECK (weather IS NULL OR weather IN ('rain', 'cloudy', 'cloudy_sunny', 'sunny')),
  crowd       TEXT CHECK (crowd IS NULL OR crowd IN ('not_busy', 'relatively_busy', 'busy', 'very_busy')),
  status      TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup', 'active', 'closed')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Locations --------------------------------------------------
CREATE TABLE locations (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name     TEXT NOT NULL
);

-- SKUs (global product catalog) ------------------------------
CREATE TABLE skus (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  unit       TEXT NOT NULL DEFAULT 'pcs',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Stock counts (opening / closing) ---------------------------
CREATE TABLE stock_counts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  sku_id      UUID NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  quantity    NUMERIC NOT NULL DEFAULT 0,
  type        TEXT NOT NULL CHECK (type IN ('opening', 'closing')),
  counted_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Movements (transfers / deliveries / sales) -----------------
CREATE TABLE movements (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  from_location_id UUID REFERENCES locations(id),
  to_location_id   UUID REFERENCES locations(id),
  sku_id           UUID NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  quantity         NUMERIC NOT NULL CHECK (quantity > 0),
  type             TEXT NOT NULL CHECK (type IN ('transfer', 'delivery', 'sale')),
  moved_at         TIMESTAMPTZ DEFAULT NOW(),
  notes            TEXT
);


-- ─── 3. AUTH TABLES ─────────────────────────────────────────

-- Profiles (1 per auth.users) --------------------------------
CREATE TABLE profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  full_name     TEXT,
  platform_role TEXT NOT NULL DEFAULT 'runner'
                CHECK (platform_role IN ('superuser', 'admin', 'runner')),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Which users have access to which event ---------------------
CREATE TABLE event_assignments (
  event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (event_id, user_id)
);

-- Pending invites --------------------------------------------
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


-- ─── 4. HELPER FUNCTIONS ────────────────────────────────────
-- SECURITY DEFINER so they bypass RLS when checking the
-- current user's role (otherwise profiles-read RLS would
-- recurse into itself and nothing would resolve).

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


-- ─── 5. SIGNUP TRIGGER ──────────────────────────────────────
-- When a new user signs up via Supabase Auth:
--   • If no superuser exists yet → they become the superuser
--   • Otherwise → match pending invite by email and apply role
--                 (no invite = runner with no event access)

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _role   TEXT := 'runner';
  _invite invites%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE platform_role = 'superuser') THEN
    _role := 'superuser';
  ELSE
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


-- ─── 6. ROW-LEVEL SECURITY ──────────────────────────────────

ALTER TABLE events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE skus              ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_counts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE movements         ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites           ENABLE ROW LEVEL SECURITY;

-- profiles ---------------------------------------------------
CREATE POLICY "profiles_self_read"        ON profiles FOR SELECT USING (id = auth.uid() OR is_superuser());
CREATE POLICY "profiles_superuser_update" ON profiles FOR UPDATE USING (is_superuser());
CREATE POLICY "profiles_superuser_delete" ON profiles FOR DELETE USING (is_superuser());
-- No INSERT policy — only the signup trigger inserts (SECURITY DEFINER)

-- event_assignments ------------------------------------------
CREATE POLICY "assignments_self_read"     ON event_assignments FOR SELECT USING (user_id = auth.uid() OR is_superuser());
CREATE POLICY "assignments_superuser_all" ON event_assignments FOR ALL    USING (is_superuser()) WITH CHECK (is_superuser());

-- invites ----------------------------------------------------
CREATE POLICY "invites_superuser_all" ON invites FOR ALL USING (is_superuser()) WITH CHECK (is_superuser());

-- events -----------------------------------------------------
-- Read: superuser sees all; others see events they're assigned to
CREATE POLICY "events_read" ON events FOR SELECT USING (
  is_superuser()
  OR EXISTS (SELECT 1 FROM event_assignments WHERE event_id = events.id AND user_id = auth.uid())
);
-- Create/delete: superuser only
CREATE POLICY "events_superuser_insert" ON events FOR INSERT WITH CHECK (is_superuser());
CREATE POLICY "events_superuser_delete" ON events FOR DELETE USING (is_superuser());
-- Update: superuser, or assigned admin
CREATE POLICY "events_update" ON events FOR UPDATE USING (
  is_superuser()
  OR (current_platform_role() = 'admin' AND has_event_access(events.id))
);

-- locations --------------------------------------------------
CREATE POLICY "locations_read" ON locations FOR SELECT USING (has_event_access(event_id));
CREATE POLICY "locations_admin_write" ON locations FOR ALL USING (
  is_superuser() OR (current_platform_role() = 'admin' AND has_event_access(event_id))
) WITH CHECK (
  is_superuser() OR (current_platform_role() = 'admin' AND has_event_access(event_id))
);

-- skus (global catalog) --------------------------------------
-- Any authenticated user with at least one event assignment can read
CREATE POLICY "skus_read" ON skus FOR SELECT USING (
  auth.uid() IS NOT NULL
  AND (is_superuser() OR EXISTS (SELECT 1 FROM event_assignments WHERE user_id = auth.uid()))
);
CREATE POLICY "skus_admin_write" ON skus FOR ALL USING (
  current_platform_role() IN ('superuser', 'admin')
) WITH CHECK (
  current_platform_role() IN ('superuser', 'admin')
);

-- stock_counts -----------------------------------------------
CREATE POLICY "counts_read" ON stock_counts FOR SELECT USING (has_event_access(event_id));
CREATE POLICY "counts_admin_write" ON stock_counts FOR ALL USING (
  is_superuser() OR (current_platform_role() = 'admin' AND has_event_access(event_id))
) WITH CHECK (
  is_superuser() OR (current_platform_role() = 'admin' AND has_event_access(event_id))
);

-- movements --------------------------------------------------
CREATE POLICY "movements_read" ON movements FOR SELECT USING (has_event_access(event_id));
-- Admin: all operations on their events
CREATE POLICY "movements_admin_all" ON movements FOR ALL USING (
  is_superuser() OR (current_platform_role() = 'admin' AND has_event_access(event_id))
) WITH CHECK (
  is_superuser() OR (current_platform_role() = 'admin' AND has_event_access(event_id))
);
-- Runner: can only insert sale-type movements on their events
CREATE POLICY "movements_runner_sales" ON movements FOR INSERT WITH CHECK (
  current_platform_role() = 'runner'
  AND type = 'sale'
  AND has_event_access(event_id)
);


-- ─── 7. REALTIME ────────────────────────────────────────────
-- Tables that push live updates to subscribed clients.
-- Wrapped in DO blocks so re-runs don't error when already added.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE movements;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE stock_counts;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
