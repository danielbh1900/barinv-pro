const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'barback.html'), 'utf8');

function functionSource(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const next = html.indexOf('\nfunction ', start + 10);
  return html.slice(start, next === -1 ? html.length : next);
}

test('Phase 2H successful Add clears the pending selection after clearing the item', () => {
  const save = html.slice(html.indexOf("$('save-btn').addEventListener"), html.indexOf('// ════════════════════════════════════════════════════════════════════\n//  Success / error overlay', html.indexOf("$('save-btn').addEventListener")));
  const itemClear = save.indexOf('state.selectedItemId = null;');
  const pendingRender = save.indexOf('phase1RenderPendingSelection();', itemClear);
  assert.ok(itemClear >= 0, 'post-add item clear exists');
  assert.ok(pendingRender > itemClear, 'pending card rerenders after item clear');
  assert.match(save, /if \(!state\.selectedItemId\)[\s\S]*ALREADY ADDED/);
});

test('Phase 2H Add button is disabled when no item is selected', () => {
  const source = functionSource('syncAddButtonLabel');
  const button = { disabled: false, textContent: '', dataset: {}, classList: { toggle() {} } };
  const context = { state: { selectedItemId: null, multiBars: [], multiBarMode: false }, $: id => id === 'save-btn' ? button : null };
  vm.createContext(context);
  vm.runInContext(source, context);
  context.syncAddButtonLabel();
  assert.equal(button.disabled, true);
  assert.match(button.textContent, /SCAN \/ SELECT ITEM FIRST/);
  context.state.selectedItemId = 'item-1';
  context.syncAddButtonLabel();
  assert.equal(button.disabled, false);
  assert.match(button.textContent, /ADD TO REVIEW/);
});

test('Phase 2H pending card follows the selected item and clears after successful add', () => {
  const source = functionSource('phase1RenderPendingSelection');
  const card = { classList: { values: [], toggle(name, value) { this.values.push([name, value]); } } };
  const item = { textContent: '' };
  const add = { classList: { toggle() {} } };
  const context = {
    phase1PendingItemId: 'item-1', phase1PendingItemName: 'Bottle',
    state: { selectedItemId: null },
    $: id => id === 'phase1-pending-selection' ? card : id === 'phase1-pending-item' ? item : id === 'save-btn' ? add : null,
    syncAddButtonLabel() {},
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  context.phase1RenderPendingSelection();
  assert.equal(card.classList.values.at(-1)[1], false);
  assert.equal(item.textContent, '');
  context.state.selectedItemId = 'item-1';
  context.phase1RenderPendingSelection();
  assert.equal(card.classList.values.at(-1)[1], true);
  assert.equal(item.textContent, 'Bottle');
});

test('Phase 2H preserves workflow routing and existing draft path', () => {
  for (const marker of [
    'resolveScanWorkflow', 'FAST_UNOPENED_ONE_EACH', 'SET_QUANTITY_COUNT', 'WEIGH_PARTIAL',
    'addCurrentSelectionToReview', 'VIEW REVIEW', 'safeReviewRowHTML',
    'resolveQuantityAndWeightSemantics', '_qnksScaleDivisor', 'canonicalBarcodeCooldownKey'
  ]) assert.ok(html.includes(marker), `missing ${marker}`);
  assert.doesNotMatch(html, /function phase2h(?:Save|Submit|Persist)/i);
});
