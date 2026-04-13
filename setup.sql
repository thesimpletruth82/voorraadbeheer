-- Festival Stock Management — Supabase Setup
-- Run this entire file in the Supabase SQL Editor

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  date DATE NOT NULL,
  staff_password TEXT NOT NULL,
  start_time TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  order_num INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS skus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'stuks',
  is_beer_tank BOOLEAN DEFAULT FALSE,
  tank_size_liters INTEGER DEFAULT 1000,
  order_num INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bar_skus (
  bar_id UUID NOT NULL REFERENCES bars(id) ON DELETE CASCADE,
  sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  PRIMARY KEY (bar_id, sku_id)
);

CREATE TABLE IF NOT EXISTS stock_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  bar_id UUID NOT NULL REFERENCES bars(id) ON DELETE CASCADE,
  sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('initial_count','tap_out','delivery','transfer_out','transfer_in','beer_tank_level','end_count')),
  quantity NUMERIC NOT NULL DEFAULT 0,
  beer_tank_liters NUMERIC,
  transfer_to_bar_id UUID REFERENCES bars(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE bars ENABLE ROW LEVEL SECURITY;
ALTER TABLE skus ENABLE ROW LEVEL SECURITY;
ALTER TABLE bar_skus ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_all" ON events;
DROP POLICY IF EXISTS "public_all" ON bars;
DROP POLICY IF EXISTS "public_all" ON skus;
DROP POLICY IF EXISTS "public_all" ON bar_skus;
DROP POLICY IF EXISTS "public_all" ON stock_entries;

CREATE POLICY "public_all" ON events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON bars FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON skus FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON bar_skus FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON stock_entries FOR ALL USING (true) WITH CHECK (true);
