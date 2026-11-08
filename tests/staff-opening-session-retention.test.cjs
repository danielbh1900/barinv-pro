const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../staff/index.html'), 'utf8');
const begin = source.indexOf('let STAFF_OPENING_STATE = {};');
const end = source.indexOf('let STAFF_TAKING_STATE = {};', begin);
assert.ok(begin >= 0 && end > begin);
const opening = source.slice(begin, end);
const cancelBegin = source.indexOf('function staffWorkspaceCancelMovement(mode');
const cancelEnd = source.indexOf('function staffWorkspaceAction()', cancelBegin);
assert.ok(cancelBegin >= 0 && cancelEnd > cancelBegin);
const cancel = source.slice(cancelBegin, cancelEnd);

function fixture() {
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      id, textContent: '', className: '', disabled: false, style: { display: '' },
      querySelectorAll: () => []
    });
    return nodes.get(id);
  }
  node('staff-shell-opening').style.display = 'block';
  node('staff-shell-dispatch').style.display = 'none';
  node('staff-dashboard').dataset = { staffView: 'opening' };
  const user = { staff_id: 'staff-1', assignment_id: 'assignment-1', nightId: 'night-1',
    session_id: 'session-1', name: 'Synthetic Operator', allowed_bar_ids: ['bar-1'] };
  const ctx = {
    document: { getElementById: node }, APP_MODE: 'staff',
    SESSION: { type: 'barback', venueId: 'venue-1', user,
      cache: { authorizedBars: [{ id: 'bar-1', active: true }], openingItems: [{ id: 'item-1', name: 'Synthetic item', par_level: 4 }] } },
    crypto: { randomUUID: () => 'synthetic-opening-1' },
    staffUnverifiedWriteScopeKey: () => JSON.stringify([ctx.SESSION.venueId, ctx.SESSION.user.staff_id, ctx.SESSION.user.nightId]),
    staffOperationalGuard: () => true,
    STAFF_ATTEMPT_PRIOR: new Map(),
    staffAttemptEntryKey: mode => `${ctx.staffUnverifiedWriteScopeKey()}|${mode}`,
    staffAttemptOnEntry: async () => {},
    staffAttemptHandlePrior: async () => false,
    staffMovementReviewBeforeWrite: async () => {},
    staffAttemptBeforeWrite: async () => {},
    staffAttemptVerified: async () => {},
    staffAttemptReleaseCompleted: async () => {},
    staffAttemptReportVerifiedLocalFailure: () => false,
    staffAttemptRejected: async () => {},
    staffAttemptReceiptAck: (_mode, batch) => batch.ack,
    hydrateStaffAuthorizedBars: async () => {}, hydrateStaffOpeningItems: async () => {},
    STAFF_ITEM_FILTERS: { opening: { query: '', category: '' } },
    STAFF_SCALE_CONTEXT: { mode: 'opening', itemId: 'item-1' },
    staffOpeningCloseDetail: () => {}, staffWorkspaceNavigate: view => { node('staff-dashboard').dataset.staffView = view; },
    showStaffShellView: view => {
      node('staff-shell-opening').style.display = view === 'opening' ? 'block' : 'none';
      node('staff-shell-dispatch').style.display = view === 'dispatch' ? 'block' : 'none';
    },
    staffMovementRecordVerified: (mode, batch) => {
      if (batch.context.userRef !== ctx.SESSION.user) return false;
      ctx.receipts.push({ mode, batch });
      return true;
    },
    receipts: []
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(opening, ctx);
  vm.runInContext(cancel, ctx);
  ctx.staffOpeningCloseDetail = () => {};
  ctx.staffOpeningValidateState = () => {};
  ctx.staffOpeningRows = () => [{ item: { id: 'item-1' }, bar: { id: 'bar-1' }, qty: 2, measurement: null }];
  return { ctx, node, run: code => vm.runInContext(code, ctx) };
}

function accepted(records) {
  return records.map((record, index) => ({ ...record, id: `db-${index}`, staff_id: null, source: null, session_id: null }));
}

