const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pinLogin = fs.readFileSync(path.join(root, 'supabase/functions/barback-pin-login/index.ts'), 'utf8');
const barback = fs.readFileSync(path.join(root, 'barback.html'), 'utf8');

test('PIN login includes item image_url in Barback bundle', () => {
  assert.match(pinLogin, /par_level, image_url/);
});

test('Barback UI renders item thumbnails safely', () => {
  assert.match(barback, /BARBACK_ITEM_THUMBNAILS_CSS_START/);
  assert.match(barback, /BARBACK_ITEM_THUMBNAILS_UI_START/);
  assert.match(barback, /function itemImageUrl\(item\)/);
  assert.match(barback, /function itemThumbHTML\(item, extraClass\)/);
  assert.match(barback, /onerror="this\.style\.display=\\'none\\'"/);
  assert.match(barback, /itemThumbHTML\(it, 'small'\)/);
  assert.match(barback, /itemThumbHTML\(it, 'bm-thumb'\)/);
  assert.match(barback, /itemThumbHTML\(row\.item, 'opening-par-thumb'\)/);
  assert.match(barback, /function hydrateItemThumbs\(root\)/);
});

test('Thumbnail hotfix keeps Browse names visible and avoids duplicate Browse thumbnails', () => {
  assert.match(barback, /BARBACK_ITEM_THUMBNAILS_HOTFIX_START/);
  assert.match(barback, /data-thumb-hydrated="1"/);
  assert.match(barback, /\.bm-card \.bm-name/);
  assert.match(barback, /white-space:normal/);
  assert.match(barback, /overflow:visible/);
});

test('Quantity modal shows scanned item thumbnail beside title', () => {
  assert.match(barback, /\.qm-item-with-thumb/);
  assert.match(barback, /itemThumbHTML\(it, 'qm-thumb'\)/);
  assert.match(barback, /\$\('qm-item'\)\) \$\('qm-item'\)\.innerHTML\s*=/);
});
