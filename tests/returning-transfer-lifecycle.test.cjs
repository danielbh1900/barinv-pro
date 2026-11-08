const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require('node:path').join(__dirname, '../staff/index.html'), 'utf8');
const transfer = source.slice(
  source.indexOf('// STAFF_TRANSFER_PHASE3D_START'),
  source.indexOf('// STAFF_TRANSFER_PHASE3D_END') + '// STAFF_TRANSFER_PHASE3D_END'.length
);
function eventRow(record, overrides = {}) {
  return { ...record, id: 'event-verified-1', staff_id: null, source: null, session_id: null, ...overrides };
}
function harness() {
  const nodes = Object.fromEntries(['staff-transfer-save', 'staff-transfer-error', 'staff-transfer-result',
    'staff-transfer-weight', 'staff-shell-transfer', 'staff-shell-dispatch'].map(id => [id, { id, dataset: {}, style: {}, value: '', disabled: false, textContent: '', className: '' }]));
  nodes['staff-shell-transfer'].style.display = 'block';
  nodes['staff-shell-dispatch'].style.display = 'none';
  const calls = { writes: [], reads: [], receipts: [], navigation: [] };
  let writeResponder = record => ({ data: [eventRow(record)], error: null });
  let readResponder = () => ({ data: [], error: null });
  let navigationFails = false;
  const sandbox = {
    APP_MODE: 'staff',
    SESSION: { type: 'barback', venueId: 'venue-1', user: {
      staff_id: 'staff-1', assignment_id: 'assignment-1', nightId: 'night-1', name: 'Employee A',
      session_id: 'session-1', allowed_bar_ids: ['bar-a', 'bar-b']
    }, cache: { authorizedBars: [{ id: 'bar-a', name: 'B1', active: true }, { id: 'bar-b', name: 'B2', active: true }],
      takingItems: [{ id: 'item-1', name: 'Finlandia', active: true }] } },
    document: { getElementById: id => nodes[id] || null, querySelectorAll: () => [] },
    crypto: { randomUUID: () => 'transfer-attempt-1' },
    staffOperationalGuard: () => true,
    STAFF_ATTEMPT_PRIOR: new Map(),
    staffAttemptEntryKey: mode => `venue-1/staff-1/night-1|${mode}`,
    staffAttemptOnEntry: async () => {},
    staffAttemptHandlePrior: async () => false,
    staffMovementReviewBeforeWrite: async () => {},
    staffAttemptBeforeWrite: async () => {},
    staffAttemptVerified: async () => {},
    staffAttemptReleaseCompleted: async () => {},
    staffAttemptReportVerifiedLocalFailure: () => false,
    staffAttemptRejected: async () => {},
    staffAttemptReceiptAck: (_mode, batch) => batch.ack,
    staffUnverifiedWriteScopeKey: () => 'venue-1/staff-1/night-1',
    hydrateStaffAuthorizedBars: async () => {},
    staffBarIdentityText: bar => bar.name,
    staffScaleCalculate: () => ({ qty: 0.5 }),
    staffScaleNote: () => '[MEASURED]',
    staffMovementRecordVerified: (mode, batch) => calls.receipts.push([mode, batch.record.client_event_id]),
    showStaffShellView: view => {
      calls.navigation.push(view);
      if (navigationFails) throw new Error('navigation failed');
      nodes['staff-shell-transfer'].style.display = view === 'transfer' ? 'block' : 'none';
      nodes['staff-shell-dispatch'].style.display = view === 'dispatch' ? 'block' : 'none';
    },
    SB: { from: table => {
      assert.equal(table, 'events');
      return {
        insert: record => {
          calls.writes.push(record);
          return { select: () => writeResponder(record) };
        },
        select: fields => ({
          eq(field, value) { calls.reads.push([field, value]); return this; },
          limit: () => readResponder()
        })
      };
    } }
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(transfer, context);
  vm.runInContext("STAFF_TRANSFER_STATE = { sourceBar:'bar-a', destinationBar:'bar-b', itemId:'item-1', qty:2, clientEventId:'', measurement:null }", context);
  return {
    context, nodes, calls,
    setWrite: fn => { writeResponder = fn; },
    setRead: fn => { readResponder = fn; },
    failNavigation: value => { navigationFails = value; },
    run: expr => vm.runInContext(expr, context),
    state: () => vm.runInContext('STAFF_TRANSFER_STATE', context),
    batch: () => vm.runInContext('STAFF_TRANSFER_SUBMISSION', context)
  };
}

test('Transfer verified acknowledgment consumes exact draft, exits, and re-entry is fresh', async () => {
  const h = harness();
  await h.run('saveStaffTransfer()');
  assert.equal(h.calls.writes.length, 1);
  assert.equal(h.calls.writes[0].client_event_id, 'transfer-attempt-1');
  assert.equal(h.batch().phase, 'completed');
  assert.equal(h.state().qty, 0);
  assert.equal(h.state().sourceBar, '');
  assert.equal(h.nodes['staff-shell-dispatch'].style.display, 'block');
  assert.match(h.nodes['staff-transfer-result'].textContent, /PENDING/);
  assert.equal(h.calls.receipts.length, 1);
  h.run('openStaffTransfer()');
  assert.equal(h.state().itemId, '');
  assert.equal(h.calls.writes.length, 1);
});

test('Transfer double tap freezes one batch and emits one write', async () => {
  const h = harness();
  let resolveWrite;
  h.setWrite(record => new Promise(resolve => { resolveWrite = () => resolve({ data: [eventRow(record)], error: null }); }));
  const first = h.run('saveStaffTransfer()');
  await new Promise(resolve => setImmediate(resolve));
  const second = h.run('saveStaffTransfer()');
  assert.equal(h.calls.writes.length, 1);
  assert.equal(h.nodes['staff-transfer-save'].disabled, true);
  resolveWrite();
  await Promise.all([first, second]);
  assert.equal(h.calls.writes.length, 1);
  assert.equal(h.batch().phase, 'completed');
});

test('Transfer definite SQL rejection keeps draft and exposes error', async () => {
  const h = harness();
  h.setWrite(() => ({ data: null, error: { code: '22023', message: 'validated rejection' } }));
  await h.run('saveStaffTransfer()');
  assert.equal(h.batch().phase, 'rejected');
  assert.equal(h.state().qty, 2);
  assert.match(h.nodes['staff-transfer-error'].textContent, /validated rejection/);
  assert.equal(h.calls.reads.length, 0);
});

test('Transfer lost response blocks replay; Check status only reads exact ID', async () => {
  const h = harness();
  h.setWrite(() => { throw new Error('lost response'); });
  await h.run('saveStaffTransfer()');
  assert.equal(h.batch().phase, 'unknown');
  assert.equal(h.state().qty, 2);
  assert.equal(h.nodes['staff-transfer-save'].textContent, 'Check status');
  h.setRead(() => ({ data: [], error: null }));
  await h.run('saveStaffTransfer()');
  assert.equal(h.calls.writes.length, 1);
  assert.equal(h.batch().phase, 'unknown');
  assert(h.calls.reads.some(([key, value]) => key === 'client_event_id' && value === 'transfer-attempt-1'));
  assert.equal(h.run('staffTransferCanEdit()'), false);
});

test('Transfer readback rejects wrong destination and accepts exact scoped row', async () => {
  const h = harness();
  h.setWrite(() => { throw new Error('lost response'); });
  await h.run('saveStaffTransfer()');
  h.setRead(() => ({ data: [eventRow(h.calls.writes[0], { destination_bar_id: 'bar-other' })], error: null }));
  await h.run('saveStaffTransfer()');
  assert.equal(h.batch().phase, 'unknown');
  h.setRead(() => ({ data: [eventRow(h.calls.writes[0])], error: null }));
  await h.run('saveStaffTransfer()');
  assert.equal(h.batch().phase, 'completed');
  assert.equal(h.calls.writes.length, 1);
});

test('Transfer completion navigation failure can retry without second write or receipt', async () => {
  const h = harness();
  h.failNavigation(true);
  await h.run('saveStaffTransfer()');
  assert.equal(h.batch().phase, 'verified');
  assert.equal(h.state().qty, 0);
  assert.equal(h.calls.receipts.length, 1);
  h.failNavigation(false);
  await h.run('saveStaffTransfer()');
  assert.equal(h.batch().phase, 'completed');
  assert.equal(h.calls.writes.length, 1);
  assert.equal(h.calls.receipts.length, 1);
});

test('Returning verified cleanup consumes submitted screen but preserves foreign draft', () => {
  const start = source.indexOf('function staffReturningClearSubmittedDraft(batch) {');
  const end = source.indexOf('\nfunction staffReturningNewClientId()', start);
  const qty = { id: 'staff-returning-qty-item-1', value: '2', dataset: {} };
  const weight = { id: 'staff-returning-weight-item-1', value: '124', dataset: { staffWeightEdited: '1' } };
  const context = vm.createContext({ document: { querySelectorAll: () => [qty, weight] } });
  vm.runInContext("let STAFF_RETURNING_STATE = {'item-1':2}; let STAFF_RETURNING_DOM_DRAFT = {contextKey:'scope',fields:{manual:'124'},focus:null}; let STAFF_RETURNING_DETAIL_ID = 'item-1';", context);
  vm.runInContext(source.slice(start, end), context);
  vm.runInContext('staffReturningClearSubmittedDraft({preserveCurrentDraft:false})', context);
  assert.equal(vm.runInContext('Object.keys(STAFF_RETURNING_STATE).length', context), 0);
  assert.equal(vm.runInContext('Object.keys(STAFF_RETURNING_DOM_DRAFT.fields).length', context), 0);
  assert.equal(qty.value, '0');
  assert.equal(weight.value, '');
  vm.runInContext("STAFF_RETURNING_STATE = {'other-item':3}", context);
  vm.runInContext('staffReturningClearSubmittedDraft({preserveCurrentDraft:true})', context);
  assert.equal(vm.runInContext("STAFF_RETURNING_STATE['other-item']", context), 3);
});

test('Returning completed re-entry drops source Bar and opens fresh draft', async () => {
  const start = source.indexOf('async function openStaffReturning() {');
  const end = source.indexOf('\nasync function saveStaffReturning()', start);
  let shown = '';
  const user = { staff_id: 'staff-1', assignment_id: 'assignment-1', nightId: 'night-1', allowed_bar_ids: ['bar-a'] };
  const context = vm.createContext({
    STAFF_WORKSPACE_UI: { entries: { returning: { user, key: 'scope-key' } } },
    staffOperationalGuard: () => true,
    staffReturningResetObsoleteSubmission: () => {},
    staffReturningRenderResult: () => {},
    staffReturningHasDrafts: () => false,
    staffWorkspaceScope: () => ({ user, key: 'scope-key' }),
    staffReturningBars: () => [{ id: 'bar-a' }],
    staffReturningSetError: () => {},
    staffAttemptOnEntry: async () => {},
    showStaffShellView: view => { shown = view; },
    hydrateStaffReturningHistory: async () => {},
    renderStaffReturning: () => {}
  });
  vm.runInContext("let STAFF_RETURNING_SUBMISSION = {phase:'completed'}; let STAFF_RETURNING_SOURCE_BAR='bar-a'; let STAFF_RETURNING_STATE={'item-1':2}; let STAFF_RETURNING_ERROR='old';", context);
  vm.runInContext(source.slice(start, end), context);
  await vm.runInContext('openStaffReturning()', context);
  assert.equal(shown, 'returning');
  assert.equal(vm.runInContext('STAFF_RETURNING_SOURCE_BAR', context), '');
  assert.equal(vm.runInContext('Object.keys(STAFF_RETURNING_STATE).length', context), 0);
});

test('Returning completed prior batch does not clear a newer source-Bar draft on re-entry', async () => {
  const start = source.indexOf('async function openStaffReturning() {');
  const end = source.indexOf('\nasync function saveStaffReturning()', start);
  let shown = '', observedSource = '';
  const user = { staff_id: 'staff-1', assignment_id: 'assignment-1', nightId: 'night-1', allowed_bar_ids: ['bar-a'] };
  const context = vm.createContext({
    STAFF_WORKSPACE_UI: { entries: { returning: { user, key: 'scope-key' } } },
    staffOperationalGuard: () => true,
    staffReturningResetObsoleteSubmission: () => {},
    staffReturningRenderResult: () => {},
    staffReturningHasDrafts: () => { observedSource = vm.runInContext('STAFF_RETURNING_SOURCE_BAR', context); return true; },
    staffWorkspaceScope: () => ({ user, key: 'scope-key' }),
    staffReturningBars: () => [{ id: 'bar-a' }],
    staffReturningSetError: () => {},
    showStaffShellView: view => { shown = view; },
    hydrateStaffReturningHistory: async () => {},
    renderStaffReturning: () => {}
  });
  vm.runInContext("let STAFF_RETURNING_SUBMISSION = {phase:'completed'}; let STAFF_RETURNING_SOURCE_BAR='bar-a'; let STAFF_RETURNING_STATE={'new-item':3}; let STAFF_RETURNING_ERROR='';", context);
  vm.runInContext(source.slice(start, end), context);
  await vm.runInContext('openStaffReturning()', context);
  assert.equal(shown, 'returning');
  assert.equal(observedSource, 'bar-a');
  assert.equal(vm.runInContext('STAFF_RETURNING_SOURCE_BAR', context), 'bar-a');
  assert.equal(vm.runInContext("STAFF_RETURNING_STATE['new-item']", context), 3);
});
