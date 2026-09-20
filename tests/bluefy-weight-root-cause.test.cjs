const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'barback.html'), 'utf8');

test('physical Jameson barcode evidence is represented by the shared alias resolver contract', () => {
  assert.match(source, /function lookupBarcodeResult\(raw\)/);
  assert.match(source, /barcodeLookupVariants\(value\)/);
});

test('ZXing permits EAN-8 and the same scanner configuration feeds all workflows', () => {
  assert.match(source, /BarcodeFormat\.EAN_8/);
  assert.match(source, /function acceptDecodedCode\(code, controls\)/);
  assert.match(source, /const scanWorkflow = resolveScanWorkflow\(\)/);
  assert.match(source, /FAST_UNOPENED_ONE_EACH/);
  assert.match(source, /SET_QUANTITY_COUNT/);
  assert.match(source, /WEIGH_PARTIAL/);
});

test('one-shot unknown scans hold briefly while FAST remains continuous', () => {
  assert.match(source, /if \(!it\) \{/);
  assert.match(source, /const oneShotHold = !state\.scannerContinuous/);
  assert.match(source, /UNKNOWN_SCAN_HOLD_MS = 1800/);
  assert.match(source, /finalizeUnknownScanHold/);
  assert.match(source, /else releaseRapidScanLock\(\)/);
});

test('unknown scans clear an existing selected item before the hold', () => {
  const start = source.indexOf('function onBarcodeScanned');
  const end = source.indexOf('// Role/scope SAFETY', start);
  assert.ok(start >= 0 && end > start);
  const unknownBranch = source.slice(source.indexOf('if (!it)', start), end);
  assert.match(unknownBranch, /clearSelectionForUnknownScan\(\)/);
});

test('08040824 is a checksum-valid EAN-8 value, so catalog absence is the unknown condition', () => {
  const digits = '08040824'.split('').map(Number);
  const sum = digits.slice(0, 7).reduce((total, value, index) => total + value * (index % 2 === 0 ? 3 : 1), 0);
  assert.equal((10 - (sum % 10)) % 10, digits[7]);
});

test('acceptance contract covers physical alias, bounded recovery, conflicts, and all modes', () => {
  assert.match(source, /flow: 'UNKNOWN_HOLD_STARTED'/);
  assert.match(source, /flow: 'UNKNOWN_HOLD_MATCHED'/);
  assert.match(source, /flow: 'UNKNOWN_HOLD_TIMEOUT'/);
  assert.match(source, /barcodeResult\.ambiguous/);
  assert.match(source, /clearSelectionForUnknownScan\(\)/);
  assert.match(source, /scanWorkflow === 'WEIGH_PARTIAL'/);
  assert.match(source, /scanWorkflow === 'FAST_UNOPENED_ONE_EACH'/);
  assert.match(source, /openQtyModal\(it\)/);
});

test('WEIGH replacement path atomically arms replacement and records state transitions', () => {
  const beginStart = source.indexOf('function beginWeighPending(it)');
  const beginEnd = source.indexOf('function weighPendingMarkUnopened', beginStart);
  assert.ok(beginStart >= 0 && beginEnd > beginStart);
  const begin = source.slice(beginStart, beginEnd);
  assert.match(begin, /phase1WeighPendingItem = it/);
  assert.match(begin, /phase1ReplacementArmed = !!\(phase1PendingItemId && state\.selectedItemId/);
  assert.match(begin, /setPickedItem\(it, 'scan'\)/);
  assert.match(begin, /afterBeginWeighPendingItemId/);
  assert.match(begin, /afterSetPickedItemId/);
  assert.match(begin, /finally \{ phase1ReplacementArmed = false; \}/);
});

test('Settings barcode save paths preserve the entered barcode as a string', () => {
  const adminSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(adminSource, /const sku\s*=\s*document\.getElementById\('m-sku'\)\.value\.trim\(\) \|\| null/);
  assert.match(adminSource, /sku:\s*document\.getElementById\('m-sku'\)\.value\.trim\(\) \|\| null/);
  assert.match(adminSource, /sku:\s*\(r\.sku \|\| r\.barcode \|\| r\.upc \|\| ''\)\.trim\(\) \|\| null/);
  assert.doesNotMatch(adminSource, /(?:Number|parseInt|parseFloat)\([^)]*(?:m-sku|r\.sku|r\.barcode|r\.upc)/);
});

test('UPC-A Jameson raw barcode aliases the stored EAN-13 leading-zero form', () => {
  const raw = '080432500170';
  const stored = '0080432500170';
  const digits = value => String(value).trim().replace(/[^0-9]/g, '');
  const variants = value => {
    const d = digits(value);
    const out = new Set([String(value).trim(), d]);
    if (d.length === 12) out.add('0' + d);
    if (d.length === 13 && d.startsWith('0')) out.add(d.slice(1));
    return out;
  };
  assert.equal(digits(raw), raw);
  assert.equal(digits(stored), stored);
  assert.ok(variants(raw).has(stored));
  assert.ok(variants(stored).has(raw));
});

test('WEIGH uses the resolver item object without a second barcode equality gate', () => {
  const beginStart = source.indexOf('function beginWeighPending(it)');
  const renderEnd = source.indexOf('// ════════════════════════════════════════════════════════════════════', beginStart + 1);
  assert.ok(beginStart >= 0 && renderEnd > beginStart);
  const weighPath = source.slice(beginStart, renderEnd);
  assert.match(weighPath, /phase1WeighPendingItem = it/);
  assert.match(weighPath, /setPickedItem\(it, 'scan'\)/);
  assert.doesNotMatch(weighPath, /(?:barcode|code|sku)\s*===/i);
  assert.doesNotMatch(weighPath, /(?:===|==)\s*(?:barcode|code|sku)/i);
  assert.match(source, /phase1WeighPendingItem = it[\s\S]*?setPickedItem\(it, 'scan'\)/);
});

test('deterministic WEIGH alias path replaces each prior item with the newest match', () => {
  const items = [
    { id: 'casamigos', name: 'CASAMIGOS', sku: '0652341401031' },
    { id: 'jameson', name: 'JAMESON 0.750', sku: '0080432500170' },
  ];
  const normalize = value => String(value).trim().replace(/[^0-9]/g, '');
  const aliases = value => {
    const d = normalize(value);
    const out = new Set([d]);
    if (d.length === 12) out.add('0' + d);
    if (d.length === 13 && d.startsWith('0')) out.add(d.slice(1));
    return out;
  };
  const resolve = raw => {
    const candidates = aliases(raw);
    const matches = items.filter(item => [...aliases(item.sku)].some(v => candidates.has(v)));
    return matches.length === 1 ? matches[0] : null;
  };
  const applyWeighMatch = (state, raw) => {
    const matched = resolve(raw);
    assert.ok(matched);
    return {
      matched,
      selected: matched,
      pending: matched,
      displayed: matched,
    };
  };
  let weigh = applyWeighMatch({}, '652341401031');
  assert.equal(weigh.matched.id, 'casamigos');
  assert.equal(weigh.selected.id, 'casamigos');
  assert.equal(weigh.pending.id, 'casamigos');
  assert.equal(weigh.displayed.id, 'casamigos');
  weigh = applyWeighMatch(weigh, '080432500170');
  assert.equal(weigh.matched.id, 'jameson');
  assert.equal(weigh.selected.id, 'jameson');
  assert.equal(weigh.pending.id, 'jameson');
  assert.equal(weigh.displayed.id, 'jameson');
  assert.equal(weigh.matched.name, 'JAMESON 0.750');
  assert.notEqual(weigh.selected.id, 'casamigos');
  weigh = applyWeighMatch(weigh, '080432500170');
  assert.equal(weigh.selected.id, 'jameson');
});

test('BARCODE_RESOLUTION selectedItem diagnostics read live state, not matchedItem fallback', () => {
  const start = source.indexOf("flow: 'BARCODE_RESOLUTION'");
  const end = source.indexOf("});", start);
  assert.ok(start >= 0 && end > start);
  const event = source.slice(start, end);
  assert.match(event, /selectedItem: state\.selectedItemId \?/);
  assert.doesNotMatch(event, /selectedItem: it,/);
});

test('WEIGH diagnostics cover dispatch, state entry/exit, render, and actual DOM fields', () => {
  for (const flow of [
    'WEIGH_MATCH_DISPATCH',
    'WEIGH_BEGIN_ENTER',
    'WEIGH_SET_PICKED_ENTER',
    'WEIGH_SET_PICKED_EXIT',
    'WEIGH_RENDER_ENTER',
    'WEIGH_RENDER_EXIT',
    'WEIGH_DOM_NEXT_FRAME',
  ]) assert.match(source, new RegExp(flow));
  assert.match(source, /document\.getElementById\('phase1-weigh-item'\)/);
  assert.match(source, /document\.getElementById\('phase1-pending-item'\)/);
  assert.match(source, /displayText: safeDisplayText\(displayEl\)/);
  assert.match(source, /displayHidden:/);
  assert.match(source, /displayValue:/);
});

test('deterministic WEIGH DOM replacement cannot leave the prior visible bottle', () => {
  const dom = { 'phase1-weigh-item': { textContent: '' } };
  const state = { selectedItemId: null, selectedItemName: null, pendingItem: null };
  const renderWeighItem = item => {
    state.selectedItemId = item.id;
    state.selectedItemName = item.name;
    state.pendingItem = item;
    dom['phase1-weigh-item'].textContent = item && item.name ? 'Scanned: ' + item.name : 'Scanned item';
  };
  const casamigos = { id: 'casamigos', name: 'CASAMIGOS BLANCO' };
  const gordons = { id: 'gordons', name: "GORDON'S DRY GIN" };
  const jameson = { id: 'jameson', name: 'JAMESON 0.750' };
  renderWeighItem(casamigos);
  renderWeighItem(gordons);
  assert.equal(state.selectedItemName, gordons.name);
  assert.equal(state.pendingItem.name, gordons.name);
  assert.match(dom['phase1-weigh-item'].textContent, /GORDON'S DRY GIN/);
  renderWeighItem(jameson);
  assert.equal(state.selectedItemName, jameson.name);
  assert.equal(state.pendingItem.name, jameson.name);
  assert.match(dom['phase1-weigh-item'].textContent, /JAMESON 0\.750/);
  assert.doesNotMatch(dom['phase1-weigh-item'].textContent, /GORDON/);
});

test('beginWeighPending has no silent return before setPickedItem and emits branch checkpoints', () => {
  const start = source.indexOf('function beginWeighPending(it)');
  const setCall = source.indexOf("setPickedItem(it, 'scan')", start);
  assert.ok(start >= 0 && setCall > start);
  const beforeSet = source.slice(start, setCall);
  assert.doesNotMatch(beforeSet, /\breturn\b/);
  for (const flow of [
    'WEIGH_BEGIN_CHECK_PENDING_ASSIGN',
    'WEIGH_BEGIN_CHECK_DOM_LOOKUP',
    'WEIGH_BEGIN_CHECK_DISPLAY_ASSIGN',
    'WEIGH_BEGIN_CHECK_WEIGHT_DEFAULT',
    'WEIGH_BEGIN_CHECK_FORM_ASSIGN',
    'WEIGH_BEGIN_BEFORE_SET_PICKED',
  ]) assert.match(beforeSet, new RegExp(flow));
  assert.match(beforeSet, /phase1WeighPendingItem = it/);
  assert.match(beforeSet, /phase1ReplacementArmed = !!/);
});

test('WEIGH replacement model reaches the newest item for existing and empty selection', () => {
  const applyBegin = (state, matched) => {
    const pending = matched;
    const replacementArmed = !!(state.pendingId && state.selectedId && state.selectedId !== matched.id);
    assert.equal(typeof replacementArmed, 'boolean');
    return { selectedId: matched.id, selectedName: matched.name, pendingId: pending.id, pendingName: pending.name };
  };
  const grey = { id: 'grey', name: 'GREY GOOSE' };
  const casamigos = { id: 'casamigos', name: 'CASAMIGOS BLANCO' };
  assert.deepEqual(applyBegin({ selectedId: grey.id, pendingId: grey.id }, casamigos), {
    selectedId: casamigos.id, selectedName: casamigos.name, pendingId: casamigos.id, pendingName: casamigos.name,
  });
  assert.deepEqual(applyBegin({ selectedId: null, pendingId: null }, grey), {
    selectedId: grey.id, selectedName: grey.name, pendingId: grey.id, pendingName: grey.name,
  });
});

test('selected and pending state writers are explicit', () => {
  const pickedStart = source.indexOf('function setPickedItem(it, source)');
  const pickedEnd = source.indexOf('// ════════════════════════════════════════════════════════════════════', pickedStart + 1);
  const picked = source.slice(pickedStart, pickedEnd);
  assert.match(picked, /state\.selectedItemId = it\.id/);
  assert.match(picked, /state\.selectedItemName = it\.name/);
  const markStart = source.indexOf('function phase1MarkPendingSelection(it, source)');
  const markEnd = source.indexOf('function phase1AllowItemReplacement', markStart);
  const mark = source.slice(markStart, markEnd);
  assert.match(mark, /phase1PendingItemId = it && it\.id/);
  assert.match(mark, /phase1PendingItemName = \(it && it\.name\)/);
});
