const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'barback.html'), 'utf8');

test('Phase 1O adds an always-discoverable scale access row', () => {
  assert.match(html, /id="phase1-scale-access"/);
  assert.match(html, /id="phase1-scale-access-status"[^>]*>SCALE: Not connected/);
  assert.match(html, /id="phase1-scale-access-open"[^>]*>CONNECT \/ DETAILS/);
  assert.match(html, /function phase1RenderScaleAccess\(\)/);
  assert.match(html, /phase1-scale-access-open.*showScreen\('phase1-scale-details'\)/s);
});

test('Phase 1O keeps scale discoverable in UNITS and WEIGHT modes', () => {
  const access = html.indexOf('id="phase1-scale-access"');
  const measure = html.indexOf('id="phase1-measure-block"');
  const sticky = html.indexOf('id="phase1-sticky-summary"');
  assert.ok(access > measure && access < sticky);
  assert.match(html, /phase1MeasureUnit === 'WEIGHT'/);
  assert.match(html, /SCALE: Connected/);
  assert.match(html, /SCALE: unavailable on this browser/);
  assert.match(html, /Open scale details and browser support information/);
});

test('Phase 1O preserves existing scale behavior and does not add a BLE path', () => {
  assert.match(html, /id="main-ble-connect"/);
  assert.match(html, /id="rf-ble-connect"/);
  assert.match(html, /main-ble-connect.*_bleConnect\(true\)/s);
  assert.match(html, /main-ble-hint/);
  assert.match(html, /navigator\.bluetooth/);
  const accessStart = html.indexOf('function phase1RenderScaleAccess');
  const accessEnd = html.indexOf('function initPhase1ScaleDisclosure', accessStart);
  assert.doesNotMatch(html.slice(accessStart, accessEnd), /_bleConnect|BluetoothLe|fetch\(|\.from\(|eventsInsert|saveCore/);
});

test('Phase 1O keeps the scale row out of the sticky action bar', () => {
  assert.match(html, /\.wrap \{[^}]*padding-bottom:120px/);
  assert.match(html, /\.phase1-scale-access \{/);
  assert.doesNotMatch(html, /#phase1-scale-access[^\{]*\{[^}]*position:\s*(?:fixed|sticky)/);
  assert.match(html, /id="phase1-sticky-summary"/);
  for (const marker of ['SPEAK ITEM NAMES', 'barbackVoiceGuideSpeakItemNames', 'ACCESSORY / TARE', 'NO CAP / 0g']) {
    assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
