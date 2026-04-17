-- ════════════════════════════════════════════════════════════
-- Migration: per-event product assortments
--
-- Before: skus was a global catalog shared by every event.
-- After:  each event has its own assortment via event_skus.
--         The skus table becomes a catalog of all products ever
--         used, surfaced as quick-add suggestions.
--
-- IMPORTANT — run this AFTER the earlier runner migration.
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════

-- 1. Junction table: which SKUs belong to which event, with
--    per-event ordering.
CREATE TABLE IF NOT EXISTS event_skus (
  event_id   UUID NOT NULL REFERENCES events(id)  ON DELETE CASCADE,
  sku_id     UUID NOT NULL REFERENCES skus(id)    ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, sku_id)
);
CREATE INDEX IF NOT EXISTS event_skus_event_id_idx ON event_skus(event_id);

ALTER TABLE event_skus ENABLE ROW LEVEL SECURITY;

-- Read: same access rule as other event-scoped tables.
DROP POLICY IF EXISTS "event_skus_read"        ON event_skus;
DROP POLICY IF EXISTS "event_skus_admin_write"  ON event_skus;

CREATE POLICY "event_skus_read" ON event_skus FOR SELECT
  USING (has_event_access(event_id));

CREATE POLICY "event_skus_admin_write" ON event_skus FOR ALL
  USING (
    is_superuser()
    OR (current_platform_role() = 'admin' AND has_event_access(event_id))
  )
  WITH CHECK (
    is_superuser()
    OR (current_platform_role() = 'admin' AND has_event_access(event_id))
  );

-- 2. SKU catalog: any signed-in user can read the full catalog
--    (needed so admins can see suggestions from past events).
--    Write stays restricted to admins/superusers.
DROP POLICY IF EXISTS "skus_read" ON skus;
CREATE POLICY "skus_read" ON skus FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- skus_admin_write unchanged — recreate defensively.
DROP POLICY IF EXISTS "skus_admin_write" ON skus;
CREATE POLICY "skus_admin_write" ON skus FOR ALL
  USING  (current_platform_role() IN ('superuser', 'admin'))
  WITH CHECK (current_platform_role() IN ('superuser', 'admin'));

-- 3. Backfill: if you have existing events+skus with no event_skus rows,
--    this assigns all existing SKUs to all existing events at their
--    current sort_order. Remove/adjust if not needed.
INSERT INTO event_skus (event_id, sku_id, sort_order)
SELECT e.id, s.id, s.sort_order
FROM   events e
CROSS  JOIN skus s
ON CONFLICT DO NOTHING;
