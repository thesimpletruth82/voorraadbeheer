-- StockFest — Supabase Setup v2
-- Run this entire file in the Supabase SQL Editor
-- Safe to re-run: drops old tables first so schema is always clean.

-- ── Drop old tables (previous build used different schema) ──
DROP TABLE IF EXISTS stock_entries  CASCADE;
DROP TABLE IF EXISTS bar_skus       CASCADE;
DROP TABLE IF EXISTS bars           CASCADE;
DROP TABLE IF EXISTS skus           CASCADE;
DROP TABLE IF EXISTS location_skus  CASCADE;
DROP TABLE IF EXISTS stock_counts   CASCADE;
DROP TABLE IF EXISTS movements      CASCADE;
DROP TABLE IF EXISTS locations      CASCADE;
DROP TABLE IF EXISTS events         CASCADE;
DROP TABLE IF EXISTS profiles       CASCADE;

-- ── Profiles (extends Supabase auth.users) ─────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  name  TEXT NOT NULL DEFAULT '',
  role  TEXT NOT NULL DEFAULT 'runner' CHECK (role IN ('admin', 'runner')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile on user signup
-- SET search_path = public is required by Supabase for SECURITY DEFINER functions
-- so the function can resolve public.profiles at runtime.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', ''),
    'runner'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ── Events ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name   TEXT NOT NULL,
  date   DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup', 'active', 'closed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Locations ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS locations (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  order_num INTEGER DEFAULT 0
);

-- ── SKUs (global product catalogue) ───────────────────────
CREATE TABLE IF NOT EXISTS skus (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name  TEXT NOT NULL,
  unit  TEXT NOT NULL DEFAULT 'stuks',
  order_num INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Location ↔ SKU assignments ─────────────────────────────
CREATE TABLE IF NOT EXISTS location_skus (
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  sku_id      UUID NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  PRIMARY KEY (location_id, sku_id)
);

-- ── Stock Counts (opening / closing) ──────────────────────
CREATE TABLE IF NOT EXISTS stock_counts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  sku_id      UUID NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  quantity    NUMERIC NOT NULL DEFAULT 0,
  type        TEXT NOT NULL CHECK (type IN ('opening', 'closing')),
  counted_at  TIMESTAMPTZ DEFAULT NOW(),
  counted_by  UUID REFERENCES profiles(id)
);

-- ── Movements (transfers & deliveries) ────────────────────
CREATE TABLE IF NOT EXISTS movements (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  from_location_id UUID REFERENCES locations(id),
  to_location_id   UUID REFERENCES locations(id),
  sku_id           UUID NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  quantity         NUMERIC NOT NULL CHECK (quantity > 0),
  type             TEXT NOT NULL CHECK (type IN ('transfer', 'delivery')),
  moved_at         TIMESTAMPTZ DEFAULT NOW(),
  runner_id        UUID REFERENCES profiles(id),
  notes            TEXT
);

-- ── Enable RLS ─────────────────────────────────────────────
ALTER TABLE profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE skus         ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_skus ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE movements    ENABLE ROW LEVEL SECURITY;

-- ── Role helper ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS TEXT LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$;

-- ── Policies ───────────────────────────────────────────────
-- Profiles
DROP POLICY IF EXISTS "p_sel"  ON profiles;
DROP POLICY IF EXISTS "p_ins"  ON profiles;
DROP POLICY IF EXISTS "p_upd"  ON profiles;
CREATE POLICY "p_sel" ON profiles FOR SELECT USING (id = auth.uid() OR get_my_role() = 'admin');
-- WITH CHECK (true): auth.uid() is NULL when the signup trigger fires,
-- so we can't use id = auth.uid() here. The REFERENCES auth.users(id) FK
-- already ensures only real users can have a profile.
CREATE POLICY "p_ins" ON profiles FOR INSERT WITH CHECK (true);
CREATE POLICY "p_upd" ON profiles FOR UPDATE USING (get_my_role() = 'admin');

-- Events (all authenticated can read; only admin can write)
DROP POLICY IF EXISTS "ev_sel" ON events;
DROP POLICY IF EXISTS "ev_ins" ON events;
DROP POLICY IF EXISTS "ev_upd" ON events;
DROP POLICY IF EXISTS "ev_del" ON events;
CREATE POLICY "ev_sel" ON events FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "ev_ins" ON events FOR INSERT WITH CHECK (get_my_role() = 'admin');
CREATE POLICY "ev_upd" ON events FOR UPDATE USING (get_my_role() = 'admin');
CREATE POLICY "ev_del" ON events FOR DELETE USING (get_my_role() = 'admin');

-- Locations
DROP POLICY IF EXISTS "loc_sel" ON locations;
DROP POLICY IF EXISTS "loc_ins" ON locations;
DROP POLICY IF EXISTS "loc_upd" ON locations;
DROP POLICY IF EXISTS "loc_del" ON locations;
CREATE POLICY "loc_sel" ON locations FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "loc_ins" ON locations FOR INSERT WITH CHECK (get_my_role() = 'admin');
CREATE POLICY "loc_upd" ON locations FOR UPDATE USING (get_my_role() = 'admin');
CREATE POLICY "loc_del" ON locations FOR DELETE USING (get_my_role() = 'admin');

-- SKUs
DROP POLICY IF EXISTS "sku_sel" ON skus;
DROP POLICY IF EXISTS "sku_ins" ON skus;
DROP POLICY IF EXISTS "sku_upd" ON skus;
DROP POLICY IF EXISTS "sku_del" ON skus;
CREATE POLICY "sku_sel" ON skus FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "sku_ins" ON skus FOR INSERT WITH CHECK (get_my_role() = 'admin');
CREATE POLICY "sku_upd" ON skus FOR UPDATE USING (get_my_role() = 'admin');
CREATE POLICY "sku_del" ON skus FOR DELETE USING (get_my_role() = 'admin');

-- Location SKUs
DROP POLICY IF EXISTS "ls_sel" ON location_skus;
DROP POLICY IF EXISTS "ls_ins" ON location_skus;
DROP POLICY IF EXISTS "ls_del" ON location_skus;
CREATE POLICY "ls_sel" ON location_skus FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "ls_ins" ON location_skus FOR INSERT WITH CHECK (get_my_role() = 'admin');
CREATE POLICY "ls_del" ON location_skus FOR DELETE USING (get_my_role() = 'admin');

-- Stock counts (admin only)
DROP POLICY IF EXISTS "sc_sel" ON stock_counts;
DROP POLICY IF EXISTS "sc_ins" ON stock_counts;
DROP POLICY IF EXISTS "sc_upd" ON stock_counts;
DROP POLICY IF EXISTS "sc_del" ON stock_counts;
CREATE POLICY "sc_sel" ON stock_counts FOR SELECT USING (get_my_role() = 'admin');
CREATE POLICY "sc_ins" ON stock_counts FOR INSERT WITH CHECK (get_my_role() = 'admin');
CREATE POLICY "sc_upd" ON stock_counts FOR UPDATE USING (get_my_role() = 'admin');
CREATE POLICY "sc_del" ON stock_counts FOR DELETE USING (get_my_role() = 'admin');

-- Movements (runners insert + read own; admins read all)
DROP POLICY IF EXISTS "mv_sel_admin"  ON movements;
DROP POLICY IF EXISTS "mv_sel_runner" ON movements;
DROP POLICY IF EXISTS "mv_ins"        ON movements;
CREATE POLICY "mv_sel_admin"  ON movements FOR SELECT USING (get_my_role() = 'admin');
CREATE POLICY "mv_sel_runner" ON movements FOR SELECT USING (runner_id = auth.uid());
CREATE POLICY "mv_ins"        ON movements FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ── Default SKUs ───────────────────────────────────────────
INSERT INTO skus (name, unit, order_num) VALUES
  ('Coca Cola Regular',   'stuks', 0),
  ('Coca Cola Light',     'stuks', 1),
  ('Coca Cola Zero',      'stuks', 2),
  ('Fanta',               'stuks', 3),
  ('Sprite',              'stuks', 4),
  ('Chaudfontaine 0.33L', 'stuks', 5),
  ('Chaudfontaine 1.5L',  'stuks', 6),
  ('Red Bull',            'stuks', 7),
  ('Red Bull Zero',       'stuks', 8),
  ('Witte Wijn',          'stuks', 9),
  ('Rosé',                'stuks', 10),
  ('Bacardi Cola',        'stuks', 11),
  ('Bacardi Razz & Up',   'stuks', 12),
  ('Hoegaarden Rosé',     'stuks', 13),
  ('Jupiler Blik',        'stuks', 14),
  ('Jupiler Fust 50L',    'fust',  15),
  ('Bierbekers',          'stuks', 16),
  ('Colabekers',          'stuks', 17),
  ('Wijnbekers',          'stuks', 18),
  ('Draagtrays',          'stuks', 19)
ON CONFLICT DO NOTHING;
