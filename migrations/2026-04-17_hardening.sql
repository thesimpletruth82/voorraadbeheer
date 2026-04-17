-- ════════════════════════════════════════════════════════════
-- StockFest — Hardening migration
-- 2026-04-17
--
-- Run in the Supabase SQL Editor.
-- Safe to re-run — uses IF NOT EXISTS / CREATE OR REPLACE.
--
-- Changes:
--   1.  profiles.status     — pending/active; blocks uninvited signups
--   2.  invites.expires_at  — invites expire after 7 days
--   3.  movements.created_by    — audit trail per movement
--   4.  stock_counts.counted_by — audit trail per count
--   5.  Performance indexes
--   6.  handle_new_user     — uninvited → pending instead of active runner
--   7.  current_platform_role() — only active profiles get a role
--   8.  has_event_access()  — pending profiles blocked
--   9.  set_active_event()  — atomic event activation (no gap between close/open)
--  10.  movements_runner_sales policy — enforce created_by = auth.uid()
-- ════════════════════════════════════════════════════════════


-- ── 1. profiles — status column ─────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'pending'));


-- ── 2. invites — expires_at column ──────────────────────────
ALTER TABLE invites
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ
    DEFAULT (NOW() + INTERVAL '7 days');


-- ── 3. movements — created_by ────────────────────────────────
ALTER TABLE movements
  ADD COLUMN IF NOT EXISTS created_by UUID
    REFERENCES auth.users(id) ON DELETE SET NULL;


-- ── 4. stock_counts — counted_by ────────────────────────────
ALTER TABLE stock_counts
  ADD COLUMN IF NOT EXISTS counted_by UUID
    REFERENCES auth.users(id) ON DELETE SET NULL;


-- ── 5. Performance indexes ───────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_movements_event_moved
  ON movements(event_id, moved_at DESC);

CREATE INDEX IF NOT EXISTS idx_movements_event_id
  ON movements(event_id);

CREATE INDEX IF NOT EXISTS idx_stock_counts_lookup
  ON stock_counts(event_id, location_id, sku_id, type);


-- ── 6. Updated handle_new_user ───────────────────────────────
-- Uninvited signups → status='pending' (can sign in but see nothing
-- until a superuser sets their status to 'active').
-- Invited signups and the very first user → status='active'.
-- Expired invites are NOT honoured.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _role   TEXT := 'runner';
  _status TEXT := 'pending';
  _invite invites%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE platform_role = 'superuser') THEN
    -- First user ever → superuser, immediately active
    _role   := 'superuser';
    _status := 'active';
  ELSE
    SELECT * INTO _invite FROM invites
      WHERE LOWER(email) = LOWER(NEW.email)
        AND accepted_at IS NULL
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at DESC
      LIMIT 1;
    IF FOUND THEN
      _role   := _invite.platform_role;
      _status := 'active';
    END IF;
    -- No matching invite → runner/pending (no event access)
  END IF;

  INSERT INTO profiles (id, email, platform_role, status)
  VALUES (NEW.id, NEW.email, _role, _status)
  ON CONFLICT (id) DO NOTHING;

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


-- ── 7. current_platform_role() — only active profiles ────────
CREATE OR REPLACE FUNCTION current_platform_role()
RETURNS TEXT
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT platform_role
  FROM   profiles
  WHERE  id = auth.uid()
  AND    status = 'active';
$$;


-- ── 8. has_event_access() — block pending profiles ───────────
CREATE OR REPLACE FUNCTION has_event_access(_event_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    is_superuser()
    OR (
      -- Must be an active (non-pending) profile
      EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND status = 'active')
      AND (
        -- Admin/runner assigned explicitly to this event
        EXISTS (
          SELECT 1 FROM event_assignments
          WHERE event_id = _event_id AND user_id = auth.uid()
        )
        -- Runner auto-follows whichever event is currently active
        OR (
          current_platform_role() = 'runner'
          AND EXISTS (SELECT 1 FROM events WHERE id = _event_id AND status = 'active')
        )
      )
    );
$$;


-- ── 9. set_active_event() — atomic activation RPC ────────────
-- Closes all other active events and activates the target in one
-- transaction, so there is never a moment with zero active events.
CREATE OR REPLACE FUNCTION set_active_event(p_event_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (is_superuser() OR current_platform_role() = 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: only superusers and admins can activate events';
  END IF;

  UPDATE events SET status = 'closed'
    WHERE status = 'active' AND id != p_event_id;

  UPDATE events SET status = 'active'
    WHERE id = p_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION set_active_event(UUID) TO authenticated;


-- ── 10. movements_runner_sales — enforce created_by ──────────
DROP POLICY IF EXISTS "movements_runner_sales" ON movements;
CREATE POLICY "movements_runner_sales" ON movements FOR INSERT WITH CHECK (
  current_platform_role() = 'runner'
  AND type = 'sale'
  AND has_event_access(event_id)
  AND (created_by IS NULL OR created_by = auth.uid())
);
