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

test('Phase 2K.7 production keeps the tested hard-lock state machine', () => {
  const sync = functionSource('syncRapidNextScanUI');
  const arm = functionSource('armRapidNextScan');
  assert.match(sync, /state\.scannerContinuous === true/);
  assert.match(sync, /state\.rapidPhysicalRearmed === false/);
  assert.match(sync, /gate\.hidden = !locked/);
  assert.match(sync, /button\.disabled = !locked/);
  assert.match(arm, /resetRapidPhysicalRearm\(\)/);
  assert.match(arm, /state\.scannerCooldown = \{\}/);
});

test('Phase 2K.7 synchronizes FAST footer text with ARMED and LOCKED', () => {
  const sync = functionSource('syncRapidNextScanUI');
  assert.match(sync, /FAST 1 EACH: ADDED — TAP NEXT SCAN/);
  assert.match(sync, /FAST 1 EACH: READY TO SCAN/);
  assert.match(sync, /hint\.textContent/);
  assert.match(html, /id="scanner-hint"/);
});

test('Phase 2K.7 production gate uses thumb-zone safe-area placement', () => {
  const css = html.slice(html.indexOf('.rapid-next-gate {'), html.indexOf('.rapid-next-gate button {'));
  assert.match(css, /position:fixed/);
  assert.match(css, /bottom:calc\(80px \+ env\(safe-area-inset-bottom/);
  assert.match(css, /z-index:1000/);
  assert.match(html, /data-body-level="true"/);
});

test('Phase 2K.7 production has no Phase 2K.5 runtime-proof diagnostics', () => {
  for (const marker of ['PHASE 2K.5 RUNTIME PROOF', 'BUILD: 20260914-2K5', 'TEST CONTROL VISIBLE', 'RUNTIME PAGE: 2K.5']) {
    assert.equal(html.includes(marker), false, `test diagnostic leaked: ${marker}`);
  }
});

test('Phase 2K.7 preserves workflows and prior feature markers', () => {
  for (const marker of [
    'resolveScanWorkflow', 'FAST_UNOPENED_ONE_EACH', 'SET_QUANTITY_COUNT', 'WEIGH_PARTIAL',
    'safeReviewRowHTML', 'resolveQuantityAndWeightSemantics', '_qnksScaleDivisor',
    'canonicalBarcodeCooldownKey', 'VOICE GUIDE', 'CONNECT / DETAILS',
    'SCANNED — NOT ADDED YET', 'ADDED TO DRAFT', 'VIEW REVIEW',
  ]) assert.ok(html.includes(marker), `missing ${marker}`);
});
