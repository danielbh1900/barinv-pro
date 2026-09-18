'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const barback = fs.readFileSync(path.join(__dirname, '..', 'barback.html'), 'utf8');

test('TRANSFER action has a persistent purple selected state', () => {
  assert.match(
    barback,
    /\.action\.selected\[data-action="TRANSFER"\]\s*\{[\s\S]*?background:#7C3AED;[\s\S]*?color:#fff;[\s\S]*?border-color:#A78BFA;/,
  );
  assert.match(barback, /b\.classList\.toggle\('selected', b\.dataset\.action === state\.selectedAction\)/);
  assert.match(barback, /state\.selectedAction = btn\.dataset\.action;/);
  assert.match(barback, /data-action="TRANSFER"/);
});

