const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'barback.html'), 'utf8');

test('TAKE and RETURN share one action-independent Measure structure', () => {
  assert.match(html, /id="phase1-measure-block"/);
  assert.match(html, /id="phase1-measure-units"/);
  assert.match(html, /id="phase1-measure-weight"/);
  assert.match(html, /id="phase1-taken-minus"/);
  assert.match(html, /id="phase1-taken-plus"/);
  assert.match(html, /measureBlock\.dataset\.action = action \|\| ''/);
  assert.match(html, /measureBlock\.dataset\.measure = phase1MeasureUnit/);
  assert.match(html, /!weight && \(taken \|\| returned\)/);
});

test('RETURN units stays unit-based and hides gram/scale warning surfaces', () => {
  assert.match(html, /returned \? 'RETURNED UNITS'/);
  assert.match(html, /weightUI\.style\.display = weight && \(taken \|\| returned\) \? '' : 'none'/);
  assert.match(html, /_rfBle\.style\.display = \(_rfRet && _rfWeight && _rfSup\)/);
  assert.match(html, /_rfHint\.style\.display = \(_rfRet && _rfWeight && !_rfSup\)/);
  assert.doesNotMatch(html, /RETURN GRAMS/);
});

test('TAKE and RETURN weight mode use the same explicit grams presentation', () => {
  assert.match(html, /actionLabel \+ ' WEIGHT \/ GRAMS'/);
  assert.match(html, /phase1MeasureUnit = 'WEIGHT'/);
  assert.match(html, /data-phase1-tare="0"/);
  assert.match(html, /data-phase1-tare="16"/);
});

test('Add/View/Last Added placement is shared and numeric source remains singular', () => {
  assert.match(html, /id="phase1-sticky-add-slot"/);
  assert.match(html, /id="phase1-review-btn"/);
  assert.match(html, /id="phase1-last-added-card"/);
  assert.match(html, /const input = \$\('qty-input'\)/);
  const start = html.indexOf('function phase1AdjustMeasure');
  const end = html.indexOf('function initPhase1BlockPresentation');
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(html.slice(start, end), /eventsInsert|saveCore|addToReview|syncOutbox|fetch\(|\.from\(/);
});
