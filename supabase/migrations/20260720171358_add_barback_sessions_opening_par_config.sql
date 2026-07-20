alter table public.barback_sessions
  add column if not exists opening_par_config jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'barback_sessions_opening_par_config_shape'
      and conrelid = 'public.barback_sessions'::regclass
  ) then
    alter table public.barback_sessions
      add constraint barback_sessions_opening_par_config_shape
      check (
        opening_par_config is null
        or (
          jsonb_typeof(opening_par_config) = 'object'
          and opening_par_config @> '{"enabled":true,"version":1}'::jsonb
          and jsonb_typeof(opening_par_config -> 'items') = 'array'
          and jsonb_typeof(opening_par_config -> 'configured_at') = 'string'
        )
      );
  end if;
end
$$;
