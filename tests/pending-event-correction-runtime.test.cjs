'use strict';

// Runtime security verification for the PENDING Event correction RPC.
//
// SAFETY BOUNDARY:
// - starts one fresh, uniquely named local Docker container;
// - requires the exact pre-existing image below (never pulls an image);
// - connects only through `docker exec` to that container's local Unix socket;
// - reads no Supabase URL, database URL, API key, or service-role key;
// - always removes only the container name created by this process.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const image = 'public.ecr.aws/supabase/postgres:17.6.1.075';
const protectedMigrationPath = path.join(
  root,
  'supabase/migrations/20260730114500_lock_down_event_protected_fields.sql',
);
const correctionMigrationPath = path.join(
  root,
  'supabase/migrations/20260915160000_pending_event_correction_rpc.sql',
);
const protectedMigration = fs.readFileSync(protectedMigrationPath, 'utf8');
const correctionMigration = fs.readFileSync(correctionMigrationPath, 'utf8');

const ID = Object.freeze({
  venueA: '11111111-1111-1111-1111-111111111111',
  venueB: '22222222-2222-2222-2222-222222222222',
  managerA: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  managerB: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  staff: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  submitted: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  night: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  bar: 'f1111111-1111-1111-1111-111111111111',
  station: 'f2222222-2222-2222-2222-222222222222',
  item: 'f3333333-3333-3333-3333-333333333333',
  session: 'f4444444-4444-4444-4444-444444444444',
  pendingAuth: '10000000-0000-0000-0000-000000000001',
  pendingQty: '10000000-0000-0000-0000-000000000002',
  pendingWeight: '10000000-0000-0000-0000-000000000003',
  pendingPlainWeight: '10000000-0000-0000-0000-000000000004',
  approved: '10000000-0000-0000-0000-000000000005',
  rejected: '10000000-0000-0000-0000-000000000006',
  atomic: '10000000-0000-0000-0000-000000000007',
  forged: '10000000-0000-0000-0000-000000000008',
  scope: '10000000-0000-0000-0000-000000000009',
  direct: '10000000-0000-0000-0000-000000000010',
  positive: '10000000-0000-0000-0000-000000000011',
  decimalWeight: '10000000-0000-0000-0000-000000000012',
  missing: '99999999-9999-9999-9999-999999999999',
});

