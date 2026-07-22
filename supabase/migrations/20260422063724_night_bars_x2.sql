-- X2: per-night bar snapshot for historical integrity.
-- night_bars captures which bars belonged to each night, snapshot style.
-- bar_name_at preserves the name as it was that night (renames don't drift).

CREATE TABLE IF NOT EXISTS night_bars (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  night_id    UUID NOT NULL REFERENCES nights(id) ON DELETE CASCADE,
  bar_id      UUID NOT NULL REFERENCES bars(id) ON DELETE RESTRICT,
  bar_name_at TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (night_id, bar_id)
);
CREATE INDEX IF NOT EXISTS night_bars_night_idx ON night_bars (night_id);
CREATE INDEX IF NOT EXISTS night_bars_bar_idx  ON night_bars (bar_id);

ALTER TABLE night_bars ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS night_bars_select_v ON night_bars;
CREATE POLICY night_bars_select_v ON night_bars
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM nights n WHERE n.id = night_bars.night_id
      AND has_venue_access(n.venue_id, 'viewer')
  ));
DROP POLICY IF EXISTS night_bars_insert_v ON night_bars;
CREATE POLICY night_bars_insert_v ON night_bars
  FOR INSERT WITH CHECK (EXISTS (
    SELECT 1 FROM nights n WHERE n.id = night_bars.night_id
      AND has_venue_access(n.venue_id, 'admin')
  ));
DROP POLICY IF EXISTS night_bars_delete_v ON night_bars;
CREATE POLICY night_bars_delete_v ON night_bars
  FOR DELETE USING (EXISTS (
    SELECT 1 FROM nights n WHERE n.id = night_bars.night_id
      AND has_venue_access(n.venue_id, 'admin')
  ));
-- No UPDATE policy — rows are snapshot data; add/remove only.

-- Auto-snapshot on night INSERT. Runs as function owner (bypasses RLS)
-- so every path that creates a night gets the snapshot regardless of caller.
CREATE OR REPLACE FUNCTION snapshot_night_bars_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO night_bars (night_id, bar_id, bar_name_at)
  SELECT NEW.id, b.id, b.name
    FROM bars b
   WHERE b.venue_id = NEW.venue_id AND b.active = true
  ON CONFLICT (night_id, bar_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS nights_snapshot_bars_ai ON nights;
CREATE TRIGGER nights_snapshot_bars_ai
  AFTER INSERT ON nights
  FOR EACH ROW EXECUTE FUNCTION snapshot_night_bars_on_insert();

-- Admin RPC: backfill missing night_bars from transactional evidence.
-- Uses only verifiable historical data (events, bar_close_summaries).
-- Callable per venue; admin+ required.
CREATE OR REPLACE FUNCTION backfill_night_bars(v_venue_id UUID)
RETURNS TABLE (
  night_id UUID,
  night_name TEXT,
  bars_inserted INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  inserted_count INTEGER;
BEGIN
  IF NOT has_venue_access(v_venue_id, 'admin') THEN
    RAISE EXCEPTION 'admin role required on venue' USING ERRCODE = '42501';
  END IF;

  FOR r IN
    SELECT n.id AS nid, n.name AS nname
      FROM nights n
     WHERE n.venue_id = v_venue_id
     ORDER BY n.date NULLS LAST, n.name
  LOOP
    WITH evidence AS (
      SELECT DISTINCT bar_id FROM events
        WHERE night_id = r.nid AND bar_id IS NOT NULL
      UNION
      SELECT DISTINCT bar_id FROM bar_close_summaries
        WHERE night_id = r.nid AND bar_id IS NOT NULL
    )
    INSERT INTO night_bars (night_id, bar_id, bar_name_at)
    SELECT r.nid, e.bar_id, COALESCE(b.name, 'Unknown bar ' || SUBSTRING(e.bar_id::text, 1, 8))
      FROM evidence e
      LEFT JOIN bars b ON b.id = e.bar_id
    ON CONFLICT (night_id, bar_id) DO NOTHING;

    GET DIAGNOSTICS inserted_count = ROW_COUNT;
    night_id := r.nid;
    night_name := r.nname;
    bars_inserted := inserted_count;
    RETURN NEXT;
  END LOOP;
  RETURN;
END;
$$;

-- One-shot backfill at migration time: populate night_bars for every
-- existing night across every venue using events + bar_close_summaries.
-- Nights with zero transactional evidence remain empty (fallback path).
INSERT INTO night_bars (night_id, bar_id, bar_name_at)
SELECT DISTINCT e.night_id, e.bar_id,
       COALESCE(b.name, 'Unknown bar ' || SUBSTRING(e.bar_id::text, 1, 8))
  FROM events e
  LEFT JOIN bars b ON b.id = e.bar_id
 WHERE e.night_id IS NOT NULL AND e.bar_id IS NOT NULL
ON CONFLICT (night_id, bar_id) DO NOTHING;

INSERT INTO night_bars (night_id, bar_id, bar_name_at)
SELECT DISTINCT bcs.night_id, bcs.bar_id,
       COALESCE(b.name, 'Unknown bar ' || SUBSTRING(bcs.bar_id::text, 1, 8))
  FROM bar_close_summaries bcs
  LEFT JOIN bars b ON b.id = bcs.bar_id
 WHERE bcs.night_id IS NOT NULL AND bcs.bar_id IS NOT NULL
ON CONFLICT (night_id, bar_id) DO NOTHING;;
