'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'barback.html'), 'utf8');

function between(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.notEqual(a, -1, `missing marker: ${start}`);
  assert.notEqual(b, -1, `missing marker: ${end}`);
  return source.slice(a + start.length, b);
}

class FakeStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
    this.failKeys = new Set();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    if (this.failKeys.has(key)) {
      const error = new Error(`quota for ${key}`);
      error.name = 'QuotaExceededError';
      throw error;
    }
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

function event(id, queuedAt = 1000) {
  return {
    client_event_id: id,
    venue_id: 'venue-1',
    night_id: 'night-1',
    item_id: `item-${id}`,
    action: 'TAKEN',
    qty: 1,
    status: 'PENDING',
    queued_at: queuedAt,
    attempts: 0,
    last_error: null,
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function outboxHarness(initialRows = []) {
  const storage = new FakeStorage({
    barinv_barback_outbox: JSON.stringify(initialRows),
  });
  const banner = { style: { display: 'none' } };
  const alerts = [];
  const statuses = [];
  const errors = [];
  const context = {
    LS: {
      outbox: 'barinv_barback_outbox',
      reviewDrafts: 'barinv_barback_review_drafts',
      outboxCorruptPrefix: 'barinv_barback_outbox_corrupt_',
      staleQuarantine: 'barinv_barback_stale_quarantine',
    },
    localStorage: storage,
    $: id => id === 'outbox-storage-error' ? banner : null,
    statusOn: (...args) => statuses.push(args),
    alert: message => alerts.push(message),
    console: {
      error: (...args) => errors.push(args),
      warn: () => {},
    },
  };
  vm.runInNewContext(
    between(html, '// OUTBOX_DURABILITY_V1_START', '// OUTBOX_DURABILITY_V1_END') +
      '\nthis.Outbox = Outbox; this.storageMessage = OUTBOX_STORAGE_ERROR_MESSAGE;',
    context,
    { filename: 'barback-outbox-durability-core.js' },
  );
  return {
    Outbox: context.Outbox,
    storage,
    banner,
    alerts,
    statuses,
    errors,
    message: context.storageMessage,
    context,
  };
}

function attachDrafts(h, initialRows = []) {
  h.storage.setItem('barinv_barback_review_drafts', JSON.stringify(initialRows));
  vm.runInNewContext(
    html.slice(
      html.indexOf('const Drafts = {'),
      html.indexOf('//  App state', html.indexOf('const Drafts = {')),
    ) + '\nthis.Drafts = Drafts;',
    h.context,
    { filename: 'barback-drafts-durability-core.js' },
  );
  return h.context.Drafts;
}

function submitAllSource() {
  const start = html.indexOf('async function submitAllDraftsToBarinv()');
  const end = html.indexOf('// Keep the SUBMIT ALL button label', start);
  assert.ok(start >= 0 && end > start, 'submitAllDraftsToBarinv source not found');
  return html.slice(start, end);
}

async function runSubmitAll({ queueResult, draftRemoveResult }) {
  const draft = {
    ...event('submit-1'),
    item_name: 'Bottle',
    drafted_at: 100,
  };
  const calls = [];
  const button = { textContent: '', disabled: false };
  const context = {
    Drafts: {
      load: () => [draft],
      removeById: id => {
        calls.push(['draft-remove', id]);
        return draftRemoveResult || { ok:true };
      },
    },
    Outbox: {
      push: rec => {
        calls.push(['outbox-push', rec.client_event_id]);
        return queueResult || { ok:true };
      },
    },
    Recent: {
      add: rec => calls.push(['recent-add', rec.ce]),
    },
    buildWeightNotes: () => '',
    buildProfileNotes: () => '',
    confirm: () => true,
    statusOn: (...args) => calls.push(['status', ...args]),
    refreshDraftCount: () => calls.push(['refresh-drafts']),
    refreshQueueCount: () => calls.push(['refresh-queue']),
    renderRecentMini: () => {},
    renderReview: () => {},
    syncOutbox: async () => {
      calls.push(['sync']);
      return { ok:true, msg:'Synced 1' };
    },
    $: id => id === 'review-submit-all' ? button : null,
    console: { error: () => {}, warn: () => {} },
  };
  vm.runInNewContext(
    submitAllSource() + '\nthis.submitAllDraftsToBarinv = submitAllDraftsToBarinv;',
    context,
    { filename: 'barback-submit-all.js' },
  );
  await context.submitAllDraftsToBarinv();
  return calls;
}

test('1. normal queue save persists the complete queue and verifies readback', () => {
  const h = outboxHarness([event('one')]);
  const result = h.Outbox.push(event('two'));
  assert.equal(result.ok, true);
  assert.equal(result.persisted, true);
  assert.deepEqual(
    JSON.parse(h.storage.getItem('barinv_barback_outbox')).map(row => row.client_event_id),
    ['one', 'two'],
  );
  assert.equal(h.banner.style.display, 'none');
});

test('2. quota failure preserves durable rows and the failed addition in memory', () => {
  const h = outboxHarness([event('one'), event('two')]);
  h.Outbox.load();
  const durableBefore = h.storage.getItem('barinv_barback_outbox');
  h.storage.failKeys.add('barinv_barback_outbox');

  const failed = h.Outbox.push(event('three'));
  assert.equal(failed.ok, false);
  assert.equal(failed.volatile, true);
  assert.equal(h.storage.getItem('barinv_barback_outbox'), durableBefore);
  assert.deepEqual(plain(h.Outbox.load().map(row => row.client_event_id)), ['one', 'two', 'three']);
  assert.equal(h.banner.style.display, 'block');
  assert.equal(h.alerts.length, 1);
  assert.match(h.alerts[0], /Do not close or reload/);
  assert.match(h.alerts[0], /call your manager/);

  const blocked = h.Outbox.push(event('four'));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.blocked, true);
  assert.deepEqual(plain(h.Outbox.load().map(row => row.client_event_id)), ['one', 'two', 'three']);
  assert.equal(h.alerts.length, 1, 'blocking alert is not repeatedly spammed');
});

test('3. failed edit/delete leaves queue identity unchanged and visible', () => {
  const h = outboxHarness([event('one'), event('two')]);
  const before = h.Outbox.load();
  h.storage.failKeys.add('barinv_barback_outbox');

  const edited = before.map(row => row.client_event_id === 'one' ? { ...row, qty: 9 } : row);
  assert.equal(h.Outbox.save(edited).ok, false);
  assert.deepEqual(plain(
    h.Outbox.load().map(row => [row.client_event_id, row.qty]),
  ), [['one', 1], ['two', 1]]);

  assert.equal(h.Outbox.removeById('one').ok, false);
  assert.deepEqual(plain(h.Outbox.load().map(row => row.client_event_id)), ['one', 'two']);
});

test('4. queue can recover after storage is available without losing the volatile row', () => {
  const h = outboxHarness([event('one')]);
  h.Outbox.load();
  h.storage.failKeys.add('barinv_barback_outbox');
  assert.equal(h.Outbox.push(event('two')).ok, false);
  h.storage.failKeys.delete('barinv_barback_outbox');

  const recovered = h.Outbox.save(h.Outbox.load());
  assert.equal(recovered.ok, true);
  assert.deepEqual(
    JSON.parse(h.storage.getItem('barinv_barback_outbox')).map(row => row.client_event_id),
    ['one', 'two'],
  );
  assert.equal(h.banner.style.display, 'none');
  assert.equal(h.Outbox.push(event('three')).ok, true);
});

test('5. Review draft save failure is blocking and preserves the failed draft in memory', () => {
  const h = outboxHarness([]);
  const Drafts = attachDrafts(h, [event('draft-one')]);
  assert.equal(Drafts.add(event('draft-two')).ok, true);
  const durableBefore = h.storage.getItem('barinv_barback_review_drafts');
  h.storage.failKeys.add('barinv_barback_review_drafts');

  const failed = Drafts.add(event('draft-three'));
  assert.equal(failed.ok, false);
  assert.equal(failed.volatile, true);
  assert.equal(h.storage.getItem('barinv_barback_review_drafts'), durableBefore);
  assert.deepEqual(
    plain(Drafts.load().map(row => row.client_event_id)),
    ['draft-one', 'draft-two', 'draft-three'],
  );
  assert.equal(Drafts.add(event('draft-four')).blocked, true);
  assert.equal(h.banner.style.display, 'block');
});

test('6. Submit All removes a draft only after the complete outbox is durable', async () => {
  const calls = await runSubmitAll({});
  const names = calls.map(call => call[0]);
  assert.ok(names.indexOf('outbox-push') < names.indexOf('draft-remove'));
  assert.ok(names.indexOf('draft-remove') < names.indexOf('recent-add'));
  assert.ok(names.indexOf('recent-add') < names.indexOf('sync'));
});

test('7. Submit All keeps the draft and does not sync when outbox persistence fails', async () => {
  const error = new Error('quota');
  const calls = await runSubmitAll({ queueResult: { ok:false, error } });
  const names = calls.map(call => call[0]);
  assert.equal(names.includes('outbox-push'), true);
  assert.equal(names.includes('draft-remove'), false);
  assert.equal(names.includes('recent-add'), false);
  assert.equal(names.includes('sync'), false);
  assert.equal(calls.some(call => call[0] === 'status' && call[3] === 'err'), true);
});

test('8. login, logout, and session refresh do not purge the outbox', () => {
  const authBlock = between(html, 'const Auth = {', '//  Outbox');
  const logoutBlock = between(html, 'function logout() {', '//  Session expiration countdown');
  const bootBlock = between(html, 'function boot() {', 'function expiryDebug');
  for (const block of [authBlock, logoutBlock, bootBlock]) {
    assert.doesNotMatch(block, /removeItem\s*\(\s*LS\.outbox/);
    assert.doesNotMatch(block, /Outbox\.save\s*\(\s*\[\s*\]\s*\)/);
  }
});

test('9. stale quarantine is verified and never removes rows when quarantine save fails', () => {
  const stale = event('stale', 1000);
  const fresh = event('fresh', 9500);
  const h = outboxHarness([stale, fresh]);
  h.storage.failKeys.add('barinv_barback_stale_quarantine');
  h.context.Date = class extends Date {
    static now() { return 10_000; }
  };
  h.context.LIVE_PILOT_MODE = false;
  h.context.PILOT_STALE_OUTBOX_AGE_MS = 30_000;
  h.context.STALE_OUTBOX_AGE_MS = 2000;
  vm.runInNewContext(
    html.slice(
      html.indexOf('function repairStaleOutbox()'),
      html.indexOf('function renderRecentItemChips()', html.indexOf('function repairStaleOutbox()')),
    ) + '\nthis.repairStaleOutbox = repairStaleOutbox;',
    h.context,
    { filename: 'barback-stale-repair.js' },
  );

  const result = h.context.repairStaleOutbox();
  assert.equal(result.ok, false);
  assert.deepEqual(
    JSON.parse(h.storage.getItem('barinv_barback_outbox')).map(row => row.client_event_id),
    ['stale', 'fresh'],
  );
  assert.deepEqual(plain(h.Outbox.load().map(row => row.client_event_id)), ['stale', 'fresh']);
});

test('10. successful stale quarantine preserves the complete stale rows and alerts the operator', () => {
  const h = outboxHarness([event('stale', 1000), event('fresh', 9500)]);
  h.context.Date = class extends Date {
    static now() { return 10_000; }
  };
  h.context.LIVE_PILOT_MODE = false;
  h.context.PILOT_STALE_OUTBOX_AGE_MS = 30_000;
  h.context.STALE_OUTBOX_AGE_MS = 2000;
  vm.runInNewContext(
    html.slice(
      html.indexOf('function repairStaleOutbox()'),
      html.indexOf('function renderRecentItemChips()', html.indexOf('function repairStaleOutbox()')),
    ) + '\nthis.repairStaleOutbox = repairStaleOutbox;',
    h.context,
    { filename: 'barback-stale-repair.js' },
  );

  const result = h.context.repairStaleOutbox();
  assert.equal(result.ok, true);
  assert.equal(result.quarantined, 1);
  assert.deepEqual(
    JSON.parse(h.storage.getItem('barinv_barback_outbox')).map(row => row.client_event_id),
    ['fresh'],
  );
  const quarantine = JSON.parse(h.storage.getItem('barinv_barback_stale_quarantine'));
  assert.equal(quarantine.length, 1);
  assert.equal(quarantine[0].entries[0].client_event_id, 'stale');
  assert.equal(h.alerts.some(message => /moved to the local stale-session quarantine/.test(message)), true);
});

test('11. source has no truncation fallback and exposes blocking recovery UI', () => {
  const core = between(html, '// OUTBOX_DURABILITY_V1_START', '// OUTBOX_DURABILITY_V1_END');
  assert.doesNotMatch(core, /slice\s*\(\s*-\s*Math\.floor/);
  assert.match(html, /id="outbox-storage-error"/);
  assert.match(html, /id="outbox-storage-export"/);
  assert.match(html, /review_drafts:\s*Drafts\.load\(\)/);
  assert.match(html, /stale_quarantine:/);
  assert.match(html, /if \(!queueResult\.ok\)/);
  assert.match(html, /if \(!r\.synced && r\.queued === false\)/);
  assert.match(html, /const queued = Outbox\.push\(rec\)/);
});
