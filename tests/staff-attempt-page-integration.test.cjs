'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createStaffPageJournal } = require('../staff/staff-attempt-journal-v1.js');

const source = fs.readFileSync(path.join(__dirname, '../staff/index.html'), 'utf8');
const start = source.indexOf('// STAFF_ATTEMPT_INTEGRATION_START');
const end = source.indexOf('// STAFF_ATTEMPT_INTEGRATION_END', start);
assert.ok(start >= 0 && end > start, 'Staff journal integration is present');
const integration = source.slice(start, end);

class AtomicStore {
  constructor() { this.rows = new Map(); this.tail = Promise.resolve(); }
  async get(key) {
    await this.tail;
    return this.rows.has(key) ? structuredClone(this.rows.get(key)) : null;
  }
  update(key, decide) {
    const next = this.tail.then(() => {
      const before = this.rows.has(key) ? structuredClone(this.rows.get(key)) : null;
      const choice = decide(before);
      if (choice.write) this.rows.set(key, structuredClone(choice.write));
      return structuredClone(choice.result);
    });
    this.tail = next.then(() => {}, () => {});
    return next;
  }
}

function fixture(store, readRows = () => []) {
  let generated = 0, inserts = 0, cancelCalls = 0;
  const fields = new Map();
  const field = id => {
    if (!fields.has(id)) fields.set(id, { value: '', textContent: '', dataset: { staffView: 'taking' } });
    return fields.get(id);
  };
  const user = { staff_id: 'staff-synthetic', assignment_id: 'assignment-synthetic', nightId: 'night-synthetic',
    allowed_bar_ids: ['bar-synthetic', 'destination-synthetic'], name: 'Synthetic Operator' };
  const context = {
    APP_MODE: 'staff', SESSION: { type: 'barback', venueId: 'venue-synthetic', user },
    crypto: { randomUUID: () => `entry-${++generated}` },
    document: { getElementById: field },
    STAFF_OPENING_STATE: {}, STAFF_OPENING_DOM_DRAFT: { fields: {} },
    STAFF_TAKING_STATE: {}, STAFF_TAKING_SELECTED_BARS: [], STAFF_TAKING_WEIGHT_DRAFT: { fields: {} },
    STAFF_RETURNING_STATE: {}, STAFF_RETURNING_SOURCE_BAR: '', STAFF_RETURNING_DOM_DRAFT: { fields: {} },
    STAFF_TRANSFER_STATE: { itemId: '', qty: 0 },
    STAFF_OPENING_SAVING: false, STAFF_TAKING_SAVING: false, STAFF_RETURNING_SAVING: false, STAFF_TRANSFER_SAVING: false,
    STAFF_OPENING_SUBMISSION: null, STAFF_TAKING_SUBMISSION: null, STAFF_RETURNING_SUBMISSION: null, STAFF_TRANSFER_SUBMISSION: null,
    STAFF_OPENING_ACK_FIELDS: '*', STAFF_TRANSFER_ACK_FIELDS: '*',
    staffUnverifiedWriteScopeKey: () => 'venue-synthetic|staff-synthetic|night-synthetic',
    staffOpeningContext: () => ({ userRef: context.SESSION.user, key: 'canonical-context',
      venueId: context.SESSION.venueId, nightId: context.SESSION.user.nightId }),
    staffTakingLookupDraftContextKey: () => 'canonical-context',
    staffTakingAcknowledgment: (batch, rows) => {
      const expected = batch.records.map(row => row.client_event_id);
      const matches = rows.filter(row => expected.includes(row.client_event_id));
      return { total: expected.length, acknowledged: matches.length, missing: expected.length - matches.length,
        mismatched: 0, unexpected: rows.length - matches.length, statuses: { PENDING: matches.length }, rows: matches };
    },
    staffOpeningAcknowledgment: () => { throw Error('unexpected Opening verifier'); },
    staffReturningAcknowledgment: () => { throw Error('unexpected Returning verifier'); },
    staffTransferAcknowledgment: () => { throw Error('unexpected Transfer verifier'); },
    staffTakingSetError: message => { field('staff-taking-error').textContent = message; },
    staffTakingUpdateSaveButton: () => {},
    staffOpeningSetError: () => {}, staffOpeningUpdateSaveButton: () => {},
    staffReturningSetError: () => {}, staffReturningUpdateSaveButton: () => {},
    staffTransferSetError: () => {}, staffTransferRenderSubmitState: () => {},
    staffMovementRecordVerified: () => true,
    renderStaffTaking: () => {},
    staffOperationalGuard: () => true,
    staffWorkspaceCancelMovement: () => { cancelCalls++; return true; },
    SB: { from: table => {
      assert.equal(table, 'events');
      return {
        insert: () => { inserts++; throw Error('Journal integration must not call INSERT'); },
        select: () => ({ eq() { return this; }, in() { return this; }, limit: async () => ({ data: await readRows(), error: null }) })
      };
    } }
  };
  vm.createContext(context);
  vm.runInContext(integration, context);
  context.pageJournal = createStaffPageJournal({ projectRef: 'synthetic.supabase.co', store });
  vm.runInContext('STAFF_ATTEMPT_JOURNAL = pageJournal', context);
  const record = id => ({ client_event_id: id, venue_id: 'venue-synthetic', night_id: 'night-synthetic',
    bar_id: 'bar-synthetic', item_id: 'item-synthetic', qty: 2, action: 'DELIVERED', status: 'PENDING',
    submitted_by: 'Synthetic Operator', notes: '' });
  return {
    context, record, field,
    run: expression => vm.runInContext(expression, context),
    page: context.pageJournal,
    stats: () => ({ inserts, cancelCalls })
  };
}

