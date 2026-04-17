-- ════════════════════════════════════════════════════════════
-- StockFest — Demo Day Seed
--
-- Inserts a complete, realistic festival day:
--   • 1 active event  (today, 14:00 – 00:00)
--   • 4 locations     (Bar Noord, Bar Zuid, VIP Bar, Festivalshop)
--   • 10 SKUs         (pcs + liters)
--   • Opening counts  at 13:30
--   • Morning delivery at 14:00
--   • Sales throughout the day (14:00 → 23:00, peak at 18–21h)
--   • 2 inter-location transfers
--   • NO closing counts → practice those yourself
--
-- To undo: delete the event — all related rows cascade.
--   DELETE FROM events WHERE name = 'Demo Dag 2026';
--
-- Safe to re-run (uses a unique event name guard).
-- ════════════════════════════════════════════════════════════

DO $$
DECLARE
  -- ── IDs ──────────────────────────────────────────────────
  e_id   UUID;

  loc_n  UUID;  -- Bar Noord
  loc_z  UUID;  -- Bar Zuid
  loc_v  UUID;  -- VIP Bar
  loc_s  UUID;  -- Festivalshop

  sku_h  UUID;  -- Heineken (pcs)
  sku_r  UUID;  -- Radler   (pcs)
  sku_hj UUID;  -- Hertog Jan (pcs)
  sku_w  UUID;  -- Witte Wijn (liters)
  sku_ro UUID;  -- Rosé       (liters)
  sku_c  UUID;  -- Cola  (pcs)
  sku_f  UUID;  -- Fanta (pcs)
  sku_wa UUID;  -- Water (pcs)
  sku_sp UUID;  -- Spa (liters)
  sku_js UUID;  -- Jägermeister (pcs)

  -- ── Base timestamp (today at 00:00 UTC) ───────────────────
  d TIMESTAMPTZ := date_trunc('day', NOW());

