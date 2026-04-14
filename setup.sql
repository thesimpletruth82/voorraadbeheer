-- StockFest — Supabase Setup v2 (no RLS / no roles)
-- Safe to re-run: drops everything first.

-- ── Drop old tables ─────────────────────────────────────────
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

-- ── Profiles ─────────────────────────────────────────────────
CREATE TABLE profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT,
  name       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'name', ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ── Events ───────────────────────────────────────────────────
CREATE TABLE events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  date       DATE NOT NULL,
  status     TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup', 'active', 'closed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Locations ────────────────────────────────────────────────
CREATE TABLE locations (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id  UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  order_num INTEGER DEFAULT 0
);

-- ── SKUs (global) ────────────────────────────────────────────
CREATE TABLE skus (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  unit       TEXT NOT NULL DEFAULT 'stuks',
  order_num  INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Location ↔ SKU assignments ────────────────────────────────
CREATE TABLE location_skus (
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  sku_id      UUID NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  PRIMARY KEY (location_id, sku_id)
);

-- ── Stock counts (opening / closing) ─────────────────────────
CREATE TABLE stock_counts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  sku_id      UUID NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  quantity    NUMERIC NOT NULL DEFAULT 0,
  type        TEXT NOT NULL CHECK (type IN ('opening', 'closing')),
  counted_at  TIMESTAMPTZ DEFAULT NOW(),
  counted_by  UUID REFERENCES profiles(id)
);

-- ── Movements ────────────────────────────────────────────────
CREATE TABLE movements (
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

-- ── RLS: allow all operations for authenticated users ─────────
ALTER TABLE profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE skus         ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_skus ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE movements    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open" ON profiles     FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "open" ON events       FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "open" ON locations    FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "open" ON skus         FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "open" ON location_skus FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "open" ON stock_counts FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "open" ON movements    FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- ── Default SKUs ─────────────────────────────────────────────
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
