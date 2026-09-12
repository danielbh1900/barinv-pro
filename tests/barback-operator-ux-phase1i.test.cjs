const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'barback.html'), 'utf8');

test('Phase 1I resets the presentation measure mode to UNITS on action selection', () => {
  const start = html.indexOf("state.selectedAction = btn.dataset.action;");
  const end = html.indexOf("Feedback.scan();", start);
  assert.ok(start >= 0 && end > start);
  const actionHandler = html.slice(start, end);
  assert.match(actionHandler, /phase1MeasureUnit = 'UNITS'/);
  assert.match(actionHandler, /phase1MeasureUnit = 'UNITS'[\s\S]*applyActionTint\(\)/);
});

test('RETURN defaults to the same unit console as TAKE', () => {
  assert.match(html, /let phase1MeasureUnit = 'UNITS'/);
  assert.match(html, /taken \? 'BOTTLE \/ ITEM QUANTITY' : returned \? 'RETURNED UNITS'/);
  assert.match(html, /!weight && \(taken \|\| returned\)/);
  assert.match(html, /weightUI\.style\.display = weight && \(taken \|\| returned\) \? '' : 'none'/);
  assert.doesNotMatch(html, /RETURN GRAMS/);
});

test('RETURN scale warning/widget requires explicit WEIGHT / GRAMS mode', () => {
  assert.match(html, /var _rfWeight = \(typeof phase1MeasureUnit !== 'undefined' && phase1MeasureUnit === 'WEIGHT'\)/);
  assert.match(html, /_rfBle\.style\.display = \(_rfRet && _rfWeight && _rfSup\)/);
  assert.match(html, /_rfHint\.style\.display = \(_rfRet && _rfWeight && !_rfSup\)/);
  assert.match(html, /id="phase1-weight-ui" class="phase1-weight-ui" style="display:none;"/);
});

test('Phase 1I keeps one numeric source and no new save path', () => {
  const start = html.indexOf('function phase1AdjustMeasure');
  const end = html.indexOf('function initPhase1BlockPresentation');
  assert.ok(start >= 0 && end > start);
  const source = html.slice(start, end);
  assert.match(source, /\$\('qty-input'\)/);
  assert.doesNotMatch(source, /eventsInsert|saveCore|addToReview|syncOutbox|fetch\(|\.from\(/);
});
