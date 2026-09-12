const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'barback.html'), 'utf8');

test('Phase 1K replaces generic gram helpers with accessory tare controls', () => {
  assert.match(html, /id="phase1-weight-ui"/);
  assert.match(html, /MEASURED WEIGHT ON SCALE/);
  assert.match(html, /id="phase1-gross-weight"[^>]*placeholder="e\.g\. 800"/);
  assert.match(html, /data-phase1-tare="0"[^>]*class="selected"[^>]*>NO CAP \/ 0g/);
  assert.match(html, /data-phase1-tare="4"[^>]*>BOTTLE CAP \/ −4g/);
  assert.match(html, /data-phase1-tare="16"[^>]*>POUR SPOUT \/ −16g/);
  assert.match(html, /data-phase1-tare="custom"[^>]*>CUSTOM TARE/);
  assert.doesNotMatch(html, /data-phase1-gram-step/);
});

test('Phase 1K calculates net grams from one gross reading without double subtraction', () => {
  assert.match(html, /id="phase1-net-weight"[^>]*>NET SAVED WEIGHT/);
  assert.match(html, /const net = Math\.max\(0, gross - tare\)/);
  assert.match(html, /const tare = custom \? \(Number\.isFinite\(customTare\) \? Math\.max\(0, customTare\) : 0\) : phase1TareGrams/);
  assert.match(html, /\$\('phase1-gross-weight'\)\?\.addEventListener\('input', phase1RenderWeightTare\)/);
  assert.match(html, /phase1TareGrams = btn\.dataset\.phase1Tare === 'custom' \? 'custom' : Number\(btn\.dataset\.phase1Tare\)/);
  assert.match(html, /qty\.value = String\(net\)/);
});

test('Phase 1K uses the same tare UI for TAKE and RETURN weight modes', () => {
  assert.match(html, /actionLabel \+ ' WEIGHT \/ GRAMS'/);
  assert.match(html, /phase1MeasureUnit === 'WEIGHT'/);
  assert.match(html, /weight && \(taken \|\| returned\) \? '' : 'none'/);
  assert.match(html, /weightUI\.style\.display = weight && \(taken \|\| returned\) \? '' : 'none'/);
});

test('Phase 1K preserves unit mode and adds no persistence path', () => {
  assert.match(html, /let phase1MeasureUnit = 'UNITS'/);
  assert.match(html, /!weight && \(taken \|\| returned\)/);
  const start = html.indexOf('function phase1RenderWeightTare');
  const end = html.indexOf('function renderPhase1MeasureControls');
  assert.ok(start >= 0 && end > start);
  assert.match(html.slice(start, end), /\$\('qty-input'\)/);
  assert.doesNotMatch(html.slice(start, end), /eventsInsert|saveCore|addToReview|syncOutbox|fetch\(|\.from\(/);
});
