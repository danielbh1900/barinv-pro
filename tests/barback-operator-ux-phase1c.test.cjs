const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'barback.html'), 'utf8');

test('Phase 1C has action-aware measure controls', () => {
  assert.match(html, /id="phase1-taken-minus"/);
  assert.match(html, /id="phase1-taken-plus"/);
  assert.match(html, /id="qty-input"[^>]*value="1"/);
  assert.match(html, /id="phase1-return-gram-controls"/);
  assert.match(html, /−50g/);
  assert.match(html, /＋50g/);
  assert.match(html, /function renderPhase1MeasureControls\(\)/);
  assert.match(html, /taken \? 'BOTTLE \/ ITEM QUANTITY' : returned \? 'RETURNED UNITS'/);
  assert.match(html, /Math\.max\(minimum, base \+ delta\)/);
});

test('Phase 1C keeps measure value and PARTIAL weight visually distinct', () => {
  assert.match(html, /actionLabel \+ ' WEIGHT \(GRAMS\)'/);
  assert.match(html, /id="weight-g-input"/);
  assert.match(html, /PARTIAL requires weight/);
  assert.match(html, /id="phase1-more-options"/);
  assert.doesNotMatch(html, /RETURN GRAMS/);
});

test('Phase 1C controls use the existing input and do not add a save path', () => {
  const start = html.indexOf('function phase1AdjustMeasure');
  const end = html.indexOf('function renderPhase1MeasureControls');
  assert.ok(start >= 0 && end > start);
  const controlSource = html.slice(start, end);
  assert.match(controlSource, /\$\('qty-input'\)/);
  assert.doesNotMatch(controlSource, /eventsInsert|saveCore|addToReview|syncOutbox|fetch\(|\.from\(/);
});

test('Phase 1C exposes large review and Last Added markers', () => {
  assert.match(html, /id="phase1-review-btn"/);
  assert.match(html, /VIEW REVIEW/);
  assert.match(html, /id="phase1-last-added-card"/);
  assert.match(html, /phase1-last-added-view/);
  assert.match(html, /phase1-sticky-add-slot/);
});
