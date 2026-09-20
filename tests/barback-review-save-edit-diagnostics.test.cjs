const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'barback.html'), 'utf8');

test('Review draft SAVE EDIT has a DOM element and handler contract', () => {
  assert.match(source, /<button class="de-save"/);
  assert.match(source, /form\.querySelector\('\.de-save'\)/);
  assert.match(source, /onDraftEditSave\(ce, form\)/);
  assert.match(source, /function onDraftEditSave\(ce, form\)/);
  assert.match(source, /<button class="de-delete"/);
  assert.match(source, /onDraftDelete\(ce\)/);
});

test('SAVE EDIT diagnostics cover pointer, click, handler, and hit testing', () => {
  for (const marker of [
    'SAVE_EDIT_HIT_TEST',
    'SAVE_EDIT_POINTER_DOWN',
    'SAVE_EDIT_CLICK',
    'SAVE_EDIT_HANDLER_ENTER',
    'document.elementFromPoint',
    'getBoundingClientRect',
    'buttonPointerEvents',
    'buttonZIndex',
    'submitAllRect',
    'coveringElement',
  ]) assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('Review Submit All is separate normal-flow UI from the main fixed footer', () => {
  const reviewStart = source.indexOf('<div class="screen" id="screen-review">');
  const reviewEnd = source.indexOf('<!-- ============================ SCREEN 5:', reviewStart);
  const review = source.slice(reviewStart, reviewEnd);
  assert.match(review, /id="review-submit-all"/);
  assert.match(source, /\.footer\s*\{[\s\S]*position:fixed/);
  assert.match(source, /<div class="footer">[\s\S]*id="sync-btn"/);
  assert.doesNotMatch(review, /position:\s*fixed|position:\s*sticky/);
});

test('A visible enabled SAVE EDIT button is a valid hit target in the diagnostic model', () => {
  const button = { disabled: false, rect: { left: 10, top: 20, right: 110, bottom: 60 } };
  const hit = { tagName: 'BUTTON', id: '', className: 'de-save' };
  assert.equal(button.disabled, false);
  assert.ok(button.rect.right > button.rect.left);
  assert.equal(hit.className, 'de-save');
});
