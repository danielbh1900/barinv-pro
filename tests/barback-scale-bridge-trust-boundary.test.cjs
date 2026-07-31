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

function functionSource(name, endMarker) {
  const start = html.indexOf(`function ${name}(`);
  const end = html.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `${name} source not found`);
  return html.slice(start, end);
}

function harness() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        value: '',
        textContent: '',
        disabled: false,
        style: { display: 'none', opacity: '1' },
      });
    }
    return elements.get(id);
  };
  const statuses = [];
  const context = {
    bleScale: {
      supported: true,
      nativeMode: false,
      connected: true,
      latest: null,
    },
    bridge: {
      latest: null,
      publishing: false,
      listening: false,
      lastPayload: '',
    },
    state: { selectedAction: 'TAKEN' },
    $: element,
    statusOn: (...args) => statuses.push(args),
    updateRemainingDisplay: () => { context.remainingUpdates += 1; },
    _qmUpdateRemaining: () => { context.modalRemainingUpdates += 1; },
    Feedback: { ok: () => { context.feedbackCount += 1; } },
    _bridgeReleaseBlocked: () => {
      context.bridgeBlockedCount += 1;
      return true;
    },
    Date,
    isFinite,
    remainingUpdates: 0,
    modalRemainingUpdates: 0,
    feedbackCount: 0,
    bridgeBlockedCount: 0,
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

  const useStart = html.indexOf('function _bleUseLatest()');
  const useEnd = html.indexOf('// Capability detection', useStart);
  assert.ok(useStart >= 0 && useEnd > useStart, 'trusted scale field-fill source not found');
  vm.runInNewContext(
    html.slice(useStart, useEnd),
    context,
    { filename: 'barback-trusted-scale-use.js' },
  );

  vm.runInNewContext(
    between(
      html,
      '// SCALE_BRIDGE_UNTRUSTED_RECEIVER_V1_START',
      '// SCALE_BRIDGE_UNTRUSTED_RECEIVER_V1_END',
    ),
    context,
    { filename: 'barback-untrusted-bridge-receiver.js' },
  );

  vm.runInNewContext(
    functionSource('_bridgeUse', '// SCALE_OFFSET — wire the calibration controls'),
    context,
    { filename: 'barback-untrusted-bridge-use.js' },
  );

  return { context, element, elements, statuses };
}

test('1. Scale Bridge is release-gated and operator controls are disabled', () => {
  assert.match(html, /var SCALE_BRIDGE_RELEASE_ENABLED = false;/);
  assert.match(html, /id="bridge-listen" disabled/);
  assert.match(html, /id="bridge-start-station" disabled/);
  assert.match(html, /id="bridge-use" disabled/);
  assert.match(html, /Remote Scale Bridge is disabled for public release/);
});

test('2. every bridge network entry point has the release guard', () => {
  const guarded = [
    ['async function _bridgeLoadLib()', 'return false'],
    ['function _bridgeMakeClient()', 'return null'],
    ['async function _bridgeEnsureChannel()', 'return null'],
    ['async function _bridgeHttp(action, extra)', 'return null'],
    ['async function _bridgeHttpPublish(payload)', 'return'],
    ['async function _bridgePollLatest()', 'return'],
    ['async function _bridgeListen()', 'return'],
    ['function _bridgeHeartbeatPublish()', 'return'],
    ['async function _bridgeStartStation()', 'return'],
    ['function _bridgeMaybePublish(r, hex)', 'return'],
  ];

  for (const [signature, expectedReturn] of guarded) {
    const start = html.indexOf(signature);
    assert.notEqual(start, -1, `missing ${signature}`);
    const opening = html.slice(start, start + 180);
    assert.match(
      opening,
      new RegExp(`if \\(_bridgeReleaseBlocked\\(\\)\\) ${expectedReturn.replace(' ', '\\s+')}`),
      `${signature} is not release-gated`,
    );
  }
});

test('3. remote realtime/HTTP weight remains untrusted display-only data', () => {
  const h = harness();
  const trusted = {
    grams: 482,
    stable: true,
    trusted: true,
    source: 'local_web_bluetooth',
  };
  h.context.bleScale.latest = trusted;

  const result = h.context._bridgeApplyWeight({
    grams: 9999,
    stable: true,
    station_id: 'remote-station',
    ts: '2026-07-30T12:00:00Z',
  }, 'realtime');

  assert.equal(result.applied, false);
  assert.equal(result.trusted, false);
  assert.equal(result.reason, 'untrusted_remote_bridge');
  assert.equal(h.context.bleScale.latest, trusted, 'trusted local reading must not be overwritten');
  assert.equal(h.context.bridge.latest.grams, 9999);
  assert.equal(h.context.bridge.latest.trusted, false);
  assert.match(h.element('bridge-weight').textContent, /UNTRUSTED \/ DISPLAY ONLY/);
  assert.equal(h.element('bridge-use').disabled, true);
  assert.match(h.element('bridge-use').textContent, /display-only/);
});

