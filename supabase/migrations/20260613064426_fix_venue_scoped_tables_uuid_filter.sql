CREATE OR REPLACE FUNCTION public._venue_scoped_tables()
 RETURNS TABLE(table_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT c.table_name::text
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.column_name  = 'venue_id'
    AND c.data_type    = 'uuid'
    AND c.table_name NOT IN ('backup_snapshots')
  ORDER BY c.table_name;
$function$;;
