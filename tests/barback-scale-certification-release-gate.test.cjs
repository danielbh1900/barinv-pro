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

function harness() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        checked: false,
        disabled: false,
        textContent: '',
        value: '',
        style: { display: 'none', opacity: '1', cursor: 'pointer' },
      });
    }
    return elements.get(id);
  };
  const statuses = [];
  const confirmations = [];
  const context = {
    bleScale: {
      supported: true,
      nativeMode: false,
      connected: true,
      latest: null,
    },
    state: { selectedAction: 'TAKEN' },
    _BLE_SURFACES: ['main-ble', 'qm-ble', 'rf-ble'],
    $: element,
    statusOn: (...args) => statuses.push(args),
    updateRemainingDisplay: () => { context.remainingUpdates += 1; },
    _qmUpdateRemaining: () => { context.modalRemainingUpdates += 1; },
    Feedback: { ok: () => { context.feedbackCount += 1; } },
    Date,
    isFinite,
    remainingUpdates: 0,
    modalRemainingUpdates: 0,
    feedbackCount: 0,
    confirmResult: false,
  };
  context.window = {
    confirm: prompt => {
      confirmations.push(prompt);
      return context.confirmResult;
    },
  };

  vm.runInNewContext(
    between(
      html,
      '// SCALE_BRIDGE_TRUST_BOUNDARY_V1_START',
      '// SCALE_BRIDGE_TRUST_BOUNDARY_V1_END',
    ),
    context,
    { filename: 'barback-scale-trust-core.js' },
  );
  vm.runInNewContext(
    between(
      html,
      '// SCALE_CERTIFICATION_RELEASE_GATE_V1_START',
      '// SCALE_CERTIFICATION_RELEASE_GATE_V1_END',
    ),
    context,
    { filename: 'barback-scale-certification-gate.js' },
  );

  const useStart = html.indexOf('function _bleUseLatest()');
  const useEnd = html.indexOf('// Capability detection', useStart);
  assert.ok(useStart >= 0 && useEnd > useStart, 'scale field-fill source not found');
  vm.runInNewContext(
    html.slice(useStart, useEnd),
    context,
    { filename: 'barback-scale-use.js' },
  );

  return { context, element, elements, statuses, confirmations };
}

function trustedReading(grams, source = 'local_web_bluetooth') {
  return {
    grams,
    raw: grams,
    stable: true,
    trusted: true,
    source,
  };
}

test('1. every direct scale surface states beta, operator verification, and legal-for-trade warning', () => {
  assert.match(html, /id="scale-certification-gate"/);
  assert.match(html, /Beta scale estimate — operator verification required/);
  assert.match(html, /not certified or legal-for-trade/i);
  assert.match(html, /Enable uncertified scale estimates for this page only/);
  assert.equal((html.match(/class="scale-certification-warning"/g) || []).length, 2);
});

test('2. physical certification is false and beta use is default-off and page-scoped', () => {
  const gateSource = between(
    html,
    '// SCALE_CERTIFICATION_RELEASE_GATE_V1_START',
    '// SCALE_CERTIFICATION_RELEASE_GATE_V1_END',
  );
  assert.match(gateSource, /var SCALE_PHYSICAL_CERTIFICATION_COMPLETE = false;/);
  assert.match(gateSource, /var scaleCertificationGate = \{ betaEnabled: false \};/);
  assert.doesNotMatch(gateSource, /localStorage|sessionStorage/);

  const h = harness();
  assert.equal(h.context._scaleBetaEnabled(), false);
  h.context.bleScale.connected = false;
  h.context._scaleSyncCertificationGateUI();
  assert.equal(h.element('main-ble-connect').disabled, true);
  assert.equal(h.element('scale-set-known').disabled, true);
});

test('3. beta must be explicitly enabled before a scale estimate can fill a field', () => {
  const h = harness();
  h.context.bleScale.latest = trustedReading(618);
  h.element('weight-g-input').value = '410';

  h.context._bleUseLatestMain();

  assert.equal(h.element('weight-g-input').value, '410');
  assert.equal(h.confirmations.length, 0);
  assert.match(h.statuses.at(-1)[1], /Scale estimates are off/);
});

test('4. enabled but unconfirmed scale estimate cannot fill TAKEN, RETURN, or partial fields', () => {
  const h = harness();
  h.context._scaleSetBetaEnabled(true);
  h.context.confirmResult = false;
  h.context.bleScale.latest = trustedReading(618);
  h.element('weight-g-input').value = '410';
  h.element('qty-input').value = '12';
  h.element('qm-weight').value = '390';

  h.context.state.selectedAction = 'TAKEN';
  h.context._bleUseLatestMain();
  h.context._bleUseLatest();
  h.context._weightUseScaleFill();
  h.context.state.selectedAction = 'RETURNED';
  h.context._bleUseLatestMain();
  h.context._bleUseLatestReturn();

  assert.equal(h.element('weight-g-input').value, '410');
  assert.equal(h.element('qty-input').value, '12');
  assert.equal(h.element('qm-weight').value, '390');
  assert.equal(h.context.remainingUpdates, 0);
  assert.equal(h.context.modalRemainingUpdates, 0);
  assert.equal(h.confirmations.length, 5);
  assert.match(h.confirmations[0], /uncertified internal inventory estimate/i);
  assert.match(h.confirmations[0], /not legal-for-trade/i);
});

