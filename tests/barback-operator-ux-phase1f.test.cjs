const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'barback.html'), 'utf8');

test('Phase 1F keeps the visible MEASURE selector above the numeric input', () => {
  const measure = html.indexOf('id="phase1-measure-block"');
  const selector = html.indexOf('id="phase1-measure-units"', measure);
  const value = html.indexOf('id="qty-input"', selector);
  assert.ok(measure >= 0 && selector > measure && value > selector);
  assert.match(html, /id="phase1-measure-units"[^>]*aria-pressed="true"[^>]*>UNITS/);
  assert.match(html, /id="phase1-measure-weight"[^>]*aria-pressed="false"[^>]*>WEIGHT \/ GRAMS/);
  assert.match(html, /let phase1MeasureUnit = 'UNITS'/);
  assert.match(html, /id="qty-input"[^>]*value="1"/);
});

test('Phase 1F makes RETURN units explicit and gates grams on weight selection', () => {
  assert.match(html, /taken \? 'BOTTLE \/ ITEM QUANTITY' : returned \? 'RETURNED UNITS'/);
  assert.match(html, /actionLabel \+ ' WEIGHT \/ GRAMS'/);
  assert.match(html, /phase1-units-only.*id="phase1-taken-minus"/);
  assert.match(html, /phase1-units-only.*id="phase1-taken-plus"/);
  assert.match(html, /weightUI\.style\.display = weight && \(taken \|\| returned\) \? '' : 'none'/);
  assert.match(html, /id="phase1-weight-ui" class="phase1-weight-ui" style="display:none;"/);
  assert.doesNotMatch(html, /RETURN GRAMS/);
});

test('Phase 1F keeps bottle weight secondary and reuses the existing numeric source', () => {
  assert.match(html, /id="phase1-weight-options"[^>]*style="display:none;"/);
  assert.match(html, /options\.style\.display = !measureWeight && \(bottleState === 'PARTIAL'/);
  assert.match(html, /id="weight-g-input"/);
  assert.match(html, /const input = \$\('qty-input'\)/);
  assert.doesNotMatch(html, /phase1AdjustMeasure[\s\S]{0,900}(eventsInsert|saveCore|addToReview|syncOutbox|fetch\(|\.from\()/);
});
