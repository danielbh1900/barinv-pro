-- bottle_returns RLS
CREATE POLICY "org_isolation_bottle_returns" ON bottle_returns
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM venue_users WHERE user_id = auth.uid()
    )
  );

-- pos_sales RLS
CREATE POLICY "org_isolation_pos_sales" ON pos_sales
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM venue_users WHERE user_id = auth.uid()
    )
  );

-- variance_results RLS
CREATE POLICY "org_isolation_variance_results" ON variance_results
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM venue_users WHERE user_id = auth.uid()
    )
  );

-- performance_scores RLS
CREATE POLICY "org_isolation_performance_scores" ON performance_scores
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM venue_users WHERE user_id = auth.uid()
    )
  );;