const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function command(program, args, options = {}) {
  return spawnSync(program, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
}

function requireSuccess(result, label) {
  if (result.status === 0) return result.stdout.trim();
  const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  throw new Error(`${label} failed${detail ? `:\n${detail}` : ''}`);
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function rpc(eventId, mode, qty, weight = 'NULL', venueId = ID.venueA) {
  return `SELECT public.barinv_correct_pending_event(
    ${sqlLiteral(venueId)}::uuid,
    ${sqlLiteral(eventId)}::uuid,
    ${sqlLiteral(mode)},
    ${qty},
    ${weight}
  )`;
}

function claims(userId = ID.managerA, role = 'authenticated') {
  return `SELECT set_config('request.jwt.claim.sub', ${sqlLiteral(userId)}, true);
SELECT set_config('request.jwt.claim.role', ${sqlLiteral(role)}, true);`;
}

function expectedFailure(statement, sqlState, messagePattern, postcondition = 'true') {
  const executable = statement.replace(/^\s*SELECT\b/, 'PERFORM');
  return `
DO $test$
DECLARE
  v_state text;
  v_message text;
BEGIN
  BEGIN
    ${executable};
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
  END;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'expected SQLSTATE ${sqlState}, but statement succeeded';
  END IF;
  IF v_state <> '${sqlState}' THEN
    RAISE EXCEPTION 'expected SQLSTATE ${sqlState}, got %: %', v_state, v_message;
  END IF;
  IF v_message !~ ${sqlLiteral(messagePattern)} THEN
    RAISE EXCEPTION 'error message did not match ${messagePattern}: %', v_message;
  END IF;
END
$test$;
RESET ROLE;
SELECT test_fixture.assert_true((${postcondition}), 'failed operation changed protected state');`;
}

// -------------------------------------------------------------------------
// BOOTSTRAP TEST FIXTURE (not production schema or migration logic)
// -------------------------------------------------------------------------
const bootstrapSql = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'barback_user') THEN
    CREATE ROLE barback_user NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END
$roles$;

-- The pinned Supabase image supplies its real auth schema, roles, auth.uid(),
-- and auth.role(). Reuse them instead of shadowing Supabase runtime behavior.

CREATE TABLE public.test_venue_access (
  user_id uuid NOT NULL,
  venue_id uuid NOT NULL,
  access_role text NOT NULL,
  PRIMARY KEY (user_id, venue_id)
);

INSERT INTO public.test_venue_access (user_id, venue_id, access_role) VALUES
  ('${ID.managerA}', '${ID.venueA}', 'manager'),
  ('${ID.managerB}', '${ID.venueB}', 'manager');

CREATE FUNCTION public.has_venue_access(p_venue_id uuid, p_required_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.test_venue_access AS a
    WHERE a.user_id = auth.uid()
      AND a.venue_id = p_venue_id
      AND (p_required_role <> 'manager' OR a.access_role = 'manager')
  )
$$;

GRANT EXECUTE ON FUNCTION public.has_venue_access(uuid, text)
  TO anon, authenticated, barback_user, service_role;

CREATE TABLE public.events (
  id uuid PRIMARY KEY,
  venue_id uuid NOT NULL,
  night_id uuid NOT NULL,
  bar_id uuid NOT NULL,
  station_id uuid NOT NULL,
  item_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  submitted_by uuid NOT NULL,
  qty numeric NOT NULL,
  action text NOT NULL,
  reason_code text,
  qty_basis text,
  client_event_id text NOT NULL,
  source text NOT NULL,
  session_id uuid NOT NULL,
  status text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL
);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.events TO anon, authenticated, barback_user, service_role;
GRANT UPDATE ON public.events TO authenticated, service_role;

INSERT INTO public.events (
  id, venue_id, night_id, bar_id, station_id, item_id, staff_id,
  submitted_by, qty, action, reason_code, qty_basis, client_event_id,
  source, session_id, status, notes, created_at
) VALUES
  ('${ID.pendingAuth}', '${ID.venueA}', '${ID.night}', '${ID.bar}', '${ID.station}', '${ID.item}', '${ID.staff}', '${ID.submitted}', 2, 'RETURNED', 'AUTH_CASE', 'EACH', 'client-auth', 'BARBACK', '${ID.session}', 'PENDING', 'Auth fixture', '2026-09-15T16:00:00Z'),
  ('${ID.pendingQty}', '${ID.venueA}', '${ID.night}', '${ID.bar}', '${ID.station}', '${ID.item}', '${ID.staff}', '${ID.submitted}', 2, 'RETURNED', 'QTY_CASE', 'EACH', 'client-qty', 'BARBACK', '${ID.session}', 'PENDING', 'Human note [WEIGHT_G=681.500] [BOTTLE_STATE=PARTIAL] [TARE_WEIGHT_G=500] [FULL_WEIGHT_G=1200] [REMAINING_PERCENT=38] [LIQUID_WEIGHT_G=181.5] [REMAINING_ML=265] [WEIGHT_PROFILE_SOURCE=CATALOG] [WEIGHT_PROFILE_NEEDED=0] [MEASUREMENT_SOURCE=SCALE] [BARBACK_WEIGHT_MVP=1] [SOME_TAG=x] tail', '2026-09-15T16:01:00Z'),
  ('${ID.pendingWeight}', '${ID.venueA}', '${ID.night}', '${ID.bar}', '${ID.station}', '${ID.item}', '${ID.staff}', '${ID.submitted}', 2, 'RETURNED', 'WEIGHT_CASE', 'EACH', 'client-weight', 'BARBACK', '${ID.session}', 'PENDING', 'Weight human [WEIGHT_G=600] [BOTTLE_STATE=SEALED] [REMAINING_PERCENT=50] [WEIGHT_PROFILE_SOURCE=MEASURED] [SOME_TAG=y] [WEIGHT_G=700]', '2026-09-15T16:02:00Z'),
  ('${ID.pendingPlainWeight}', '${ID.venueA}', '${ID.night}', '${ID.bar}', '${ID.station}', '${ID.item}', '${ID.staff}', '${ID.submitted}', 2, 'RETURNED', 'PLAIN_WEIGHT_CASE', 'EACH', 'client-plain-weight', 'BARBACK', '${ID.session}', 'PENDING', 'Plain human note [SOME_TAG=z]', '2026-09-15T16:03:00Z'),
  ('${ID.approved}', '${ID.venueA}', '${ID.night}', '${ID.bar}', '${ID.station}', '${ID.item}', '${ID.staff}', '${ID.submitted}', 2, 'RETURNED', 'APPROVED_CASE', 'EACH', 'client-approved', 'BARBACK', '${ID.session}', 'APPROVED', 'Approved fixture', '2026-09-15T16:04:00Z'),
  ('${ID.rejected}', '${ID.venueA}', '${ID.night}', '${ID.bar}', '${ID.station}', '${ID.item}', '${ID.staff}', '${ID.submitted}', 2, 'RETURNED', 'REJECTED_CASE', 'EACH', 'client-rejected', 'BARBACK', '${ID.session}', 'REJECTED', 'Rejected fixture', '2026-09-15T16:05:00Z'),
  ('${ID.atomic}', '${ID.venueA}', '${ID.night}', '${ID.bar}', '${ID.station}', '${ID.item}', '${ID.staff}', '${ID.submitted}', 2, 'RETURNED', 'ATOMIC_CASE', 'EACH', 'client-atomic', 'BARBACK', '${ID.session}', 'PENDING', 'Atomic fixture', '2026-09-15T16:06:00Z'),
  ('${ID.forged}', '${ID.venueA}', '${ID.night}', '${ID.bar}', '${ID.station}', '${ID.item}', '${ID.staff}', '${ID.submitted}', 2, 'RETURNED', 'FORGE_CASE', 'EACH', 'client-forged', 'BARBACK', '${ID.session}', 'PENDING', 'Forged fixture', '2026-09-15T16:07:00Z'),
  ('${ID.scope}', '${ID.venueA}', '${ID.night}', '${ID.bar}', '${ID.station}', '${ID.item}', '${ID.staff}', '${ID.submitted}', 2, 'RETURNED', 'SCOPE_CASE', 'EACH', 'client-scope', 'BARBACK', '${ID.session}', 'PENDING', 'Scope fixture', '2026-09-15T16:08:00Z'),
  ('${ID.direct}', '${ID.venueA}', '${ID.night}', '${ID.bar}', '${ID.station}', '${ID.item}', '${ID.staff}', '${ID.submitted}', 2, 'RETURNED', 'DIRECT_CASE', 'EACH', 'client-direct', 'BARBACK', '${ID.session}', 'PENDING', 'Direct fixture', '2026-09-15T16:09:00Z'),
  ('${ID.positive}', '${ID.venueA}', '${ID.night}', '${ID.bar}', '${ID.station}', '${ID.item}', '${ID.staff}', '${ID.submitted}', 2, 'RETURNED', 'POSITIVE_CASE', 'EACH', 'client-positive', 'BARBACK', '${ID.session}', 'PENDING', 'Positive fixture', '2026-09-15T16:10:00Z'),
  ('${ID.decimalWeight}', '${ID.venueA}', '${ID.night}', '${ID.bar}', '${ID.station}', '${ID.item}', '${ID.staff}', '${ID.submitted}', 2, 'RETURNED', 'DECIMAL_WEIGHT_CASE', 'EACH', 'client-decimal-weight', 'BARBACK', '${ID.session}', 'PENDING', 'Decimal weight fixture', '2026-09-15T16:11:00Z');
`;

// Test-only helpers are installed after the REAL MIGRATION SQL. The update
// helper deliberately reaches the protected trigger through SECURITY DEFINER,
// allowing the trigger's token/audit checks to be tested independently of the
// table's column ACL. It contains none of the migration's authorization logic.
const postMigrationFixtureSql = `
CREATE SCHEMA test_fixture;

CREATE FUNCTION test_fixture.assert_true(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT COALESCE(p_condition, false) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = p_message;
  END IF;
END
$$;

CREATE FUNCTION test_fixture.attempt_event_update(
  p_event_id uuid,
  p_qty numeric,
  p_notes text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.events
  SET qty = p_qty, notes = p_notes
  WHERE id = p_event_id
$$;

GRANT USAGE ON SCHEMA test_fixture TO authenticated;
GRANT EXECUTE ON FUNCTION test_fixture.attempt_event_update(uuid, numeric, text)
  TO authenticated;
`;

function authenticatedScript(body, userId = ID.managerA) {
  return `BEGIN;
SET LOCAL ROLE authenticated;
${claims(userId)}
${body}
COMMIT;`;
}

test('PENDING Event correction runtime security matrix', { timeout: 120_000 }, async t => {
  const dockerVersion = command('docker', ['--version']);
  if (dockerVersion.status !== 0) {
    t.skip('Docker CLI is unavailable; runtime assertions were not weakened or simulated');
    return;
  }

  const daemon = command('docker', ['info', '--format', '{{.ServerVersion}}']);
  if (daemon.status !== 0) {
    t.skip(`Docker daemon is unavailable: ${daemon.stderr.trim() || daemon.stdout.trim()}`);
    return;
  }

  const localImage = command('docker', ['image', 'inspect', image, '--format', '{{.Id}}']);
  if (localImage.status !== 0) {
    t.skip(`Required image is not present locally; refusing to pull or substitute: ${image}`);
    return;
  }

  const container = `barinv-pending-event-runtime-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  const disposablePassword = crypto.randomBytes(32).toString('hex');
  let created = false;

  console.log(`# disposable container: ${container}`);
  console.log(`# exact local image: ${image} (${localImage.stdout.trim()})`);

  function docker(args, options = {}) {
    return command('docker', args, options);
  }

  function runSql(sql, label) {
    const result = docker([
      'exec', '-i', container,
      'psql', '-X', '--no-psqlrc', '--set', 'ON_ERROR_STOP=1',
      '--set', 'VERBOSITY=verbose', '--quiet', '-U', 'postgres', '-d', 'postgres',
    ], { input: sql });
    return requireSuccess(result, label);
  }

  async function check(name, sql) {
    await t.test(name, () => {
      runSql(sql, name);
    });
  }

  try {
    const started = docker([
      'run', '--pull=never', '--detach', '--rm', '--name', container,
      '--env', `POSTGRES_PASSWORD=${disposablePassword}`,
      image,
    ]);
    requireSuccess(started, 'starting disposable PostgreSQL container');
    created = true;

    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const probe = docker([
        'exec', container,
        'psql', '-X', '--no-psqlrc', '--quiet', '-U', 'postgres', '-d', 'postgres',
        '--command', 'SELECT 1',
      ]);
      if (probe.status === 0) {
        ready = true;
        break;
      }
      sleep(500);
    }
    assert.ok(ready, 'disposable PostgreSQL did not become ready within 30 seconds');

    runSql(bootstrapSql, 'BOOTSTRAP TEST FIXTURE');
    runSql(protectedMigration, `REAL MIGRATION SQL: ${path.relative(root, protectedMigrationPath)}`);
    runSql(correctionMigration, `REAL MIGRATION SQL: ${path.relative(root, correctionMigrationPath)}`);
    runSql(postMigrationFixtureSql, 'post-migration test-only helpers');

    await check('1. unauthenticated caller cannot correct an Event', `
BEGIN;
SET LOCAL ROLE anon;
${expectedFailure(rpc(ID.pendingAuth, 'QUANTITY', '3'), '42501', 'permission denied|Authentication required', `(SELECT qty = 2 FROM public.events WHERE id = '${ID.pendingAuth}')`)}
ROLLBACK;`);

    await check('2. authenticated non-manager cannot correct', authenticatedScript(
      expectedFailure(rpc(ID.pendingAuth, 'QUANTITY', '3'), '42501', 'Manager access required', `(SELECT qty = 2 FROM public.events WHERE id = '${ID.pendingAuth}')`),
      ID.staff,
    ));

    await check('3. manager for wrong Venue cannot correct', authenticatedScript(
      expectedFailure(rpc(ID.pendingAuth, 'QUANTITY', '3'), '42501', 'Manager access required', `(SELECT qty = 2 FROM public.events WHERE id = '${ID.pendingAuth}')`),
      ID.managerB,
    ));

    await check('4. authorized manager can correct a PENDING Event', authenticatedScript(`
${rpc(ID.pendingAuth, 'QUANTITY', '3')};
RESET ROLE;
SELECT test_fixture.assert_true(
  (SELECT qty = 3 FROM public.events WHERE id = '${ID.pendingAuth}'),
  'authorized correction did not persist'
);`));

    await check('5. missing or inaccessible Venue event updates nothing', authenticatedScript(
      expectedFailure(rpc(ID.pendingAuth, 'QUANTITY', '4', 'NULL', ID.venueB), 'P0002', 'Event not found in this Venue', `(SELECT qty = 3 FROM public.events WHERE id = '${ID.pendingAuth}')`),
      ID.managerB,
    ));

    await check('6. APPROVED Event cannot be corrected', authenticatedScript(
      expectedFailure(rpc(ID.approved, 'QUANTITY', '3'), '22023', 'no longer PENDING', `(SELECT qty = 2 FROM public.events WHERE id = '${ID.approved}')`),
    ));

    await check('7. REJECTED Event cannot be corrected', authenticatedScript(
      expectedFailure(rpc(ID.rejected, 'QUANTITY', '3'), '22023', 'no longer PENDING', `(SELECT qty = 2 FROM public.events WHERE id = '${ID.rejected}')`),
    ));

    await check('8. PENDING qty is correctable only through the approved RPC', authenticatedScript(`
${expectedFailure(`PERFORM test_fixture.attempt_event_update('${ID.direct}'::uuid, 9, 'unapproved')`, '42501', 'protected fields are immutable', `(SELECT qty = 2 AND notes = 'Direct fixture' FROM public.events WHERE id = '${ID.direct}')`)}
SET LOCAL ROLE authenticated;
${claims()}
${rpc(ID.direct, 'QUANTITY', '9')};
RESET ROLE;
SELECT test_fixture.assert_true(
  (SELECT qty = 9 FROM public.events WHERE id = '${ID.direct}'),
  'approved RPC did not correct PENDING Event'
);`));

    const quantityValidation = [
      ['9. qty NULL is rejected', 'NULL'],
      ['10. qty zero is rejected', '0'],
      ['11. negative qty is rejected', '-1'],
      ['12. decimal qty is rejected', '1.5'],
    ];
    for (const [name, qty] of quantityValidation) {
      await check(name, authenticatedScript(
        expectedFailure(rpc(ID.positive, 'QUANTITY', qty), '22023', 'positive integer', `(SELECT qty = 2 FROM public.events WHERE id = '${ID.positive}')`),
      ));
    }

    await check('13. positive integer qty is accepted', authenticatedScript(`
${rpc(ID.positive, 'QUANTITY', '6')};
RESET ROLE;
SELECT test_fixture.assert_true(
  (SELECT qty = 6 FROM public.events WHERE id = '${ID.positive}'),
  'positive integer qty was not stored'
);`));

    const weightValidation = [
      ['14. WEIGHT mode with NULL weight is rejected', 'NULL'],
      ['15. zero weight is rejected', '0'],
      ['16. negative weight is rejected', '-1'],
    ];
    for (const [name, weight] of weightValidation) {
      await check(name, authenticatedScript(
        expectedFailure(rpc(ID.decimalWeight, 'WEIGHT', '1', weight), '22023', 'finite number greater than zero', `(SELECT qty = 2 FROM public.events WHERE id = '${ID.decimalWeight}')`),
      ));
    }

    await check('17. decimal positive weight is accepted', authenticatedScript(`
${rpc(ID.decimalWeight, 'WEIGHT', '1', '681.5')};
RESET ROLE;
SELECT test_fixture.assert_true(
  (SELECT qty = 1 AND notes LIKE '%[WEIGHT_G=681.5]%' FROM public.events WHERE id = '${ID.decimalWeight}'),
  'decimal positive weight was not stored'
);`));

    await check('18. QUANTITY mode with non-NULL weight is rejected', authenticatedScript(
      expectedFailure(rpc(ID.pendingQty, 'QUANTITY', '7', '681.5'), '22023', 'Weight must be null', `(SELECT qty = 2 FROM public.events WHERE id = '${ID.pendingQty}')`),
    ));

    await check('19. QUANTITY mode removes all scale tags', authenticatedScript(`
${rpc(ID.pendingQty, 'QUANTITY', '7')};
RESET ROLE;
SELECT test_fixture.assert_true(
  (SELECT notes NOT LIKE '%[WEIGHT_G=%'
      AND notes NOT LIKE '%[BOTTLE_STATE=%'
      AND notes NOT LIKE '%[TARE_WEIGHT_G=%'
      AND notes NOT LIKE '%[FULL_WEIGHT_G=%'
      AND notes NOT LIKE '%[REMAINING_PERCENT=%'
      AND notes NOT LIKE '%[LIQUID_WEIGHT_G=%'
      AND notes NOT LIKE '%[REMAINING_ML=%'
      AND notes NOT LIKE '%[WEIGHT_PROFILE_SOURCE=%'
      AND notes NOT LIKE '%[WEIGHT_PROFILE_NEEDED=%'
      AND notes NOT LIKE '%[MEASUREMENT_SOURCE=%'
      AND notes NOT LIKE '%[BARBACK_WEIGHT_MVP=%'
   FROM public.events WHERE id = '${ID.pendingQty}'),
  'one or more scale tags survived QUANTITY correction'
);`));

    await check('20. QUANTITY mode preserves human text', `SELECT test_fixture.assert_true(
  (SELECT notes LIKE 'Human note%tail' FROM public.events WHERE id = '${ID.pendingQty}'),
  'human note text was not preserved'
);`);

    await check('21. QUANTITY mode preserves unrelated metadata', `SELECT test_fixture.assert_true(
  (SELECT notes LIKE '%[SOME_TAG=x]%' FROM public.events WHERE id = '${ID.pendingQty}'),
  'unrelated metadata was removed'
);`);

    await check('22. QUANTITY mode stores the selected integer', `SELECT test_fixture.assert_true(
  (SELECT qty = 7 FROM public.events WHERE id = '${ID.pendingQty}'),
  'selected integer qty was not stored'
);`);

    await check('23. duplicate WEIGHT_G tags become exactly one', authenticatedScript(`
${rpc(ID.pendingWeight, 'WEIGHT', '1', '681.500')};
RESET ROLE;
SELECT test_fixture.assert_true(
  (SELECT (length(notes) - length(replace(notes, '[WEIGHT_G=', ''))) / length('[WEIGHT_G=') = 1
   FROM public.events WHERE id = '${ID.pendingWeight}'),
  'WEIGHT correction did not produce exactly one WEIGHT_G tag'
);`));

    await check('24. decimal weight is normalized from 681.500 to 681.5', `SELECT test_fixture.assert_true(
  (SELECT notes LIKE '%[WEIGHT_G=681.5]%' AND notes NOT LIKE '%681.500%'
   FROM public.events WHERE id = '${ID.pendingWeight}'),
  'decimal weight was not normalized'
);`);

    await check('25. WEIGHT mode preserves bottle, remaining, and profile metadata', `SELECT test_fixture.assert_true(
  (SELECT notes LIKE '%[BOTTLE_STATE=SEALED]%'
      AND notes LIKE '%[REMAINING_PERCENT=50]%'
      AND notes LIKE '%[WEIGHT_PROFILE_SOURCE=MEASURED]%'
   FROM public.events WHERE id = '${ID.pendingWeight}'),
  'existing weight metadata was not preserved'
);`);

    await check('26. WEIGHT mode does not invent PARTIAL or remaining values', authenticatedScript(`
${rpc(ID.pendingPlainWeight, 'WEIGHT', '1', '500.25')};
RESET ROLE;
SELECT test_fixture.assert_true(
  (SELECT notes = 'Plain human note [SOME_TAG=z] [WEIGHT_G=500.25]'
   FROM public.events WHERE id = '${ID.pendingPlainWeight}'),
  'WEIGHT mode invented or altered metadata beyond WEIGHT_G'
);`));

    await check('27. success creates exactly one complete matching audit row', `SELECT test_fixture.assert_true(
  (SELECT count(*) = 1
     AND bool_and(venue_id = '${ID.venueA}'::uuid)
     AND bool_and(actor_user_id = '${ID.managerA}'::uuid)
     AND bool_and(correction_mode = 'QUANTITY')
     AND bool_and(old_qty = 2)
     AND bool_and(new_qty = 7)
     AND bool_and(old_notes LIKE 'Human note%[WEIGHT_G=681.500]%')
     AND bool_and(new_notes = 'Human note [SOME_TAG=x] tail')
     AND bool_and(transaction_id IS NOT NULL)
   FROM public.event_correction_audit
   WHERE event_id = '${ID.pendingQty}'),
  'audit row was missing, duplicated, or incomplete'
);`);

    await check('28. audit failure rolls back the Event update atomically', `
BEGIN;
CREATE FUNCTION test_fixture.reject_audit_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'fixture rejects audit authorization';
END
$$;
CREATE TRIGGER test_reject_audit_insert
BEFORE INSERT ON public.event_correction_audit
FOR EACH ROW EXECUTE FUNCTION test_fixture.reject_audit_insert();
SET LOCAL ROLE authenticated;
${claims()}
${expectedFailure(rpc(ID.atomic, 'QUANTITY', '8'), '42501', 'fixture rejects audit authorization', `(SELECT qty = 2 FROM public.events WHERE id = '${ID.atomic}') AND (SELECT count(*) = 0 FROM public.event_correction_audit WHERE event_id = '${ID.atomic}')`)}
ROLLBACK;`);

    await check('29. direct authenticated UPDATE of events.qty still fails', authenticatedScript(
      expectedFailure(`UPDATE public.events SET qty = 10 WHERE id = '${ID.forged}'`, '42501', 'permission denied', `(SELECT qty = 2 FROM public.events WHERE id = '${ID.forged}')`),
    ));

    await check('30. authenticated has no direct qty column grant', `SELECT test_fixture.assert_true(
  NOT has_column_privilege('authenticated', 'public.events', 'qty', 'UPDATE'),
  'authenticated unexpectedly has UPDATE(qty) privilege'
);`);

    await check('31. service_role maintenance bypass still functions', `
BEGIN;
SET LOCAL ROLE service_role;
${claims(ID.submitted, 'service_role')}
UPDATE public.events SET qty = 11 WHERE id = '${ID.forged}';
RESET ROLE;
SELECT test_fixture.assert_true(
  (SELECT qty = 11 FROM public.events WHERE id = '${ID.forged}'),
  'service_role maintenance update was blocked'
);
ROLLBACK;`);

    await check('32. forged correction token without audit cannot mutate qty', authenticatedScript(`
SELECT set_config('barinv.pending_event_correction_token', '${ID.missing}', true);
${expectedFailure(`PERFORM test_fixture.attempt_event_update('${ID.forged}'::uuid, 12, 'forged')`, '42501', 'protected fields are immutable', `(SELECT qty = 2 AND notes = 'Forged fixture' FROM public.events WHERE id = '${ID.forged}')`)}
`));

    await check('33. mismatched audit row cannot authorize mutation', `
BEGIN;
INSERT INTO public.event_correction_audit (
  id, transaction_id, event_id, venue_id, actor_user_id, correction_mode,
  old_qty, new_qty, old_notes, new_notes
) VALUES (
  '${ID.missing}', txid_current(), '${ID.forged}', '${ID.venueA}', '${ID.managerA}',
  'QUANTITY', 2, 999, 'Forged fixture', 'mismatched'
);
SET LOCAL ROLE authenticated;
${claims()}
SELECT set_config('barinv.pending_event_correction_token', '${ID.missing}', true);
${expectedFailure(`PERFORM test_fixture.attempt_event_update('${ID.forged}'::uuid, 12, 'mismatched')`, '42501', 'protected fields are immutable', `(SELECT qty = 2 AND notes = 'Forged fixture' FROM public.events WHERE id = '${ID.forged}')`)}
ROLLBACK;`);

    await check('34. authenticated client cannot mutate event_correction_audit', authenticatedScript(`
${expectedFailure(`INSERT INTO public.event_correction_audit (id, transaction_id, event_id, venue_id, actor_user_id, correction_mode, old_qty, new_qty) VALUES ('${ID.missing}', txid_current(), '${ID.forged}', '${ID.venueA}', '${ID.managerA}', 'QUANTITY', 2, 3)`, '42501', 'permission denied', 'true')}
SET LOCAL ROLE authenticated;
${claims()}
${expectedFailure(`UPDATE public.event_correction_audit SET new_qty = 99 WHERE event_id = '${ID.pendingQty}'`, '42501', 'permission denied', 'true')}
SET LOCAL ROLE authenticated;
${claims()}
${expectedFailure(`DELETE FROM public.event_correction_audit WHERE event_id = '${ID.pendingQty}'`, '42501', 'permission denied', `(SELECT count(*) = 1 FROM public.event_correction_audit WHERE event_id = '${ID.pendingQty}')`)}
`));

    await check('35. successful RPC changes only qty and notes', `
BEGIN;
CREATE TEMP TABLE event_before AS
SELECT to_jsonb(e) - 'qty' - 'notes' AS protected_fields
FROM public.events AS e
WHERE id = '${ID.scope}';
SET LOCAL ROLE authenticated;
${claims()}
${rpc(ID.scope, 'WEIGHT', '1', '420.5')};
RESET ROLE;
SELECT test_fixture.assert_true(
  (SELECT protected_fields FROM event_before) =
    (SELECT to_jsonb(e) - 'qty' - 'notes' FROM public.events AS e WHERE id = '${ID.scope}'),
  'RPC changed a field other than qty or notes'
);
SELECT test_fixture.assert_true(
  (SELECT qty = 1 AND notes = 'Scope fixture [WEIGHT_G=420.5]'
   FROM public.events WHERE id = '${ID.scope}'),
  'RPC did not make the expected qty/notes change'
);
COMMIT;`);

    await t.test('36. real RPC source contains SELECT ... FOR UPDATE lock', () => {
      const selectIndex = correctionMigration.indexOf('SELECT e.*');
      const updateIndex = correctionMigration.indexOf('FOR UPDATE;', selectIndex);
      assert.notEqual(selectIndex, -1, 'real migration is missing the Event SELECT');
      assert.notEqual(updateIndex, -1, 'real migration is missing SELECT ... FOR UPDATE');
      assert.match(
        correctionMigration.slice(selectIndex, updateIndex + 'FOR UPDATE;'.length),
        /WHERE e\.id = p_event_id\s+AND e\.venue_id = p_venue_id\s+FOR UPDATE;/,
        'real RPC does not lock the scoped Event row',
      );
    });
  } finally {
    if (created) {
      const removed = docker(['rm', '--force', container]);
      if (removed.status !== 0) {
        console.error(`# WARNING: failed to remove disposable container ${container}: ${removed.stderr.trim()}`);
      } else {
        console.log(`# removed disposable container: ${container}`);
      }
    }
  }
});
