'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('wide desktop removes the centered main width cap', () => {
  assert.match(source, /\.main\s*\{[\s\S]*?max-width:\s*1200px;[\s\S]*?width:\s*100%;/);
  assert.match(source, /@media \(min-width: 1366px\) \{\s*\.main\s*\{\s*max-width:\s*none;\s*\}\s*\}/);
  assert.doesNotMatch(source, /@media \(max-width: 1365px\)[\s\S]*?\.main\s*\{[\s\S]*?max-width:\s*none;/);
});

test('smaller responsive breakpoints remain intact', () => {
  assert.match(source, /@media \(max-width: 600px\) \{[\s\S]*?\.main\s*\{\s*padding:/);
  assert.match(source, /@media \(max-width: 900px\) \{[\s\S]*?\.topbar/);
});
