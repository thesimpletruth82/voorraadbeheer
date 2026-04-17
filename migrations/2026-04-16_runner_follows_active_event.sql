-- ════════════════════════════════════════════════════════════
-- Migration: runners auto-follow the active event
--
-- Before: a runner could only read/write data for events they
--   had an explicit `event_assignments` row for.
-- After:  runners automatically have access to whichever event
--   currently has `status = 'active'`, without needing an
--   assignment row. When the active event changes, they follow.
--
-- Admin and superuser behavior is unchanged.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════

-- 1. Extend has_event_access():
--    Superuser → always
--    Has an event_assignments row → always (admin access path)
--    Runner → when the target event is currently active
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
    )
    OR (
      current_platform_role() = 'runner'
      AND EXISTS (SELECT 1 FROM events WHERE id = _event_id AND status = 'active')
    );
$$;

-- 2. events_read: let runners see the active event row even with no assignment.
DROP POLICY IF EXISTS "events_read" ON events;
CREATE POLICY "events_read" ON events FOR SELECT USING (
  is_superuser()
  OR EXISTS (SELECT 1 FROM event_assignments WHERE event_id = events.id AND user_id = auth.uid())
  OR (current_platform_role() = 'runner' AND status = 'active')
);

-- 3. skus_read: global catalog — let runners read it as long as an active event exists.
DROP POLICY IF EXISTS "skus_read" ON skus;
CREATE POLICY "skus_read" ON skus FOR SELECT USING (
  auth.uid() IS NOT NULL
  AND (
    is_superuser()
    OR EXISTS (SELECT 1 FROM event_assignments WHERE user_id = auth.uid())
    OR (
      current_platform_role() = 'runner'
      AND EXISTS (SELECT 1 FROM events WHERE status = 'active')
    )
  )
);

-- Policies on locations / stock_counts / movements go through
-- has_event_access() directly, so they automatically pick up
-- the new runner-follows-active rule. No changes needed there.
