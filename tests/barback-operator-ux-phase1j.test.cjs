const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'barback.html'), 'utf8');

test('Phase 1J scopes green RETURN accents to the shared Measure and Last Added surfaces', () => {
  assert.match(html, /#phase1-measure-block\.phase1-action-returned \.phase1-measure-unit-row button\.selected/);
  assert.match(html, /#phase1-measure-block\.phase1-action-returned \.phase1-measure-input-line input/);
  assert.match(html, /\.phase1-last-added\.phase1-last-added-return/);
  assert.match(html, /measureBlock\.classList\.toggle\('phase1-action-returned', returned\)/);
  assert.match(html, /card\.classList\.toggle\('phase1-last-added-return', action === 'RETURN'\)/);
});

test('Phase 1J scopes orange TAKE accents to the shared Measure and Last Added surfaces', () => {
  assert.match(html, /#phase1-measure-block\.phase1-action-taken \.phase1-measure-unit-row button\.selected/);
  assert.match(html, /#phase1-measure-block\.phase1-action-taken \.phase1-measure-input-line input/);
  assert.match(html, /\.phase1-last-added\.phase1-last-added-taken/);
  assert.match(html, /measureBlock\.classList\.toggle\('phase1-action-taken', taken\)/);
  assert.match(html, /card\.classList\.toggle\('phase1-last-added-taken', action === 'TAKEN'\)/);
});

test('Phase 1J preserves the shared structure and neutral control boundaries', () => {
  assert.match(html, /id="phase1-measure-units"/);
  assert.match(html, /id="phase1-measure-weight"/);
  assert.match(html, /id="phase1-taken-minus"/);
  assert.match(html, /id="phase1-taken-plus"/);
  assert.match(html, /id="phase1-review-btn"/);
  assert.match(html, /id="phase1-last-added-card"/);
  assert.doesNotMatch(html, /#bar-pick-row[^\{]*\{[^}]*background:/);
  assert.doesNotMatch(html, /#search-input[^\{]*\{[^}]*background:/);
});

test('Phase 1J adds no persistence path to color rendering', () => {
  const start = html.indexOf('function renderPhase1MeasureControls');
  const end = html.indexOf('function initPhase1BlockPresentation');
  assert.ok(start >= 0 && end > start);
  const source = html.slice(start, end);
  assert.doesNotMatch(source, /eventsInsert|saveCore|addToReview|syncOutbox|fetch\(|\.from\(/);
});
