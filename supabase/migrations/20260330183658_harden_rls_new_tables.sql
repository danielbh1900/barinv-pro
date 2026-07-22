
-- ========================================
-- HARDEN RLS: bottle_returns
-- ========================================
-- Drop overly permissive ALL policy
DROP POLICY IF EXISTS "org_isolation_bottle_returns" ON bottle_returns;

-- SELECT: any venue member can read
CREATE POLICY "bottle_returns_select_venue_member" ON bottle_returns
  FOR SELECT USING (
    (organization_id = get_user_org_id())
    AND EXISTS (
      SELECT 1 FROM venue_users
      WHERE venue_users.user_id = auth.uid()
        AND venue_users.venue_id = bottle_returns.venue_id
        AND venue_users.active = true
    )
  );

-- INSERT: bartender+ can insert (must set returned_by to self)
CREATE POLICY "bottle_returns_insert_bartender" ON bottle_returns
  FOR INSERT WITH CHECK (
    (organization_id = get_user_org_id())
    AND has_min_role(venue_id, 'bartender'::user_role)
    AND (returned_by = auth.uid() OR returned_by IS NULL)
  );

-- DELETE: only admin (for corrections)
CREATE POLICY "bottle_returns_delete_admin" ON bottle_returns
  FOR DELETE USING (
    (organization_id = get_user_org_id())
    AND is_org_admin()
  );

-- ========================================
-- HARDEN RLS: pos_sales
-- ========================================
DROP POLICY IF EXISTS "org_isolation_pos_sales" ON pos_sales;

-- SELECT: any venue member can read
CREATE POLICY "pos_sales_select_venue_member" ON pos_sales
  FOR SELECT USING (
    (organization_id = get_user_org_id())
    AND EXISTS (
      SELECT 1 FROM venue_users
      WHERE venue_users.user_id = auth.uid()
        AND venue_users.venue_id = pos_sales.venue_id
        AND venue_users.active = true
    )
  );

-- INSERT: bartender+ can insert
CREATE POLICY "pos_sales_insert_bartender" ON pos_sales
  FOR INSERT WITH CHECK (
    (organization_id = get_user_org_id())
    AND has_min_role(venue_id, 'bartender'::user_role)
  );

-- DELETE: only admin
CREATE POLICY "pos_sales_delete_admin" ON pos_sales
  FOR DELETE USING (
    (organization_id = get_user_org_id())
    AND is_org_admin()
  );

-- ========================================
-- HARDEN RLS: variance_results
-- ========================================
DROP POLICY IF EXISTS "org_isolation_variance_results" ON variance_results;

-- SELECT: any venue member can read
CREATE POLICY "variance_results_select_venue_member" ON variance_results
  FOR SELECT USING (
    (organization_id = get_user_org_id())
    AND EXISTS (
      SELECT 1 FROM venue_users
      WHERE venue_users.user_id = auth.uid()
        AND venue_users.venue_id = variance_results.venue_id
        AND venue_users.active = true
    )
  );

-- INSERT: manager+ can insert (variance is calculated, not user-submitted)
CREATE POLICY "variance_results_insert_manager" ON variance_results
  FOR INSERT WITH CHECK (
    (organization_id = get_user_org_id())
    AND has_min_role(venue_id, 'manager'::user_role)
  );

-- DELETE: manager+ can delete (recalculation replaces old results)
CREATE POLICY "variance_results_delete_manager" ON variance_results
  FOR DELETE USING (
    (organization_id = get_user_org_id())
    AND has_min_role(venue_id, 'manager'::user_role)
  );

-- ========================================
-- HARDEN RLS: performance_scores
-- ========================================
DROP POLICY IF EXISTS "org_isolation_performance_scores" ON performance_scores;

-- SELECT: any venue member can read
CREATE POLICY "performance_scores_select_venue_member" ON performance_scores
  FOR SELECT USING (
    (organization_id = get_user_org_id())
    AND EXISTS (
      SELECT 1 FROM venue_users
      WHERE venue_users.user_id = auth.uid()
        AND venue_users.venue_id = performance_scores.venue_id
        AND venue_users.active = true
    )
  );

-- INSERT: manager+ only
CREATE POLICY "performance_scores_insert_manager" ON performance_scores
  FOR INSERT WITH CHECK (
    (organization_id = get_user_org_id())
    AND has_min_role(venue_id, 'manager'::user_role)
  );

-- DELETE: manager+ only (recalculation)
CREATE POLICY "performance_scores_delete_manager" ON performance_scores
  FOR DELETE USING (
    (organization_id = get_user_org_id())
    AND has_min_role(venue_id, 'manager'::user_role)
  );

-- ========================================
-- BLOCK UPDATE on immutable tables
-- ========================================
-- bottle_returns, pos_sales, variance_results should be immutable (delete+reinsert for corrections)
-- No UPDATE policy = no updates allowed through RLS
;
