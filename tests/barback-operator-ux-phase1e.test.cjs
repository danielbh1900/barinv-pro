const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'barback.html'), 'utf8');

test('Phase 1E separates ACTION from MEASURE and defaults to units', () => {
  assert.match(html, /data-action="TAKEN"/);
  assert.match(html, /data-action="RETURNED"/);
  assert.match(html, /id="phase1-measure-units"[^>]*aria-pressed="true"/);
  assert.match(html, /id="phase1-measure-weight"[^>]*aria-pressed="false"/);
  assert.match(html, /let phase1MeasureUnit = 'UNITS'/);
  assert.match(html, /id="qty-input"[^>]*value="1"/);
  assert.doesNotMatch(html, /RETURN GRAMS/);
});

test('TAKEN and RETURN units share the existing unit stepper', () => {
  assert.match(html, /id="phase1-taken-minus"/);
  assert.match(html, /id="phase1-taken-plus"/);
  assert.match(html, /phase1-units-only/);
  assert.match(html, /taken \? 'BOTTLE \/ ITEM QUANTITY' : returned \? 'RETURNED UNITS'/);
  assert.match(html, /phase1AdjustMeasure\(-1, phase1MeasureUnit === 'UNITS' \? 1 : 0\)/);
  assert.match(html, /Math\.max\(minimum, base \+ delta\)/);
});

test('TAKEN and RETURN weight use grams helpers only in weight mode', () => {
  assert.match(html, /id="phase1-return-gram-controls"[^>]*style="display:none;"/);
  assert.match(html, /TAKEN' : returned \? 'RETURNED' : ''/);
  assert.match(html, /actionLabel \+ ' WEIGHT \(GRAMS\)'/);
  assert.match(html, /weight && \(taken \|\| returned\) \? 'flex' : 'none'/);
  assert.match(html, /data-phase1-gram-step="-50"/);
  assert.match(html, /data-phase1-gram-step="50"/);
  assert.match(html, /phase1MeasureUnit = 'WEIGHT'/);
});

test('Phase 1E keeps one numeric source and does not add Transfer', () => {
  const start = html.indexOf('function phase1AdjustMeasure');
  const end = html.indexOf('function initPhase1BlockPresentation');
  assert.ok(start >= 0 && end > start);
  const measureSource = html.slice(start, end);
  assert.match(measureSource, /\$\('qty-input'\)/);
  assert.match(measureSource, /dispatchEvent\(new Event\('input'/);
  assert.match(measureSource, /dispatchEvent\(new Event\('change'/);
  assert.doesNotMatch(measureSource, /eventsInsert|saveCore|addToReview|syncOutbox|fetch\(|\.from\(/);
  assert.doesNotMatch(html, /data-action="TRANSFER"|id=".*transfer.*button/i);
});