test('4. untrusted bridge weight cannot fill TAKEN, RETURN, or partial inputs', () => {
  const h = harness();
  h.context.bleScale.latest = {
    grams: 9999,
    stable: true,
    trusted: false,
    source: 'realtime',
  };
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
  h.context._bridgeUse();

  assert.equal(h.element('weight-g-input').value, '410');
  assert.equal(h.element('qty-input').value, '12');
  assert.equal(h.element('qm-weight').value, '390');
  assert.equal(h.context.remainingUpdates, 0);
  assert.equal(h.context.modalRemainingUpdates, 0);
  assert.ok(h.statuses.length >= 1);
  assert.match(h.statuses.at(-1)[1], /untrusted/);
});

test('5. trusted direct Web Bluetooth reading still fills partial and TAKEN weight', () => {
  const h = harness();
  h.context.bleScale.latest = {
    grams: 618,
    raw: 616,
    stable: true,
    trusted: true,
    source: 'local_web_bluetooth',
  };

  h.context._bleUseLatest();
  assert.equal(h.element('qm-weight').value, '618');
  assert.equal(h.context.modalRemainingUpdates, 1);

  h.context.state.selectedAction = 'TAKEN';
  h.context._bleUseLatestMain();
  assert.equal(h.element('weight-g-input').value, '618');
  assert.equal(h.context.remainingUpdates, 1);

  h.context._weightUseScaleFill();
  assert.equal(h.element('weight-g-input').value, '618');
  assert.equal(h.context.remainingUpdates, 2);
  assert.equal(h.context.feedbackCount, 1);
});

test('6. trusted direct native BLE reading still fills RETURN grams', () => {
  const h = harness();
  h.context.bleScale.nativeMode = true;
  assert.equal(h.context._localScaleSource(), 'local_native_ble');
  h.context.bleScale.latest = {
    grams: 731,
    stable: true,
    trusted: true,
    source: 'local_native_ble',
  };

  h.context.state.selectedAction = 'RETURNED';
  h.context._bleUseLatestMain();
  assert.equal(h.element('qty-input').value, '731');

  h.element('qty-input').value = '';
  h.context._bleUseLatestReturn();
  assert.equal(h.element('qty-input').value, '731');
});

test('7. unstable or spoofed-local readings cannot fill inventory inputs', () => {
  const h = harness();
  h.context.bleScale.latest = {
    grams: 455,
    stable: false,
    trusted: true,
    source: 'local_web_bluetooth',
  };
  h.context._bleUseLatestMain();
  assert.equal(h.element('weight-g-input').value, '');

  h.context.bleScale.latest = {
    grams: 455,
    stable: true,
    trusted: true,
    source: 'remote_bridge',
  };
  h.context._bleUseLatestMain();
  assert.equal(h.element('weight-g-input').value, '');
});

test('8. bridge no-weight handling does not clear a trusted local reading', () => {
  const h = harness();
  const trusted = {
    grams: 520,
    stable: true,
    trusted: true,
    source: 'local_web_bluetooth',
  };
  h.context.bleScale.latest = trusted;
  h.context.bridge.latest = null;

  h.context._bridgeShowNoWeight('no_row', {});

  assert.equal(h.context.bleScale.latest, trusted);
  assert.equal(h.context.bridge.latest, null);
  assert.equal(h.element('bridge-use').disabled, true);
});

test('9. only direct frame decode assigns trusted authoritative scale state', () => {
  const bridgeStart = html.indexOf('//  SCALE_BRIDGE — release-gated remote relay.');
  const bridgeEnd = html.indexOf('// SCALE_OFFSET — wire the calibration controls', bridgeStart);
  assert.ok(bridgeStart >= 0 && bridgeEnd > bridgeStart);
  const bridgeSource = html.slice(bridgeStart, bridgeEnd);
  assert.doesNotMatch(bridgeSource, /bleScale\.latest\s*=/);

  assert.match(
    html,
    /bleScale\.latest = \{[\s\S]*?trusted: true,[\s\S]*?source: _localScaleSource\(\)[\s\S]*?\};/,
  );
  assert.match(html, /function _bleOnFrame\(ev\)/);
  assert.match(html, /_bleDecodeFrame\(bytes\)/);
});

test('10. manual inputs remain available and bridge code performs no submission', () => {
  assert.match(html, /id="weight-g-input"/);
  assert.match(html, /id="qty-input"/);
  assert.match(html, /enter grams manually/i);

  const bridgeStart = html.indexOf('//  SCALE_BRIDGE — release-gated remote relay.');
  const bridgeEnd = html.indexOf('// SCALE_OFFSET — wire the calibration controls', bridgeStart);
  const bridgeSource = html.slice(bridgeStart, bridgeEnd);
  assert.doesNotMatch(bridgeSource, /\.from\(['"]events['"]\)/i);
  assert.doesNotMatch(bridgeSource, /submitAllDraftsToBarinv\s*\(/);
});

test('11. partial-bottle remaining calculation still accepts trusted or manual grams', () => {
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