test('page bridge freezes one Taking attempt; reload retains exact IDs and never writes again', async () => {
  const store = new AtomicStore();
  const first = fixture(store);
  first.run('STAFF_TAKING_STATE = {"item-synthetic": {taken:2}}; STAFF_TAKING_SELECTED_BARS = ["bar-synthetic"]');
  first.context.batch = { records: [first.record('client-stable-1')] };
  await first.run('staffAttemptBeforeWrite("taking", batch)');
  assert.equal(first.context.batch.journalAttemptId, 'client-stable-1');
  assert.equal((await first.page.get('taking', first.context.batch.journalClaims)).state, 'sending');

  const restored = fixture(store, () => []);
  assert.equal(await restored.run('staffAttemptHandlePrior("taking")'), true);
  assert.equal(restored.run('STAFF_TAKING_STATE["item-synthetic"].taken'), 2);
  assert.equal(restored.run('STAFF_ATTEMPT_PRIOR.size'), 1);
  restored.context.batch = { records: [restored.record('client-new-id')] };
  await assert.rejects(restored.run('staffAttemptBeforeWrite("taking", batch)'), /prior frozen movement/i);
  assert.equal(restored.stats().inserts, 0);
  assert.equal(await restored.run('staffAttemptCancelMovement("taking")'), false);
  assert.equal(restored.stats().cancelCalls, 0);
});

test('exact readback verifies frozen attempt and explicit Cancel permits a fresh entry', async () => {
  const store = new AtomicStore();
  const first = fixture(store);
  first.run('STAFF_TAKING_STATE = {"item-synthetic": {taken:2}}; STAFF_TAKING_SELECTED_BARS = ["bar-synthetic"]');
  first.context.batch = { records: [first.record('client-stable-2')] };
  await first.run('staffAttemptBeforeWrite("taking", batch)');
  const matched = { ...first.record('client-stable-2'), id: 'db-1' };
  const restored = fixture(store, () => [matched]);
  assert.equal(await restored.run('staffAttemptHandlePrior("taking")'), true);
  assert.equal(restored.run('STAFF_ATTEMPT_PRIOR.size'), 1);
  assert.match(restored.field('staff-taking-error').textContent, /saved and verified/);
  assert.equal(await restored.run('staffAttemptCancelMovement("taking")'), true, restored.field('staff-taking-error').textContent);
  assert.equal(restored.stats().cancelCalls, 1);
  assert.equal(restored.run('STAFF_ATTEMPT_PRIOR.size'), 0);
  restored.context.batch = { records: [restored.record('client-new-2')] };
  await restored.run('staffAttemptBeforeWrite("taking", batch)');
  assert.equal(restored.context.batch.journalAttemptId, 'client-new-2');
  assert.equal(restored.stats().inserts, 0);
});

test('complete live acknowledgment releases journal only when all exact IDs match', async () => {
  const store = new AtomicStore(), page = fixture(store);
  page.run('STAFF_TAKING_STATE = {"item-synthetic": {taken:2}}; STAFF_TAKING_SELECTED_BARS = ["bar-synthetic"]');
  page.context.batch = { records: [page.record('client-ack-1'), page.record('client-ack-2')] };
  await page.run('staffAttemptBeforeWrite("taking", batch)');
  page.context.ack = { acknowledged: 1, missing: 1, mismatched: 0, unexpected: 0,
    rows: [{ ...page.record('client-ack-1'), id: 'db-1' }] };
  await assert.rejects(page.run('staffAttemptVerified("taking", batch, ack)'), /All frozen client event IDs/);
  assert.equal((await page.page.get('taking', page.context.batch.journalClaims)).state, 'sending');
  page.context.ack = { acknowledged: 2, missing: 0, mismatched: 0, unexpected: 0,
    rows: [{ ...page.record('client-ack-1'), id: 'db-1' }, { ...page.record('client-ack-2'), id: 'db-2' }] };
  await page.run('staffAttemptVerified("taking", batch, ack)');
  assert.equal((await page.page.get('taking', page.context.batch.journalClaims)).state, 'verified');
  page.context.batch.phase = 'completed';
  await page.run('staffAttemptReleaseCompleted("taking", batch)');
  assert.equal((await page.page.get('taking', page.context.batch.journalClaims)).state, 'new_entry');
});

