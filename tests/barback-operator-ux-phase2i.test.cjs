const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'barback.html'), 'utf8');

function functionSource(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const next = html.indexOf('\nfunction ', start + 10);
  return html.slice(start, next === -1 ? html.length : next);
}

test('Phase 2I explicitly hides the scanned-only card after selection is cleared', () => {
  const source = functionSource('phase1RenderPendingSelection');
  assert.match(source, /card\.style\.display = pending \? '' : 'none'/);
  assert.match(source, /aria-hidden/);
  assert.match(source, /card\.classList\.toggle\('active', pending\)/);
});

test('Phase 2I successful Add clears pending card content path and keeps Add guarded', () => {
  const save = html.slice(html.indexOf("$('save-btn').addEventListener"), html.indexOf('// ════════════════════════════════════════════════════════════════════\n//  Success / error overlay', html.indexOf("$('save-btn').addEventListener")));
  assert.match(save, /state\.selectedItemId = null;/);
  assert.match(save, /phase1RenderPendingSelection\(\);/);
  assert.doesNotMatch(save, /Press ADD TO REVIEW to create the Draft/);
  assert.match(functionSource('syncAddButtonLabel'), /SCAN \/ SELECT ITEM FIRST/);
});

test('Phase 2I preserves success, review, and workflow markers', () => {
  for (const marker of [
    'ADDED TO DRAFT', 'VIEW REVIEW', 'resolveScanWorkflow', 'FAST 1 EACH',
    'SET QTY', 'WEIGH', 'phase1-weigh-pending', 'rapidScanBusy',
    'safeReviewRowHTML', '_qnksScaleDivisor'
  ]) assert.ok(html.includes(marker), `missing ${marker}`);
});
