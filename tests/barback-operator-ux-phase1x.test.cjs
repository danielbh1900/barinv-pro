const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'barback.html'), 'utf8');

test('Phase 1X keeps VIEW REVIEW enabled and count-synchronized for drafts', () => {
  assert.match(html, /id="phase1-review-btn">VIEW REVIEW<\/button>/);
  assert.match(html, /btn\.textContent = drafts \? 'VIEW REVIEW \(' \+ drafts \+ '\)' : 'VIEW REVIEW'/);
  assert.match(html, /btn\.disabled = !drafts && !queued/);
  assert.match(html, /const n = Drafts\.count\(\)/);
  assert.match(html, /refreshDraftCount\(\);/);
});

test('Phase 1X opens Review before rendering so a render exception cannot make the tap inert', () => {
  const start = html.indexOf('function showReview()');
  const end = html.indexOf('// ════════════════════════════════════════════════════════════════════', start + 20);
  const source = html.slice(start, end);
  assert.ok(source.indexOf("showScreen('screen-review')") < source.indexOf('renderReview()'));
  assert.match(source, /try \{ renderReview\(\); \}/);
  assert.match(source, /Review could not fully render/);
  assert.match(html, /var phase1ReviewBtn = \$\('phase1-review-btn'\); if \(phase1ReviewBtn\) phase1ReviewBtn\.addEventListener\('click', \(\) => showReview\(\)\)/);
});

test('Phase 1X preserves current feature markers and does not add a save path', () => {
  for (const marker of [
    'rapidScanBusy', 'barcodeLookupVariants', 'resolveQuantityAndWeightSemantics',
    'phase1-gross-weight', 'Qty fixed: 1 for weighted entry',
    'CONNECT / DETAILS', 'VOICE GUIDE', 'SPEAK ITEM NAMES',
    'SCANNED — NOT ADDED YET', 'ADDED TO DRAFT'
  ]) assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
  const source = html.slice(html.indexOf('function showReview()'), html.indexOf('function undoLast'));
  assert.doesNotMatch(source, /eventsInsert|saveCore|addToReview|syncOutbox|\.from\(/);
});
