const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../staff/index.html'), 'utf8');
function slice(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `${start} → ${end}`);
  return source.slice(a, b);
}
const movement = [
  slice('function staffWorkspaceOpenMovement(mode)', 'function staffWorkspaceAction()'),
  slice('let STAFF_OPENING_STATE = {};', 'function staffOpeningSetError('),
  slice('function staffOpeningSetError(', 'let STAFF_TAKING_STATE = {};'),
  slice('let STAFF_TAKING_STATE = {};', "let STAFF_SCALE_ACTIVE_MODE = ''"),
  slice('function staffTakingContextKey()', 'function staffTakingReadQty('),
  slice('function openStaffTaking()', "let STAFF_RETURNING_SOURCE_BAR = ''"),
  slice('function staffScreenRefreshBlocked()', 'function staffScreenRefreshConflict()')
].join('\n');

function harness() {
  const elements = new Map();
  const el = id => {
    if (!elements.has(id)) elements.set(id, {
      id, value: '', textContent: '', className: '', disabled: false, style: { display: '' },
      querySelectorAll: () => [], getClientRects: () => [1]
    });
    return elements.get(id);
  };
  el('staff-shell-opening').style.display = 'block';
  el('staff-shell-dispatch').style.display = 'none';
  el('staff-shell-taking').style.display = 'block';
  el('staff-taking-source').value = 'Main Liquor Room';
  el('staff-dashboard').dataset = { staffView: 'taking' };
  const user = { staff_id: 'staff-1', assignment_id: 'assignment-1', nightId: 'night-1', session_id: 'session-1', name: 'Synthetic Operator', allowed_bar_ids: ['bar-1'] };
  const ctx = {
    document: { getElementById: el }, APP_MODE: 'staff', SESSION: { type: 'barback', venueId: 'venue-1', user },
    crypto: { randomUUID: () => 'synthetic-op-1' },
    STAFF_ITEM_FILTERS: { taking: { query: '', category: '' } },
    STAFF_SCALE_CONTEXT: { mode: 'taking', itemId: 'item-1' }, STAFF_SCALE_ACTIVE_MODE: 'taking',
    STAFF_RETURNING_SAVING: false, STAFF_TRANSFER_SAVING: false, STAFF_RETURNING_SUBMISSION: null,
    STAFF_TRANSFER_WRITE_UNCERTAIN: new Set(), STAFF_TRANSFER_SUBMISSION: null, staffUnverifiedWriteScopeKey: () => 'synthetic-scope',
    staffOperationalGuard: () => true,
    // The lifecycle tests isolate the existing movement flow. The journal and
    // recent-movement contract have their own integrated synthetic fixtures.
    STAFF_ATTEMPT_PRIOR: new Map(),
    staffAttemptEntryKey: mode => `synthetic-scope|${mode}`,
    staffAttemptOnEntry: async () => {},
    staffAttemptHandlePrior: async () => false,
    staffMovementReviewBeforeWrite: async () => {},
    staffAttemptBeforeWrite: async () => {},
    staffAttemptVerified: async () => {},
    staffAttemptReleaseCompleted: async () => {},
    staffAttemptReportVerifiedLocalFailure: () => false,
    staffAttemptRejected: async () => {},
    staffAttemptReceiptAck: (_mode, batch) => batch.ack,
    staffTakingCloseDetail: () => {}, staffOpeningCloseDetail: () => {},
    staffReturningSetError: () => {}, staffTransferSetError: () => {},
    staffSetActiveSection: () => {}, staffScaleClearConfirmedMeasurements: () => {},
    staffWorkspaceNavigate: view => { el('staff-dashboard').dataset.staffView = view; },
    staffTakingWeightDrafts: () => ({}),
    staffTakingValidateState: () => {},
    staffTakingRows: () => ctx.rows,
    staffScaleProfile: item => item.profile || null,
    staffScreenRefreshEqual: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    staffScaleNote: () => '[WEIGHT_G=200]',
    hydrateStaffAuthorizedBars: async () => [{ id: 'bar-1' }],
    hydrateStaffTakingItems: async () => [{ id: 'item-1' }],
    showStaffShellView: view => {
      el('staff-shell-opening').style.display = view === 'opening' ? 'block' : 'none';
      el('staff-shell-taking').style.display = view === 'taking' ? 'block' : 'none';
      el('staff-shell-dispatch').style.display = view === 'dispatch' ? 'block' : 'none';
    },
    renderStaffTaking: () => {},
    rows: [{ item: { id: 'item-1', name: 'Synthetic bottle' }, bar: { id: 'bar-1' }, type: 'taken', action: 'DELIVERED', qty: 2, measurement: null }],
    receipts: [], staffMovementRecordVerified(mode, batch) {
      if (batch.context.userRef !== ctx.SESSION.user) return false;
      ctx.receipts.push({ mode, batch }); return true;
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(movement, ctx);
  return { ctx, el, run: code => vm.runInContext(code, ctx) };
}
function ack(records) {
  return records.map((r, i) => ({ ...r, id: `db-${i}`, staff_id: null, source: null, session_id: null }));
}

test('Opening verified completion clears only submitted draft, records one receipt, and preserves PAR defaults', () => {
  const { ctx, run, el } = harness();
  run('STAFF_OPENING_STATE = {"item-1::bar-1": 2}');
  const context = run('staffOpeningContext()');
  const record = { client_event_id: 'staff-opening-synthetic', id: 'db-0', venue_id: 'venue-1', night_id: 'night-1', bar_id: 'bar-1', item_id: 'item-1', qty: 2, action: 'DELIVERED', status: 'PENDING', submitted_by: ctx.SESSION.user.name, notes: '', staff_id: null, source: null, session_id: null };
  const batch = { context, records: [record], draftKey: JSON.stringify({ 'item-1::bar-1': 2 }), ack: { acknowledged: 1, missing: 0, mismatched: 0, unexpected: 0, statuses: { PENDING: 1 }, rows: [record] } };
  ctx.batch = batch;
  run('STAFF_OPENING_SUBMISSION = batch; staffOpeningComplete(batch)');
  assert.equal(batch.phase, 'completed', el('staff-opening-error').textContent);
  assert.equal(run('staffOpeningQuantity({id:"item-1",par_level:4},{id:"bar-1"})'), 4);
  assert.equal(run('JSON.stringify(STAFF_OPENING_STATE)'), '{}');
  assert.match(el('staff-opening-result').textContent, /PENDING: 1/);
  run('staffOpeningComplete(batch, true)');
  assert.equal(ctx.receipts.length, 1);
  ctx.SESSION.user = { ...ctx.SESSION.user, nightId: 'night-2' };
  assert.equal(run('staffOpeningQuantity({id:"item-1",par_level:4},{id:"bar-1"})'), 4);
});

test('Taking full acknowledgment freezes row IDs, clears exact draft and reaches Dispatch once', async () => {
  const { ctx, run, el } = harness();
  run('STAFF_TAKING_STATE = {"item-1": {taken:2,comp:0,shot:0}}; STAFF_TAKING_SELECTED_BARS = ["bar-1"]');
  el('staff-taking-ticket').value = 'SYNTH'; el('staff-taking-note').value = 'Fixture';
  let inserts = 0;
  ctx.SB = { from: () => ({ insert: records => { inserts++; return { select: async () => ({ data: ack(records), error: null }) }; } }) };
  await run('saveStaffTaking()');
  const batch = run('STAFF_TAKING_SUBMISSION');
  assert.equal(inserts, 1);
  assert.equal(batch.phase, 'completed', el('staff-taking-error').textContent);
  assert.match(batch.records[0].client_event_id, /^staff-taking-synthetic-op-1-0$/);
  assert.equal(run('JSON.stringify(STAFF_TAKING_STATE)'), '{}');
  assert.equal(run('STAFF_TAKING_SELECTED_BARS.length'), 0);
  assert.equal(el('staff-taking-ticket').value, '');
  assert.equal(el('staff-taking-note').value, '');
  assert.equal(el('staff-shell-dispatch').style.display, 'block');
  assert.match(el('staff-taking-result').textContent, /PENDING: 1/);
  assert.equal(ctx.receipts.length, 1);
  await run('saveStaffTaking()');
  assert.equal(inserts, 1);
});

test('Taking verified older batch does not clear a newer unsent edit', () => {
  const { ctx, run, el } = harness();
  run('STAFF_TAKING_STATE = {"item-1": {taken:2,comp:0,shot:0}}; STAFF_TAKING_SELECTED_BARS = ["bar-1"]');
  const context = run('staffOpeningContext()');
  const draftKey = run('staffTakingDraftKey()');
  const record = { client_event_id: 'client-older', venue_id: 'venue-1', night_id: 'night-1',
    bar_id: 'bar-1', item_id: 'item-1', qty: 2, action: 'DELIVERED', status: 'PENDING' };
  ctx.batch = { context, records: [record], draftKey, writeScope: 'synthetic-scope', operationId: 'older-operation',
    ack: { acknowledged: 1, missing: 0, mismatched: 0, unexpected: 0, statuses: { PENDING: 1 }, rows: [record] } };
  run('STAFF_TAKING_SUBMISSION = batch; STAFF_TAKING_STATE["item-1"].taken = 7; staffTakingComplete(batch)');
  assert.equal(run('STAFF_TAKING_STATE["item-1"].taken'), 7);
  assert.equal(ctx.batch.phase, 'verified');
  assert.equal(ctx.batch.completionError, true);
  assert.equal(el('staff-shell-taking').style.display, 'block');
  assert.match(el('staff-taking-error').textContent, /newer unsent edit remains/);
  assert.equal(ctx.receipts.length, 1);
});

test('Taking double tap sends only one frozen batch', async () => {
  const { ctx, run } = harness();
  run('STAFF_TAKING_STATE = {"item-1": {taken:2,comp:0,shot:0}}; STAFF_TAKING_SELECTED_BARS = ["bar-1"]');
  let inserts = 0, release;
  ctx.SB = { from: () => ({ insert: records => { inserts++; return { select: () => new Promise(resolve => { release = () => resolve({ data: ack(records), error: null }); }) }; } }) };
  const first = run('saveStaffTaking()');
  for (let i = 0; !release && i < 30; i++) await Promise.resolve();
  assert.equal(typeof release, 'function');
  await run('saveStaffTaking()');
  assert.equal(inserts, 1);
  release(); await first;
  assert.equal(run('STAFF_TAKING_SUBMISSION.phase'), 'completed');
});

test('Taking definite SQL rejection retains draft and reports actual error', async () => {
  const { ctx, run, el } = harness();
  run('STAFF_TAKING_STATE = {"item-1": {taken:2,comp:0,shot:0}}; STAFF_TAKING_SELECTED_BARS = ["bar-1"]');
  ctx.SB = { from: () => ({ insert: () => ({ select: async () => ({ data: null, error: { code: '22023', message: 'Synthetic invalid decimal' } }) }) }) };
  await run('saveStaffTaking()');
  assert.equal(run('STAFF_TAKING_SUBMISSION.phase'), 'rejected');
  assert.equal(run('STAFF_TAKING_STATE["item-1"].taken'), 2);
  assert.match(el('staff-taking-error').textContent, /Synthetic invalid decimal/);
  assert.equal(el('staff-taking-save').textContent, 'Save / Submit');
});

test('Taking lost response remains blocked; next tap is read-only exact-ID status', async () => {
  const { ctx, run, el } = harness();
  run('STAFF_TAKING_STATE = {"item-1": {taken:2,comp:0,shot:0}}; STAFF_TAKING_SELECTED_BARS = ["bar-1"]');
  let inserts = 0, reads = 0;
  ctx.SB = { from: () => ({
    insert: () => { inserts++; return { select: async () => { throw new Error('Synthetic connection drop'); } }; },
    select: () => ({ eq() { return this; }, in(column, ids) { assert.equal(column, 'client_event_id'); assert.equal(ids.length, 1); return this; }, limit: async () => { reads++; return { data: [], error: null }; } })
  }) };
  await run('saveStaffTaking()');
  assert.equal(run('STAFF_TAKING_SUBMISSION.phase'), 'unknown');
  assert.equal(run('STAFF_TAKING_STATE["item-1"].taken'), 2);
  assert.equal(el('staff-taking-save').textContent, 'Check status');
  await run('saveStaffTaking()');
  assert.equal(inserts, 1); assert.equal(reads, 1);
  assert.equal(run('STAFF_TAKING_SUBMISSION.phase'), 'unknown');
  assert.equal(run('staffTakingCanEdit()'), false);
});

test('Taking stale session response cannot clear a newer Staff draft', async () => {
  const { ctx, run } = harness();
  run('STAFF_TAKING_STATE = {"item-1": {taken:2,comp:0,shot:0}}; STAFF_TAKING_SELECTED_BARS = ["bar-1"]');
  let release, inserts = 0;
  ctx.hydrateStaffAuthorizedBars = () => new Promise(resolve => { release = () => resolve([{ id: 'bar-1' }]); });
  ctx.SB = { from: () => ({ insert: () => { inserts++; return { select: async () => ({ data: [], error: null }) }; } }) };
  const first = run('saveStaffTaking()');
  for (let i = 0; !release && i < 40; i++) await Promise.resolve();
  assert.equal(typeof release, 'function');
  ctx.SESSION.user = { ...ctx.SESSION.user, staff_id: 'staff-2' };
  release(); await first;
  assert.equal(inserts, 0);
  assert.equal(run('STAFF_TAKING_STATE["item-1"].taken'), 2);
  assert.equal(run('STAFF_TAKING_SAVING'), false);
});

test('Taking rejects a VIP-only item after refreshed Bar eligibility changes', async () => {
  const { ctx, run, el } = harness();
  run('STAFF_TAKING_STATE = {"item-1": {taken:2,comp:0,shot:0}}; STAFF_TAKING_SELECTED_BARS = ["bar-1"]');
  ctx.hydrateStaffAuthorizedBars = async () => [{ id: 'bar-1', bar_type: 'bar' }];
  ctx.hydrateStaffTakingItems = async () => [{ id: 'item-1', service_mode: 'vip_only' }];
  let inserts = 0;
  ctx.SB = { from: () => ({ insert: () => { inserts++; return { select: async () => ({ data: [], error: null }) }; } }) };
  await run('saveStaffTaking()');
  assert.equal(inserts, 0);
  assert.equal(run('STAFF_TAKING_STATE["item-1"].taken'), 2);
  assert.equal(run('STAFF_TAKING_SUBMISSION.phase'), 'rejected');
  assert.match(el('staff-taking-error').textContent, /outside the current Staff scope/);
});

test('Taking uncertain attempt blocks Cancel and Refresh; definite rejection permits Cancel', () => {
  const { ctx, run, el } = harness();
  run('STAFF_TAKING_STATE = {"item-1": {taken:2,comp:0,shot:0}}; STAFF_TAKING_SELECTED_BARS = ["bar-1"]');
  const context = run('staffOpeningContext()');
  const batch = { context, phase: 'unknown', records: [{ client_event_id: 'staff-taking-synthetic-op-1-0' }] };
  ctx.batch = batch;
  run('STAFF_TAKING_SUBMISSION = batch');
  assert.equal(run('staffScreenRefreshBlocked()'), true);
  assert.equal(run('staffWorkspaceCancelMovement("taking")'), false);
  assert.equal(run('STAFF_TAKING_STATE["item-1"].taken'), 2);
  assert.match(el('staff-taking-error').textContent, /unverified/);
  batch.phase = 'rejected';
  assert.equal(run('staffScreenRefreshBlocked()'), false);
  assert.equal(run('staffWorkspaceCancelMovement("taking")'), true);
  assert.equal(run('JSON.stringify(STAFF_TAKING_STATE)'), '{}');
  assert.equal(run('STAFF_TAKING_SELECTED_BARS.length'), 0);
  assert.equal(el('staff-dashboard').dataset.staffView, 'dispatch');
});

test('Taking in-flight submission blocks navigation until verification', () => {
  const { ctx, run, el } = harness();
  run(slice('function showStaffShellView(view, options = {})', 'function isAdminSession()'));
  const context = run('staffOpeningContext()');
  ctx.batch = { context, phase: 'sending', records: [] };
  run('STAFF_TAKING_SUBMISSION = batch; STAFF_TAKING_SAVING = true');
  run('showStaffShellView("dispatch")');
  assert.equal(el('staff-shell-taking').style.display, 'block');
  assert.equal(el('staff-shell-dispatch').style.display, 'none');
  assert.match(el('staff-taking-error').textContent, /still submitting/);
});

test('Taking restored-session POST keeps frozen IDs; next action is read-only exact-ID status', async () => {
  const { ctx, run, el } = harness();
  run('STAFF_TAKING_STATE = {"item-1": {taken:2,comp:0,shot:0}}; STAFF_TAKING_SELECTED_BARS = ["bar-1"]');
  let release, inserts = 0, reads = 0, submitted;
  ctx.SB = { from: table => {
    assert.equal(table, 'events');
    return {
      insert: records => {
        inserts++; submitted = records;
        return { select: () => new Promise(resolve => { release = () => resolve({ data: ack(records), error: null }); }) };
      },
      select: () => ({
        eq() { return this; },
        in(column, ids) { assert.equal(column, 'client_event_id'); assert.deepEqual(Array.from(ids), submitted.map(row => row.client_event_id)); return this; },
        limit: async () => { reads++; return { data: ack(submitted), error: null }; }
      })
    };
  } };
  const first = run('saveStaffTaking()');
  for (let i = 0; !release && i < 30; i++) await Promise.resolve();
  assert.equal(typeof release, 'function');
  ctx.SESSION.user = { ...ctx.SESSION.user }; // restoration creates a new object with the same canonical claims
  release(); await first;
  assert.equal(inserts, 1);
  assert.equal(run('STAFF_TAKING_STATE["item-1"].taken'), 2); // stale response cannot clear a draft
  assert.equal(run('STAFF_TAKING_RETAINED.size'), 1);
  await run('saveStaffTaking()');
  assert.equal(inserts, 1);
  assert.equal(reads, 1);
  assert.equal(run('STAFF_TAKING_RETAINED.get(staffUnverifiedWriteScopeKey()).phase'), 'verified');
  assert.equal(run('STAFF_TAKING_RETAINED.get(staffUnverifiedWriteScopeKey()).receiptRecorded'), true);
  assert.equal(ctx.receipts.length, 1);
  assert.match(el('staff-taking-error').textContent, /Taking saved/);
  assert.equal(run('STAFF_TAKING_STATE["item-1"].taken'), 2);
  assert.equal(run('staffTakingCanEdit()'), false);
  assert.equal(run('staffWorkspaceCancelMovement("taking")'), true);
  assert.equal(run('STAFF_TAKING_RETAINED.size'), 0);
  assert.equal(run('JSON.stringify(STAFF_TAKING_STATE)'), '{}');
});

test('Taking restored-session incomplete readback remains blocked and never resends', async () => {
  const { ctx, run } = harness();
  run('STAFF_TAKING_STATE = {"item-1": {taken:2,comp:0,shot:0}}; STAFF_TAKING_SELECTED_BARS = ["bar-1"]');
  let release, inserts = 0;
  ctx.SB = { from: () => ({
    insert: records => { inserts++; return { select: () => new Promise(resolve => { release = () => resolve({ data: [], error: null }); }) }; },
    select: () => ({ eq() { return this; }, in() { return this; }, limit: async () => ({ data: [], error: null }) })
  }) };
  const first = run('saveStaffTaking()');
  for (let i = 0; !release && i < 40; i++) await Promise.resolve();
  assert.equal(typeof release, 'function');
  ctx.SESSION.user = { ...ctx.SESSION.user };
  release(); await first;
  await run('saveStaffTaking()');
  assert.equal(inserts, 1);
  assert.equal(run('STAFF_TAKING_RETAINED.get(staffUnverifiedWriteScopeKey()).phase'), 'unknown');
  assert.equal(run('staffWorkspaceCancelMovement("taking")'), false);
  assert.equal(run('staffScreenRefreshBlocked()'), true);
  await run('saveStaffTaking()');
  assert.equal(inserts, 1);
});
