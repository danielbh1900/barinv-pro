const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'barback.html'), 'utf8');

function functionSource(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const next = html.indexOf('\nfunction ', start + 10);
  return html.slice(start, next === -1 ? html.length : next);
}

test('Phase 2J manual selection uses the same selected-item and pending path', () => {
  const picked = functionSource('setPickedItem');
  assert.match(picked, /state\.selectedItemId = it\.id/);
  assert.match(picked, /phase1MarkPendingSelection\(it, source\)/);
  assert.match(html, /setPickedItem\(it, 'browse'\)/);
  assert.match(html, /setPickedItem\(.*'search'/s);
});

test('Phase 2J selected item immediately synchronizes the Add button', () => {
  const render = functionSource('phase1RenderPendingSelection');
  assert.match(render, /syncAddButtonLabel\(\)/);
  assert.match(render, /pending \? '' : 'none'/);
  assert.match(render, /pending \? 'false' : 'true'/);
});

test('Phase 2J cleared selection remains non-actionable after Add', () => {
  const sync = functionSource('syncAddButtonLabel');
  const button = { disabled: false, textContent: '', dataset: {}, classList: { toggle() {} } };
  const context = { state: { selectedItemId: null, multiBars: [], multiBarMode: false }, $: id => id === 'save-btn' ? button : null };
  assert.match(sync, /SCAN \/ SELECT ITEM FIRST/);
  assert.match(sync, /btn\.disabled = true/);
});

test('Phase 2J preserves scan workflows, weight semantics, Review, and safety markers', () => {
  for (const marker of [
    'resolveScanWorkflow', 'FAST 1 EACH', 'SET QTY', 'WEIGH', 'phase1-weigh-pending',
    'resolveQuantityAndWeightSemantics', 'Weight (g)', 'safeReviewRowHTML',
    'rapidScanBusy', 'canonicalBarcodeCooldownKey', '_qnksScaleDivisor',
    'VIEW REVIEW', 'VOICE GUIDE', 'PHASE2E_BLUEFY_BOOT_GUARD'
  ]) assert.ok(html.includes(marker), `missing ${marker}`);
});
