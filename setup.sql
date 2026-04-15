-- StockFest — Supabase Schema (no auth, open access)
-- Run this in the Supabase SQL Editor.

-- ── Drop existing tables ────────────────────────────────────
DROP TABLE IF EXISTS stock_counts   CASCADE;
DROP TABLE IF EXISTS movements      CASCADE;
DROP TABLE IF EXISTS locations      CASCADE;
DROP TABLE IF EXISTS skus           CASCADE;
DROP TABLE IF EXISTS events         CASCADE;
-- Clean up legacy tables if they exist
DROP TABLE IF EXISTS location_skus  CASCADE;
DROP TABLE IF EXISTS profiles       CASCADE;
DROP TABLE IF EXISTS stock_entries  CASCADE;
DROP TABLE IF EXISTS bar_skus       CASCADE;
DROP TABLE IF EXISTS bars           CASCADE;

-- ── Events ──────────────────────────────────────────────────
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

-- ── Locations ───────────────────────────────────────────────
CREATE TABLE locations (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id  UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name      TEXT NOT NULL
);

-- ── SKUs (global product catalog) ───────────────────────────
CREATE TABLE skus (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  unit       TEXT NOT NULL DEFAULT 'pcs',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Stock Counts (opening / closing) ────────────────────────
CREATE TABLE stock_counts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  sku_id      UUID NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  quantity    NUMERIC NOT NULL DEFAULT 0,
  type        TEXT NOT NULL CHECK (type IN ('opening', 'closing')),
  counted_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Movements (transfers & deliveries) ──────────────────────
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

-- ── RLS: open access (anon key can do everything) ───────────
ALTER TABLE events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE skus         ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE movements    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open_events"       ON events       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_locations"    ON locations    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_skus"         ON skus         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_stock_counts" ON stock_counts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_movements"    ON movements    FOR ALL USING (true) WITH CHECK (true);

-- ── Enable Realtime ─────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE movements;
ALTER PUBLICATION supabase_realtime ADD TABLE stock_counts;