test('5. confirmed direct reading fills a partial bottle weight and recalculates remaining', () => {
  const h = harness();
  h.context._scaleSetBetaEnabled(true);
  h.context.confirmResult = true;
  h.context.bleScale.latest = trustedReading(618);

  h.context._bleUseLatest();

  assert.equal(h.element('qm-weight').value, '618');
  assert.equal(h.context.modalRemainingUpdates, 1);
  assert.match(h.statuses.at(-1)[1], /Uncertified scale estimate/);
});

test('6. confirmed direct reading supports TAKEN bottle weight without submission', () => {
  const h = harness();
  h.context._scaleSetBetaEnabled(true);
  h.context.confirmResult = true;
  h.context.bleScale.latest = trustedReading(731);
  h.context.state.selectedAction = 'TAKEN';

  h.context._bleUseLatestMain();

  assert.equal(h.element('weight-g-input').value, '731');
  assert.equal(h.context.remainingUpdates, 1);
  assert.match(h.confirmations[0], /TAKEN bottle weight/);
});

test('7. confirmed native reading supports RETURN grams', () => {
  const h = harness();
  h.context._scaleSetBetaEnabled(true);
  h.context.confirmResult = true;
  h.context.bleScale.nativeMode = true;
  h.context.bleScale.latest = trustedReading(845, 'local_native_ble');
  h.context.state.selectedAction = 'RETURNED';

  h.context._bleUseLatestMain();

  assert.equal(h.element('qty-input').value, '845');
  assert.match(h.confirmations[0], /RETURN quantity/);
});

test('8. manual grams inputs remain available and outside the scale gate', () => {
  assert.match(html, /id="weight-g-input"[^>]*type="number"/);
  assert.match(html, /id="qty-input"[^>]*type="number"/);
  assert.match(html, /id="qm-weight"[^>]*type="number"/);
  assert.doesNotMatch(
    between(
      html,
      '// SCALE_CERTIFICATION_RELEASE_GATE_V1_START',
      '// SCALE_CERTIFICATION_RELEASE_GATE_V1_END',
    ),
    /weight-g-input['"]\)\.disabled|qty-input['"]\)\.disabled|qm-weight['"]\)\.disabled/,
  );
});

test('9. both Web Bluetooth and native BLE connection entry points require beta enablement', () => {
  const webStart = html.indexOf('async function _bleConnect(allDevices)');
  const nativeStart = html.indexOf('async function _nativeScaleConnect(allDevices)');
  assert.notEqual(webStart, -1);
  assert.notEqual(nativeStart, -1);
  assert.match(html.slice(webStart, webStart + 180), /_scaleRequireBetaEnabled\('scale connection'\)/);
  assert.match(html.slice(nativeStart, nativeStart + 220), /_scaleRequireBetaEnabled\('native scale connection'\)/);
});

test('10. local offset/calibration controls require beta enablement', () => {
  const start = html.indexOf('(function _wireScaleOffset()');
  const end = html.indexOf("if ($('qm-minus'))", start);
  assert.ok(start >= 0 && end > start);
  const source = html.slice(start, end);
  assert.match(source, /_scaleRequireBetaEnabled\('scale calibration'\)/);
  assert.match(source, /_scaleRequireBetaEnabled\('scale zero'\)/);
  assert.match(source, /_scaleRequireBetaEnabled\('scale offset'\)/);
});

test('11. remote bridge remains disabled and display-only', () => {
  assert.match(html, /var SCALE_BRIDGE_RELEASE_ENABLED = false;/);
  assert.match(html, /Remote Scale Bridge is disabled for public release/);
  assert.match(html, /Remote weight is display-only/);
});

test('12. partial bottle percentage calculation remains available for manual or confirmed grams', () => {
  const start = html.indexOf('function normalizeWeightG(raw)');
  const end = html.indexOf('// Notes enrichment for the weight profile', start);
  assert.ok(start >= 0 && end > start, 'weight-profile calculation source not found');
  const context = {
    localStorage: {
      getItem: () => null,
      setItem: () => {},
    },
    Date,
    isFinite,
  };
  vm.runInNewContext(
    html.slice(start, end) + '\nthis.WeightProfiles = WeightProfiles;',
    context,
    { filename: 'barback-partial-bottle-calculation.js' },
  );

  const profile = { tare_weight_g: 200, full_weight_g: 1000 };
  assert.equal(context.WeightProfiles.calcRemaining(600, profile), 50);
  assert.equal(context.WeightProfiles.calcRemaining('600', profile), 50);
  assert.equal(context.WeightProfiles.calcRemaining(100, profile), 0);
  assert.equal(context.WeightProfiles.calcRemaining(1200, profile), 100);
});
