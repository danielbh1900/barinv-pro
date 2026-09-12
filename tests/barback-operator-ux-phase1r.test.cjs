const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'barback.html'), 'utf8');

function section(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `${startMarker} section exists`);
  return html.slice(start, end);
}

test('Phase 1R has one safe operational voice dispatcher and diagnostics', () => {
  assert.match(html, /announceOperationalState\(type, details\)/);
  assert.match(html, /Last operational voice:/);
  assert.match(html, /Last operational type:/);
  assert.match(html, /Last operational source:/);
  assert.match(html, /Last operational engine:/);
  assert.match(html, /type === 'scanned'/);
  assert.match(html, /type === 'added'/);
  assert.match(html, /type === 'blocked'/);
  assert.match(html, /'Not added\.'/);
  assert.doesNotMatch(section('announceOperationalState(type, details)', 'setSpeakItemNames(value)'), /fetch\(|\.from\(|eventsInsert|saveCore|addToReview|syncOutbox/);
});

test('Phase 1R routes all canonical selection paths through pending operational voice', () => {
  const picked = section('function setPickedItem(it, source)', '// ════════════════════════════════════════════════════════════════════');
  assert.match(picked, /phase1MarkPendingSelection\(it, source\)/);
  assert.match(picked, /phase1MarkPendingSelection\(it, source\)/);
  for (const source of ['search', 'browse', 'scan', 'chip']) assert.match(html, new RegExp("'" + source + "'"));
  assert.match(html, /function phase1MarkPendingSelection\(it, source\)/);
  assert.match(html, /announceOperationalState\('scanned'/);
  assert.match(html, /SCANNED — NOT ADDED YET/);
  assert.match(html, /openQtyModal\(it\)[\s\S]*setPickedItem\(it, 'scan'\)/);
});

test('Phase 1R protects replacement and distinguishes confirmed add from failure', () => {
  const replace = section('function phase1AllowItemReplacement', 'function phase1WeightCalculationText');
  assert.match(replace, /announceOperationalState\('blocked'/);
  const save = section("$('save-btn').addEventListener", 'function _');
  assert.match(save, /const draftCountBefore = Drafts\.count\(\)/);
  assert.match(save, /const draftCountAfter = Drafts\.count\(\)/);
  assert.match(save, /announceOperationalState\('added'/);
  assert.match(save, /announceOperationalState\('failed'/);
  const modal = section('function qtyModalAdd()', '// ════════════════════════════════════════════════════════════════════');
  assert.match(modal, /const draftCountBefore = Drafts\.count\(\)/);
  assert.match(modal, /n > draftCountBefore \? 'added' : 'failed'/);
});

test('Phase 1R keeps item-name safety, throttle rules, prior markers, and no audio clips', () => {
  assert.match(html, /safeItemName\(value\)/);
  assert.match(html, /lastMessage === message && now - this\.lastSpokenAt < wait/);
  assert.match(html, /urgent: type !== 'scanned'/);
  const voice = section('const VoiceGuide = {', 'let phase1MeasureUnit');
  assert.doesNotMatch(voice, /AudioContext|new Audio\(|assets\/voice\//);
  for (const marker of [
    'hasWebBluetoothScaleSupport', 'navigator.bluetooth.requestDevice', 'CONNECT / DETAILS',
    'Speech API:', 'SPEAK ITEM NAMES', 'ACCESSORY / TARE', 'NET SAVED WEIGHT',
    'UNITS', 'SCANNED — NOT ADDED YET', 'ADDED TO DRAFT'
  ]) assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
});