BEGIN
  -- Guard: skip if demo event already exists
  IF EXISTS (SELECT 1 FROM events WHERE name = 'Demo Dag 2026') THEN
    RAISE NOTICE 'Demo event already exists — skipping seed.';
    RETURN;
  END IF;

  -- ── 1. EVENT ──────────────────────────────────────────────
  INSERT INTO events (name, date, start_time, end_time, temperature, weather, crowd, status)
  VALUES ('Demo Dag 2026', CURRENT_DATE, '14:00', '00:00', 21, 'cloudy_sunny', 'busy', 'active')
  RETURNING id INTO e_id;

  -- ── 2. LOCATIONS ──────────────────────────────────────────
  INSERT INTO locations (event_id, name) VALUES (e_id, 'Bar Noord')     RETURNING id INTO loc_n;
  INSERT INTO locations (event_id, name) VALUES (e_id, 'Bar Zuid')      RETURNING id INTO loc_z;
  INSERT INTO locations (event_id, name) VALUES (e_id, 'VIP Bar')       RETURNING id INTO loc_v;
  INSERT INTO locations (event_id, name) VALUES (e_id, 'Festivalshop')  RETURNING id INTO loc_s;

  -- ── 3. SKUs (insert or reuse existing by name) ────────────
  -- pcs products
  INSERT INTO skus (name, unit, sort_order) VALUES ('Heineken',      'pcs',    0) ON CONFLICT DO NOTHING;
  INSERT INTO skus (name, unit, sort_order) VALUES ('Radler',        'pcs',    1) ON CONFLICT DO NOTHING;
  INSERT INTO skus (name, unit, sort_order) VALUES ('Hertog Jan',    'pcs',    2) ON CONFLICT DO NOTHING;
  INSERT INTO skus (name, unit, sort_order) VALUES ('Cola',          'pcs',    3) ON CONFLICT DO NOTHING;
  INSERT INTO skus (name, unit, sort_order) VALUES ('Fanta',         'pcs',    4) ON CONFLICT DO NOTHING;
  INSERT INTO skus (name, unit, sort_order) VALUES ('Water',         'pcs',    5) ON CONFLICT DO NOTHING;
  INSERT INTO skus (name, unit, sort_order) VALUES ('Jägermeister',  'pcs',    6) ON CONFLICT DO NOTHING;
  -- liters products
  INSERT INTO skus (name, unit, sort_order) VALUES ('Witte Wijn',    'liters', 7) ON CONFLICT DO NOTHING;
  INSERT INTO skus (name, unit, sort_order) VALUES ('Rosé',          'liters', 8) ON CONFLICT DO NOTHING;
  INSERT INTO skus (name, unit, sort_order) VALUES ('Spa Blauw',     'liters', 9) ON CONFLICT DO NOTHING;

  SELECT id INTO sku_h  FROM skus WHERE name = 'Heineken';
  SELECT id INTO sku_r  FROM skus WHERE name = 'Radler';
  SELECT id INTO sku_hj FROM skus WHERE name = 'Hertog Jan';
  SELECT id INTO sku_c  FROM skus WHERE name = 'Cola';
  SELECT id INTO sku_f  FROM skus WHERE name = 'Fanta';
  SELECT id INTO sku_wa FROM skus WHERE name = 'Water';
  SELECT id INTO sku_js FROM skus WHERE name = 'Jägermeister';
  SELECT id INTO sku_w  FROM skus WHERE name = 'Witte Wijn';
  SELECT id INTO sku_ro FROM skus WHERE name = 'Rosé';
  SELECT id INTO sku_sp FROM skus WHERE name = 'Spa Blauw';

  -- ── 4. EVENT ASSORTMENT ───────────────────────────────
  -- Register all 10 SKUs in this event's assortment.
  INSERT INTO event_skus (event_id, sku_id, sort_order) VALUES
    (e_id, sku_h,   0),
    (e_id, sku_r,   1),
    (e_id, sku_hj,  2),
    (e_id, sku_c,   3),
    (e_id, sku_f,   4),
    (e_id, sku_wa,  5),
    (e_id, sku_js,  6),
    (e_id, sku_w,   7),
    (e_id, sku_ro,  8),
    (e_id, sku_sp,  9);

  -- ── 5. OPENING COUNTS (13:30) ─────────────────────────────────
  -- Bar Noord
  INSERT INTO stock_counts (event_id, location_id, sku_id, quantity, type, counted_at) VALUES
    (e_id, loc_n, sku_h,  144, 'opening', d + interval '13:30'),
    (e_id, loc_n, sku_r,   72, 'opening', d + interval '13:30'),
    (e_id, loc_n, sku_hj,  48, 'opening', d + interval '13:30'),
    (e_id, loc_n, sku_c,   48, 'opening', d + interval '13:30'),
    (e_id, loc_n, sku_f,   24, 'opening', d + interval '13:30'),
    (e_id, loc_n, sku_wa,  48, 'opening', d + interval '13:30'),
    (e_id, loc_n, sku_w,   20, 'opening', d + interval '13:30'),
    (e_id, loc_n, sku_ro,  15, 'opening', d + interval '13:30'),
    (e_id, loc_n, sku_sp,  30, 'opening', d + interval '13:30');

  -- Bar Zuid
  INSERT INTO stock_counts (event_id, location_id, sku_id, quantity, type, counted_at) VALUES
    (e_id, loc_z, sku_h,  120, 'opening', d + interval '13:30'),
    (e_id, loc_z, sku_r,   60, 'opening', d + interval '13:30'),
    (e_id, loc_z, sku_hj,  36, 'opening', d + interval '13:30'),
    (e_id, loc_z, sku_c,   36, 'opening', d + interval '13:30'),
    (e_id, loc_z, sku_f,   24, 'opening', d + interval '13:30'),
    (e_id, loc_z, sku_wa,  36, 'opening', d + interval '13:30'),
    (e_id, loc_z, sku_w,   15, 'opening', d + interval '13:30'),
    (e_id, loc_z, sku_sp,  20, 'opening', d + interval '13:30');

  -- VIP Bar
  INSERT INTO stock_counts (event_id, location_id, sku_id, quantity, type, counted_at) VALUES
    (e_id, loc_v, sku_h,   72, 'opening', d + interval '13:30'),
    (e_id, loc_v, sku_hj,  48, 'opening', d + interval '13:30'),
    (e_id, loc_v, sku_w,   25, 'opening', d + interval '13:30'),
    (e_id, loc_v, sku_ro,  20, 'opening', d + interval '13:30'),
    (e_id, loc_v, sku_js,  24, 'opening', d + interval '13:30'),
    (e_id, loc_v, sku_wa,  24, 'opening', d + interval '13:30');

  -- Festivalshop
  INSERT INTO stock_counts (event_id, location_id, sku_id, quantity, type, counted_at) VALUES
    (e_id, loc_s, sku_h,  288, 'opening', d + interval '13:30'),
    (e_id, loc_s, sku_r,  144, 'opening', d + interval '13:30'),
    (e_id, loc_s, sku_hj, 120, 'opening', d + interval '13:30'),
    (e_id, loc_s, sku_c,   96, 'opening', d + interval '13:30'),
    (e_id, loc_s, sku_f,   72, 'opening', d + interval '13:30'),
    (e_id, loc_s, sku_wa, 120, 'opening', d + interval '13:30'),
    (e_id, loc_s, sku_w,   60, 'opening', d + interval '13:30'),
    (e_id, loc_s, sku_ro,  40, 'opening', d + interval '13:30'),
    (e_id, loc_s, sku_sp,  80, 'opening', d + interval '13:30'),
    (e_id, loc_s, sku_js,  48, 'opening', d + interval '13:30');

  -- ── 5. DELIVERY (14:00 — extra stock arrives) ─────────────
  INSERT INTO movements (event_id, from_location_id, to_location_id, sku_id, quantity, type, moved_at, notes) VALUES
    (e_id, NULL, loc_n, sku_h,  48, 'delivery', d + interval '14:00', 'Opening delivery'),
    (e_id, NULL, loc_n, sku_r,  24, 'delivery', d + interval '14:00', 'Opening delivery'),
    (e_id, NULL, loc_z, sku_h,  48, 'delivery', d + interval '14:05', 'Opening delivery'),
    (e_id, NULL, loc_z, sku_c,  24, 'delivery', d + interval '14:05', 'Opening delivery'),
    (e_id, NULL, loc_v, sku_w,  10, 'delivery', d + interval '14:10', 'Opening delivery'),
    (e_id, NULL, loc_v, sku_ro,  8, 'delivery', d + interval '14:10', 'Opening delivery');

  -- ── 6. SALES THROUGHOUT THE DAY ───────────────────────────
  -- Early afternoon  14:00–16:00 (quiet)
  INSERT INTO movements (event_id, from_location_id, to_location_id, sku_id, quantity, type, moved_at) VALUES
    (e_id, loc_n, NULL, sku_h,   8, 'sale', d + interval '14:20'),
    (e_id, loc_n, NULL, sku_c,   5, 'sale', d + interval '14:35'),
    (e_id, loc_z, NULL, sku_h,   6, 'sale', d + interval '14:45'),
    (e_id, loc_z, NULL, sku_r,   4, 'sale', d + interval '15:00'),
    (e_id, loc_n, NULL, sku_wa,  6, 'sale', d + interval '15:15'),
    (e_id, loc_v, NULL, sku_hj,  4, 'sale', d + interval '15:30'),
    (e_id, loc_z, NULL, sku_f,   3, 'sale', d + interval '15:45'),
    (e_id, loc_n, NULL, sku_hj,  5, 'sale', d + interval '15:50');

  -- Afternoon pick-up  16:00–18:00
  INSERT INTO movements (event_id, from_location_id, to_location_id, sku_id, quantity, type, moved_at) VALUES
    (e_id, loc_n, NULL, sku_h,  18, 'sale', d + interval '16:10'),
    (e_id, loc_n, NULL, sku_r,  10, 'sale', d + interval '16:25'),
    (e_id, loc_z, NULL, sku_h,  15, 'sale', d + interval '16:30'),
    (e_id, loc_z, NULL, sku_c,   8, 'sale', d + interval '16:40'),
    (e_id, loc_v, NULL, sku_w,   4, 'sale', d + interval '16:50'),
    (e_id, loc_v, NULL, sku_ro,  3, 'sale', d + interval '17:00'),
    (e_id, loc_n, NULL, sku_h,  20, 'sale', d + interval '17:10'),
    (e_id, loc_n, NULL, sku_wa, 10, 'sale', d + interval '17:20'),
    (e_id, loc_z, NULL, sku_hj, 12, 'sale', d + interval '17:30'),
    (e_id, loc_z, NULL, sku_f,   6, 'sale', d + interval '17:45'),
    (e_id, loc_v, NULL, sku_js,  6, 'sale', d + interval '17:50'),
    (e_id, loc_n, NULL, sku_ro,  5, 'sale', d + interval '17:55');

  -- Peak evening  18:00–21:00
  INSERT INTO movements (event_id, from_location_id, to_location_id, sku_id, quantity, type, moved_at) VALUES
    (e_id, loc_n, NULL, sku_h,  35, 'sale', d + interval '18:05'),
    (e_id, loc_z, NULL, sku_h,  30, 'sale', d + interval '18:10'),
    (e_id, loc_n, NULL, sku_r,  18, 'sale', d + interval '18:20'),
    (e_id, loc_z, NULL, sku_r,  15, 'sale', d + interval '18:25'),
    (e_id, loc_v, NULL, sku_w,   6, 'sale', d + interval '18:30'),
    (e_id, loc_v, NULL, sku_hj, 10, 'sale', d + interval '18:35'),
    (e_id, loc_n, NULL, sku_hj, 14, 'sale', d + interval '18:40'),
    (e_id, loc_z, NULL, sku_c,  12, 'sale', d + interval '18:50'),
    (e_id, loc_n, NULL, sku_c,  10, 'sale', d + interval '19:00'),
    (e_id, loc_z, NULL, sku_wa, 14, 'sale', d + interval '19:10'),
    (e_id, loc_v, NULL, sku_ro,  5, 'sale', d + interval '19:15'),
    (e_id, loc_v, NULL, sku_js, 10, 'sale', d + interval '19:20'),
    (e_id, loc_n, NULL, sku_h,  40, 'sale', d + interval '19:30'),
    (e_id, loc_z, NULL, sku_h,  36, 'sale', d + interval '19:35'),
    (e_id, loc_n, NULL, sku_r,  20, 'sale', d + interval '19:45'),
    (e_id, loc_z, NULL, sku_hj, 15, 'sale', d + interval '19:50'),
    (e_id, loc_n, NULL, sku_wa, 12, 'sale', d + interval '20:00'),
    (e_id, loc_v, NULL, sku_w,   8, 'sale', d + interval '20:10'),
    (e_id, loc_n, NULL, sku_h,  30, 'sale', d + interval '20:20'),
    (e_id, loc_z, NULL, sku_h,  28, 'sale', d + interval '20:25'),
    (e_id, loc_z, NULL, sku_r,  12, 'sale', d + interval '20:30'),
    (e_id, loc_v, NULL, sku_js,  8, 'sale', d + interval '20:40'),
    (e_id, loc_v, NULL, sku_ro,  6, 'sale', d + interval '20:45'),
    (e_id, loc_n, NULL, sku_f,   5, 'sale', d + interval '20:50');

  -- ── 7. TRANSFER (Bar Noord runs low → replenish from Festivalshop) ──
  INSERT INTO movements (event_id, from_location_id, to_location_id, sku_id, quantity, type, moved_at, notes) VALUES
    (e_id, loc_s, loc_n, sku_h,  48, 'transfer', d + interval '20:55', 'Bar Noord bijvullen'),
    (e_id, loc_s, loc_n, sku_r,  24, 'transfer', d + interval '20:55', 'Bar Noord bijvullen'),
    (e_id, loc_s, loc_z, sku_h,  36, 'transfer', d + interval '21:00', 'Bar Zuid bijvullen'),
    (e_id, loc_s, loc_v, sku_w,  10, 'transfer', d + interval '21:05', 'VIP bijvullen');

  -- Late evening  21:00–23:00 (winding down)
  INSERT INTO movements (event_id, from_location_id, to_location_id, sku_id, quantity, type, moved_at) VALUES
    (e_id, loc_n, NULL, sku_h,  22, 'sale', d + interval '21:10'),
    (e_id, loc_z, NULL, sku_h,  20, 'sale', d + interval '21:15'),
    (e_id, loc_n, NULL, sku_r,  10, 'sale', d + interval '21:25'),
    (e_id, loc_v, NULL, sku_js,  5, 'sale', d + interval '21:30'),
    (e_id, loc_z, NULL, sku_hj, 10, 'sale', d + interval '21:40'),
    (e_id, loc_n, NULL, sku_hj,  8, 'sale', d + interval '21:45'),
    (e_id, loc_v, NULL, sku_w,   5, 'sale', d + interval '21:50'),
    (e_id, loc_n, NULL, sku_h,  15, 'sale', d + interval '22:00'),
    (e_id, loc_z, NULL, sku_h,  12, 'sale', d + interval '22:10'),
    (e_id, loc_n, NULL, sku_c,   6, 'sale', d + interval '22:20'),
    (e_id, loc_z, NULL, sku_r,   6, 'sale', d + interval '22:30'),
    (e_id, loc_v, NULL, sku_hj,  4, 'sale', d + interval '22:40'),
    (e_id, loc_n, NULL, sku_h,   8, 'sale', d + interval '22:50'),
    (e_id, loc_z, NULL, sku_h,   6, 'sale', d + interval '23:00');

  RAISE NOTICE 'Demo day seeded successfully. Event ID: %', e_id;
END $$;
