'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../staff/index.html'), 'utf8');
const a = source.indexOf('function staffScannerApplyResolved(match) {');
const b = source.indexOf('function staffScannerHandleDecoded(', a);
assert.ok(a >= 0 && b > a);
const dispatcher = source.slice(a, b);

for (const mode of ['opening', 'taking']) test(mode + ' scanner callback cannot edit frozen submission', () => {
  const feedback = [];
  const context = { STAFF_SCANNER: { mode }, staffOpeningCanEdit: () => false, staffTakingCanEdit: () => false,
    staffScannerSetFeedback: (...args) => feedback.push(args), STAFF_OPENING_STATE: { 'i::b': 4 }, STAFF_TAKING_STATE: { i: { taken: 4 } } };
  vm.createContext(context);
  vm.runInContext(dispatcher, context);
  const before = JSON.stringify([context.STAFF_OPENING_STATE, context.STAFF_TAKING_STATE]);
  const result = context.staffScannerApplyResolved({ item: { id: 'i' } });
  assert.equal(result.status, 'SUBMISSION_PENDING');
  assert.equal(JSON.stringify([context.STAFF_OPENING_STATE, context.STAFF_TAKING_STATE]), before);
  assert.match(feedback[0][0], /awaiting verification/);
});

test('Opening Done remains enabled when movement inputs are frozen', () => {
  const a = source.indexOf('function staffOpeningUpdateSaveButton() {');
  const b = source.indexOf('function staffOpeningNewClientId()', a);
  assert.ok(a >= 0 && b > a);
  const buttons = [
    { id: 'staff-opening-done-i', disabled: false, getAttribute: () => null },
    { id: 'staff-opening-plus-i-b', disabled: false, getAttribute: () => null }
  ];
  const save = { disabled: false, textContent: '' };
  const context = { STAFF_OPENING_SAVING: true, STAFF_OPENING_SUBMISSION: null,
    STAFF_ATTEMPT_PRIOR: new Map(), staffAttemptEntryKey: mode => `synthetic|${mode}`,
    staffOpeningSubmissionIsCurrent: () => false, staffOpeningRetainedCurrent: () => null,
    document: { getElementById: id => id === 'staff-opening-save' ? save :
      id === 'staff-shell-opening' ? { querySelectorAll: () => buttons } : null } };
  vm.createContext(context);
  vm.runInContext(source.slice(a, b), context);
  context.staffOpeningUpdateSaveButton();
  assert.equal(buttons[0].disabled, false);
  assert.equal(buttons[1].disabled, true);
  assert.equal(save.disabled, true);
});
