const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'barback.html'), 'utf8');

test('Phase 1L distinguishes selected items from actual Drafts', () => {
  assert.match(html, /SCANNED — NOT ADDED YET/);
  assert.match(html, /Press ADD TO REVIEW to create the Draft/);
  assert.match(html, /phase1MarkPendingSelection\(it\)/);
  assert.match(html, /ADDED TO DRAFT/);
  assert.match(html, /const draftCountBefore = Drafts\.count\(\)/);
  assert.match(html, /draftCountAfter <= draftCountBefore/);
  assert.match(html, /FAILED \/ BLOCKED — Add reported success, but Draft count did not change/);
  assert.match(html, /phase1PendingItemId = null/);
});

test('Phase 1L prevents silent replacement of an unadded selection', () => {
  assert.match(html, /function phase1AllowItemReplacement\(it\)/);
  assert.match(html, /Previous scanned item was not added/);
  assert.match(html, /window\.confirm\(/);
  assert.match(html, /REPLACE WITH A DIFFERENT ITEM/);
  assert.match(html, /phase1ReplacementArmed/);
  assert.match(html, /current item kept/);
});

test('Phase 1L resets tare UI after confirmed Draft creation without adding a save path', () => {
  assert.match(html, /function phase1ResetTareAfterAdd\(\)/);
  assert.match(html, /gross\.value = ''/);
  assert.match(html, /custom\.value = ''/);
  assert.match(html, /phase1TareGrams = 0/);
  assert.match(html, /phase1ShowDraftSuccess\(savedAction, savedItemName, n, savedCalculation\)/);
  assert.match(html, /Saved net:/);
  assert.doesNotMatch(html.slice(html.indexOf('function phase1MarkPendingSelection'), html.indexOf('function phase1AdjustMeasure')), /eventsInsert|saveCore|addToReview|syncOutbox|fetch\(|\.from\(/);
});

test('Phase 1L preserves Phase 1K tare controls and UNITS behavior', () => {
  assert.match(html, /MEASURED WEIGHT ON SCALE/);
  assert.match(html, /NO CAP \/ 0g/);
  assert.match(html, /BOTTLE CAP \/ −4g/);
  assert.match(html, /POUR SPOUT \/ −16g/);
  assert.match(html, /CUSTOM TARE/);
  assert.match(html, /const net = Math\.max\(0, gross - tare\)/);
  assert.match(html, /let phase1MeasureUnit = 'UNITS'/);
  assert.match(html, /qty\.value = String\(net\)/);
  assert.doesNotMatch(html, /phase1MeasureUnit = 'TRANSFER'/);
});

test('Phase 1L keeps both action unit modes at one by default and after add reset', () => {
  assert.match(html, /<input id="qty-input"[^>]*value="1"/);
  assert.match(html, /function phase1EnsureUnitsDefault\(\)/);
  assert.match(html, /if \(!weight\) phase1EnsureUnitsDefault\(\)/);
  assert.match(html, /\$\('qty-input'\)\.value = '1';/);
  assert.match(html, /phase1MeasureUnit = 'UNITS';/);
});

test('Phase 1L renders a neutral empty gross state instead of a zero calculation', () => {
  assert.match(html, /const grossRaw = String\(\(grossInput && grossInput\.value\) \|\| ''\)\.trim\(\)/);
  assert.match(html, /if \(grossRaw === '' \|\| !Number\.isFinite\(gross\)\)/);
  assert.match(html, /NET SAVED WEIGHT<strong>Enter measured gross weight<\/strong>/);
  assert.doesNotMatch(html, /0g − 0g = 0g saved/);
  assert.match(html, /if \(grossRaw === '' \|\| !Number\.isFinite\(gross\)\) return ''/);
});