async function startDelayedPost(f) {
  let release, frozen, inserts = 0, reads = 0, readData = [];
  f.ctx.SB = { from: name => {
    assert.equal(name, 'events');
    return {
      insert(records) {
        inserts++; frozen = records;
        return { select: () => new Promise(resolve => { release = () => resolve({ data: accepted(records), error: null }); }) };
      },
      select() {
        return {
          eq() { return this; },
          in(column, ids) {
            assert.equal(column, 'client_event_id');
            assert.deepEqual(Array.from(ids), frozen.map(row => row.client_event_id));
            return this;
          },
          async limit() { reads++; return { data: readData, error: null }; }
        };
      }
    };
  } };
  f.run('STAFF_OPENING_STATE = {"item-1::bar-1": 2}');
  const first = f.run('saveStaffOpening()');
  for (let i = 0; !release && i < 40; i++) await Promise.resolve();
  assert.equal(typeof release, 'function');
  return { first, release, frozen: () => frozen, inserts: () => inserts, reads: () => reads, setReadData: data => { readData = data; } };
}

test('Opening keeps frozen IDs and blocks a second POST after same-scope session restoration', async () => {
  const f = fixture(), post = await startDelayedPost(f);
  const ids = post.frozen().map(row => row.client_event_id);
  f.ctx.SESSION.user = { ...f.ctx.SESSION.user, session_id: 'restored-session' };
  f.run('staffOpeningResetObsoleteSubmission()');
  f.run('STAFF_OPENING_STATE = {"item-1::bar-1": 7}');
  post.release(); await post.first;
  assert.equal(post.inserts(), 1);
  assert.equal(f.run('STAFF_OPENING_RETAINED.size'), 1);
  assert.equal(f.run('STAFF_OPENING_SUBMISSION'), null);
  post.setReadData(accepted(post.frozen()));
  await f.run('saveStaffOpening()');
  assert.equal(post.reads(), 1);
  assert.equal(post.inserts(), 1);
  assert.deepEqual(post.frozen().map(row => row.client_event_id), ids);
  assert.equal(f.run('STAFF_OPENING_STATE["item-1::bar-1"]'), 7);
  assert.equal(f.run('staffOpeningRetainedCurrent().phase'), 'verified');
  assert.equal(f.ctx.receipts.length, 1);
  assert.equal(f.run('staffOpeningRetainedCurrent().receiptRecorded'), true);
  await f.run('saveStaffOpening()');
  assert.equal(post.inserts(), 1);
  assert.equal(post.reads(), 1);
});

test('Opening missing exact-ID read stays unknown and cannot overwrite a newer draft', async () => {
  const f = fixture(), post = await startDelayedPost(f);
  f.ctx.SESSION.user = { ...f.ctx.SESSION.user };
  f.run('staffOpeningResetObsoleteSubmission()');
  f.run('STAFF_OPENING_STATE = {"item-1::bar-1": 9}');
  post.release(); await post.first;
  await f.run('saveStaffOpening()');
  assert.equal(f.run('staffOpeningRetainedCurrent().phase'), 'unknown');
  assert.equal(post.inserts(), 1);
  assert.equal(post.reads(), 1);
  assert.equal(f.run('STAFF_OPENING_STATE["item-1::bar-1"]'), 9);
  assert.equal(f.run('staffOpeningCanEdit()'), false);
});

test('Opening changed assignment cannot use an old retained attempt for a new write', async () => {
  const f = fixture(), post = await startDelayedPost(f);
  f.ctx.SESSION.user = { ...f.ctx.SESSION.user, assignment_id: 'assignment-2' };
  f.run('staffOpeningResetObsoleteSubmission()');
  post.release(); await post.first;
  await f.run('saveStaffOpening()');
  assert.equal(post.inserts(), 1);
  assert.equal(post.reads(), 0);
  assert.equal(f.run('staffOpeningRetainedCurrent().phase'), 'unknown');
  assert.match(f.node('staff-opening-error').textContent, /changed Staff assignment/);
});

test('Opening verified retained attempt needs explicit Cancel; re-entry keeps PAR defaults', async () => {
  const f = fixture(), post = await startDelayedPost(f);
  f.ctx.SESSION.user = { ...f.ctx.SESSION.user };
  f.run('staffOpeningResetObsoleteSubmission()');
  post.release(); await post.first;
  post.setReadData(accepted(post.frozen()));
  await f.run('saveStaffOpening()');
  assert.equal(f.run('STAFF_OPENING_RETAINED.size'), 1);
  assert.equal(f.run('staffWorkspaceCancelMovement("opening")'), true);
  assert.equal(f.run('STAFF_OPENING_RETAINED.size'), 0);
  assert.equal(f.run('JSON.stringify(STAFF_OPENING_STATE)'), '{}');
  assert.equal(f.node('staff-dashboard').dataset.staffView, 'dispatch');
  f.run('openStaffOpening()');
  assert.equal(f.run('staffOpeningQuantity({id:"item-1",par_level:4},{id:"bar-1"})'), 4);
});
