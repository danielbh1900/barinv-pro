const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'barback.html'), 'utf8');

test('Phase 1P uses Web Bluetooth requestDevice feature detection', () => {
  assert.match(html, /function hasWebBluetoothScaleSupport\(\)/);
  assert.match(html, /navigator\.bluetooth && typeof navigator\.bluetooth\.requestDevice === 'function'/);
  assert.match(html, /bleScale\.supported = hasWebBluetoothScaleSupport\(\)/);
  assert.match(html, /if \(!hasWebBluetoothScaleSupport\(\)\) return;/);
});

test('Phase 1P does not hard-block Bluefy/iPhone by user agent', () => {
  const start = html.indexOf('function phase1ScaleShouldStartCollapsed');
  const end = html.indexOf('function setPhase1ScaleCollapsed', start);
  const source = html.slice(start, end);
  assert.match(source, /return !hasWebBluetoothScaleSupport\(\) && !_nativeScaleAvailable\(\)/);
  assert.doesNotMatch(source, /const ua|const platform|iphone\s*=/i);
});

test('Phase 1P preserves scale access row and existing connection path', () => {
  assert.match(html, /id="phase1-scale-access"/);
  assert.match(html, /id="phase1-scale-access-open"[^>]*>CONNECT \/ DETAILS/);
  assert.match(html, /main-ble-connect.*_bleConnect\(true\)/s);
  assert.match(html, /navigator\.bluetooth\.requestDevice\(opts\)/);
  assert.match(html, /id="phase1-scale-details"/);
});

test('Phase 1P exposes Bluetooth and requestDevice diagnostics in Scale Details', () => {
  assert.match(html, /Bluetooth API: <span id="diag-ble">/);
  assert.match(html, /requestDevice: <span id="diag-request-device">/);
  assert.match(html, /Native bridge: <span id="diag-native-bridge">/);
  assert.match(html, /Bluetooth API: <span id="diag-ble2">/);
  assert.match(html, /requestDevice: <span id="diag-request-device2">/);
  assert.match(html, /Native bridge: <span id="diag-native-bridge2">/);
  assert.match(html, /var hasRequestDevice = hasWebBluetoothScaleSupport\(\)/);
  assert.match(html, /var hasNative = !!_nativeScaleAvailable\(\)/);
  assert.match(html, /set\('diag-request-device', requestTxt\)/);
  assert.match(html, /set\('diag-request-device2', requestTxt\)/);
});

test('Phase 1P retains manual fallback and prior UX markers', () => {
  for (const marker of [
    'SCALE: unavailable on this browser',
    'Manual grams available',
    'ACCESSORY / TARE',
    'NO CAP / 0g',
    'SPEAK ITEM NAMES',
    'SCANNED — NOT ADDED YET',
  ]) {
    assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
  }
});