test('the page bridge journals each movement mode under its own canonical scope', async () => {
  const page = fixture(new AtomicStore());
  page.run('STAFF_OPENING_STATE = {"item-synthetic::bar-synthetic":3}');
  page.run('STAFF_TAKING_STATE = {"item-synthetic": {taken:2}}; STAFF_TAKING_SELECTED_BARS = ["bar-synthetic"]');
  page.run('STAFF_RETURNING_STATE = {"item-synthetic":1}; STAFF_RETURNING_SOURCE_BAR = "bar-synthetic"');
  page.run('STAFF_TRANSFER_STATE = {sourceBar:"bar-synthetic", destinationBar:"destination-synthetic", itemId:"item-synthetic", qty:1}');
  for (const mode of ['opening', 'taking', 'returning', 'transfer']) {
    const row = page.record(`client-${mode}`);
    if (mode === 'transfer') row.destination_bar_id = 'destination-synthetic';
    page.context.batch = { records: [row] };
    await page.run(`staffAttemptBeforeWrite("${mode}", batch)`);
    const frozen = await page.page.get(mode, page.context.batch.journalClaims);
    assert.equal(frozen.state, 'sending', mode);
    assert.equal(frozen.records[0].client_event_id, `client-${mode}`);
    assert.equal(frozen.scope.nightId, 'night-synthetic');
    assert.equal(frozen.scope.venueId, 'venue-synthetic');
    assert.equal(frozen.auth.assignmentId, 'assignment-synthetic');
    assert.equal(frozen.records[0].bar_id, 'bar-synthetic');
    assert.equal(frozen.draft.state && typeof frozen.draft.state, 'object');
  }
  assert.equal(page.stats().inserts, 0);
});

test('changed Staff assignment cannot release or verify a previously frozen attempt', async () => {
  const page = fixture(new AtomicStore());
  page.run('STAFF_TAKING_STATE = {"item-synthetic": {taken:2}}; STAFF_TAKING_SELECTED_BARS = ["bar-synthetic"]');
  page.context.batch = { records: [page.record('client-scope-change')] };
  await page.run('staffAttemptBeforeWrite("taking", batch)');
  page.context.SESSION.user = { ...page.context.SESSION.user, assignment_id: 'different-assignment' };
  page.context.ack = { acknowledged: 1, missing: 0, mismatched: 0, unexpected: 0,
    rows: [{ ...page.record('client-scope-change'), id: 'db-1' }] };
  await assert.rejects(page.run('staffAttemptVerified("taking", batch, ack)'), /scope changed/i);
  assert.equal(page.stats().inserts, 0);
});

test('crash after journal claim but before a send stays frozen and cannot be replayed', async () => {
  const store = new AtomicStore(), before = fixture(store);
  const claims = { venueId: 'venue-synthetic', staffId: 'staff-synthetic', nightId: 'night-synthetic',
    assignmentId: 'assignment-synthetic', allowedBarIds: ['bar-synthetic', 'destination-synthetic'],
    entryId: 'entry-before-crash', attemptId: 'client-unsent' };
  await before.page.claim('taking', claims, [before.record('client-unsent')],
    { state: { 'item-synthetic': { taken: 2 } }, selectedBars: ['bar-synthetic'] });
  assert.equal((await before.page.get('taking', claims)).state, 'frozen');
  const after = fixture(store);
  assert.equal(await after.run('staffAttemptHandlePrior("taking")'), true);
  assert.equal(after.run('STAFF_ATTEMPT_PRIOR.size'), 1);
  assert.match(after.field('staff-taking-error').textContent, /never sent/i);
  assert.equal(await after.run('staffAttemptCancelMovement("taking")'), true, after.field('staff-taking-error').textContent);
  assert.equal(after.stats().cancelCalls, 1);
  assert.equal((await after.page.get('taking', claims)).state, 'new_entry');
  assert.equal(after.stats().inserts, 0);
});

