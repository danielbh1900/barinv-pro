const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'barback.html'), 'utf8');
const reviewStart = html.indexOf('function renderReview()');
const reviewEnd = html.indexOf('// QUEUED-row Delete:', reviewStart);
const review = html.slice(reviewStart, reviewEnd);

test('Phase 1Y renders every local draft row instead of only the count', () => {
  assert.match(review, /const drafts = Drafts\.load\(\)/);
  assert.match(review, /if \(drafts\.length === 0\)/);
  assert.match(review, /g\.rows\.map\(d => safeReviewRowHTML\(buildDraftRowHTML, d, 'draft'\)\)/);
  assert.match(review, /DRAFT/);
  assert.match(review, /Qty: /);
  assert.match(review, /Weight \(g\): /);
});

test('Phase 1Y draft rows retain weighted and quantity-only values', () => {
  const draftBuilder = review.slice(review.indexOf('function buildDraftRowHTML'), review.indexOf('// A malformed local row'));
  assert.match(draftBuilder, /normalizeWeightG\(d\.weight_g\)/);
  assert.match(draftBuilder, /String\(d\.qty == null \? '—' : d\.qty\)/);
  assert.match(draftBuilder, /weightG == null \? '—' : String\(weightG\)/);
  assert.doesNotMatch(draftBuilder, /Number\(q\.qty\)/);
});

test('Phase 1Y degrades one malformed row without blanking Review', () => {
  assert.match(review, /function buildDegradedReviewRow\(row, kind\)/);
  assert.match(review, /function safeReviewRowHTML\(builder, row, kind\)/);
  assert.match(review, /catch \(_\) \{ return buildDegradedReviewRow\(row, kind\); \}/);
  assert.match(review, /g\.rows\.map\(q => safeReviewRowHTML\(buildQueuedRowHTML, q, 'queued'\)\)/);
});

test('Phase 1Y keeps Review navigation and row edit wiring', () => {
  assert.match(html, /function showReview\(\)/);
  assert.match(html, /showScreen\('screen-review'\)/);
  assert.match(review, /button\.d-edit/);
  assert.match(review, /onDraftEdit\(btn\.getAttribute\('data-d-ce'\)\)/);
  assert.match(html, /id="review-back-top"/);
  assert.match(html, /id="review-back"/);
});
