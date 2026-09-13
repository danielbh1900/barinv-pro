const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'barback.html'), 'utf8');

test('Phase 1T restores a rapid processing lock and bounded reset', () => {
  assert.match(html, /rapidScanBusy: false/);
  assert.match(html, /if \(state\.qtyModalItem \|\| state\.rapidScanBusy\) return;/);
  assert.match(html, /state\.rapidScanBusy = true;/);
  assert.match(html, /state\.rapidScanResetTimer = setTimeout/);
  assert.match(html, /releaseRapidScanLock\(\)/);
});

test('Phase 1T preserves same-barcode cooldown and rapid modal gating', () => {
  assert.match(html, /DUPE_SCAN_WINDOW_MS/);
  assert.match(html, /const last = state\.scannerCooldown\[code\] \|\| 0/);
  assert.match(html, /state\.qtyModalItem = it/);
  assert.match(html, /closeQtyModal\(\);/);
});

test('Phase 1T makes modal open/add/close recovery explicit', () => {
  const open = html.slice(html.indexOf('function openQtyModal'), html.indexOf('function closeQtyModal'));
  const add = html.slice(html.indexOf('function qtyModalAdd'), html.indexOf('// ════════════════════════════════════════════════════════════════════', html.indexOf('function qtyModalAdd')));
  const closeStart = html.indexOf('function closeScanner');
  const close = html.slice(closeStart, html.indexOf("$('scan-btn')", closeStart));
  assert.match(open, /try \{/);
  assert.match(open, /catch \(e\)/);
  assert.match(open, /return false/);
  assert.match(add, /VoiceGuide\.announceOperationalState\('failed'/);
  assert.match(add, /closeQtyModal\(\);/);
  assert.match(close, /closeQtyModal\(\);/);
});

test('Phase 1T retains safe operational voice and scale paths', () => {
  for (const marker of [
    'announceOperationalState', 'VOICE GUIDE', 'SPEAK ITEM NAMES',
    'hasWebBluetoothScaleSupport', 'navigator.bluetooth.requestDevice',
    'CONNECT / DETAILS', 'ACCESSORY / TARE', 'NET SAVED WEIGHT'
  ]) assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
  assert.doesNotMatch(html.slice(html.indexOf('const VoiceGuide = {'), html.indexOf('let phase1MeasureUnit')), /AudioContext|new Audio\(/);
});