test('delayed exact-ID status cannot update a newer Staff context', async () => {
  const store = new AtomicStore(), before = fixture(store);
  before.run('STAFF_TAKING_STATE = {"item-synthetic": {taken:2}}; STAFF_TAKING_SELECTED_BARS = ["bar-synthetic"]');
  before.context.batch = { records: [before.record('client-delayed-status')] };
  await before.run('staffAttemptBeforeWrite("taking", batch)');
  let release, started;
  const readStarted = new Promise(resolve => { started = resolve; });
  const after = fixture(store, () => { started(); return new Promise(resolve => { release = resolve; }); });
  const pending = after.run('staffAttemptHandlePrior("taking")');
  await readStarted;
  after.context.SESSION.user = { ...after.context.SESSION.user, staff_id: 'other-staff' };
  release([{ ...before.record('client-delayed-status'), id: 'db-1' }]);
  await assert.rejects(pending, /context changed/i);
  assert.equal(after.run('STAFF_ATTEMPT_PRIOR.size'), 0);
  assert.equal(after.stats().inserts, 0);
});

test('verified server rows plus failed local completion remain blocked across tabs until explicit Cancel', async () => {
  const store = new AtomicStore(), before = fixture(store);
  before.run('STAFF_TAKING_STATE = {"item-synthetic": {taken:2}}; STAFF_TAKING_SELECTED_BARS = ["bar-synthetic"]');
  before.context.batch = { records: [before.record('client-completion-failed')], phase: 'sending' };
  await before.run('staffAttemptBeforeWrite("taking", batch)');
  before.context.ack = { acknowledged: 1, missing: 0, mismatched: 0, unexpected: 0,
    rows: [{ ...before.record('client-completion-failed'), id: 'db-1' }] };
  await before.run('staffAttemptVerified("taking", batch, ack)');
  assert.equal((await before.page.get('taking', before.context.batch.journalClaims)).state, 'verified');

  const otherTab = fixture(store);
  assert.equal(await otherTab.run('staffAttemptHandlePrior("taking")'), true);
  assert.match(otherTab.field('staff-taking-error').textContent, /saved and verified/);
  otherTab.context.batch = { records: [otherTab.record('client-new-after-failed-completion')] };
  await assert.rejects(otherTab.run('staffAttemptBeforeWrite("taking", batch)'), /prior frozen movement/i);
  assert.equal(otherTab.stats().inserts, 0);
  assert.equal(await otherTab.run('staffAttemptCancelMovement("taking")'), true);
  assert.equal((await otherTab.page.get('taking', before.context.batch.journalClaims)).state, 'new_entry');
});

test('two page contexts cannot claim separate client IDs for the same same-browser movement', async () => {
  const store = new AtomicStore(), tabA = fixture(store), tabB = fixture(store);
  for (const tab of [tabA, tabB]) tab.run('STAFF_TAKING_STATE = {"item-synthetic": {taken:2}}; STAFF_TAKING_SELECTED_BARS = ["bar-synthetic"]');
  tabA.context.batch = { records: [tabA.record('client-from-a')] };
  tabB.context.batch = { records: [tabB.record('client-from-b')] };
  const outcomes = await Promise.allSettled([
    tabA.run('staffAttemptBeforeWrite("taking", batch)'),
    tabB.run('staffAttemptBeforeWrite("taking", batch)')
  ]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(result => result.status === 'rejected').length, 1);
  assert.equal(tabA.stats().inserts + tabB.stats().inserts, 0);
  const winner = outcomes[0].status === 'fulfilled' ? tabA : tabB;
  assert.equal((await winner.page.get('taking', winner.context.batch.journalClaims)).state, 'sending');
});

test('journal release failure after verified completion cannot open a second write', async () => {
  const store = new AtomicStore(), first = fixture(store);
  first.run('STAFF_TAKING_STATE = {"item-synthetic": {taken:2}}; STAFF_TAKING_SELECTED_BARS = ["bar-synthetic"]');
  first.context.batch = { records: [first.record('client-release-fault')], phase: 'sending' };
  await first.run('staffAttemptBeforeWrite("taking", batch)');
  first.context.ack = { acknowledged: 1, missing: 0, mismatched: 0, unexpected: 0,
    rows: [{ ...first.record('client-release-fault'), id: 'db-1' }] };
  await first.run('staffAttemptVerified("taking", batch, ack)');
  first.context.batch.phase = 'completed';
  first.context.pageJournal.release = async () => { throw Error('synthetic storage failure after server verification'); };
  await assert.rejects(first.run('staffAttemptReleaseCompleted("taking", batch)'), /synthetic storage failure/);
  const nextTab = fixture(store);
  assert.equal(await nextTab.run('staffAttemptHandlePrior("taking")'), true);
  assert.match(nextTab.field('staff-taking-error').textContent, /saved and verified/);
  nextTab.context.batch = { records: [nextTab.record('client-should-not-send')] };
  await assert.rejects(nextTab.run('staffAttemptBeforeWrite("taking", batch)'), /prior frozen movement/i);
  assert.equal(nextTab.stats().inserts, 0);
});
