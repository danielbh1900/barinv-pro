const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'barback.html'), 'utf8');

test('Phase 1G keeps TAKE units as the short primary console', () => {
  assert.match(html, /taken \? 'BOTTLE \/ ITEM QUANTITY' : returned \? 'RETURNED UNITS'/);
  assert.match(html, /id="phase1-taken-minus"/);
  assert.match(html, /id="phase1-taken-plus"/);
  assert.match(html, /id="phase1-sticky-add-slot"/);
  assert.match(html, /id="phase1-review-btn"/);
  assert.match(html, /id="phase1-last-added-card"/);
  assert.match(html, /lastAdded\.insertAdjacentElement\('afterend', more\)/);
});

test('Phase 1G keeps secondary fields out of the default work console', () => {
  assert.match(html, /id="phase1-more-options"/);
  assert.match(html, /id="phase1-more-options"[\s\S]*id="weight-g-input"/);
  assert.match(html, /id="phase1-more-options"[\s\S]*id="bottle-state-select"/);
  assert.match(html, /id="phase1-more-options"[\s\S]*id="notes-input"/);
  assert.match(html, /id="phase1-more-options"[\s\S]*id="weight-profile-section"/);
  assert.match(html, /const moreInner = \$\('phase1-more-options-inner'\)/);
  assert.match(html, /moreInner\.appendChild\(scaleRow\)/);
  assert.match(html, /const moreEl = \$\('phase1-more-options'\); const moreOpen = !!\(moreEl && moreEl\.open\)/);
  assert.match(html, /options\.style\.display = !measureWeight && \(bottleState === 'PARTIAL'/);
});

test('Phase 1G preserves RETURN units and weight-only grams controls', () => {
  assert.doesNotMatch(html, /RETURN GRAMS/);
  assert.match(html, /weightUI\.style\.display = weight && \(taken \|\| returned\) \? '' : 'none'/);
  assert.match(html, /id="phase1-weight-ui" class="phase1-weight-ui" style="display:none;"/);
  assert.match(html, /var _rfBle = \$\('rf-ble'\); if \(_rfBle\) _rfBle\.style\.display = \(_rfRet && _rfWeight && _rfSup\)/);
});

test('Phase 1G adds no persistence path to the presentation controls', () => {
  const start = html.indexOf('function phase1AdjustMeasure');
  const end = html.indexOf('function initPhase1BlockPresentation');
  assert.ok(start >= 0 && end > start);
  const source = html.slice(start, end);
  assert.match(source, /\$\('qty-input'\)/);
  assert.doesNotMatch(source, /eventsInsert|saveCore|addToReview|syncOutbox|fetch\(|\.from\(/);
});
