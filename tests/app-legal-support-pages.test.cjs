'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const pages = {
  'privacy-policy.html': {
    canonical: 'https://barinv.ca/privacy-policy.html',
    title: 'BARINV PRO App Privacy Policy',
  },
  'app/terms.html': {
    canonical: 'https://barinv.ca/app/terms',
    title: 'BARINV PRO App Terms of Use',
  },
  'support.html': {
    canonical: 'https://barinv.ca/support.html',
    title: 'BARINV PRO App Support',
  },
};

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function assertBalancedHtml(file, html) {
  const voidTags = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img',
    'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
  ]);
  const stack = [];
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const match of withoutComments.matchAll(/<(\/?)([a-z][\w-]*)(?:\s[^<>]*?)?\s*\/?>/gi)) {
    const closing = match[1] === '/';
    const tag = match[2].toLowerCase();
    const selfClosing = /\/>$/.test(match[0]);
    if (voidTags.has(tag) || selfClosing) continue;
    if (!closing) {
      stack.push(tag);
      continue;
    }
    assert.equal(stack.pop(), tag, `${file} has an unbalanced </${tag}>`);
  }
  assert.deepEqual(stack, [], `${file} has unclosed tags: ${stack.join(', ')}`);
}

function localLinks(file, html) {
  return [...html.matchAll(/href="([^"]+)"/g)]
    .map(match => match[1])
    .filter(href =>
      !href.startsWith('#') &&
      !href.startsWith('mailto:') &&
      !href.startsWith('https://') &&
      !href.startsWith('http://')
    )
    .map(href => href.split('#')[0])
    .filter(Boolean)
    .map(href => path.normalize(path.join(path.dirname(file), href)));
}

test('1. all app legal and support pages exist with static shared styling', () => {
  assert.ok(fs.statSync(path.join(root, 'legal.css')).size > 0);
  for (const file of Object.keys(pages)) {
    assert.ok(fs.statSync(path.join(root, file)).size > 0, `${file} is empty`);
  }
});

test('2. each page has valid basic HTML structure and its stable canonical URL', () => {
  for (const [file, expected] of Object.entries(pages)) {
    const html = read(file);
    assert.match(html, /^<!doctype html>/i, `${file} lacks doctype`);
    assert.match(html, /<html lang="en">/i, `${file} lacks language`);
    assert.match(html, /<meta charset="utf-8">/i, `${file} lacks charset`);
    assert.match(html, /<meta name="viewport"/i, `${file} lacks viewport`);
    assert.match(html, new RegExp(`<title>${expected.title}</title>`));
    assert.match(html, new RegExp(`<link rel="canonical" href="${expected.canonical.replaceAll('.', '\\.')}">`));
    assert.match(html, /<main id="main">[\s\S]*<\/main>/i, `${file} lacks main`);
    assert.match(html, /<h1>[^<]+<\/h1>/i, `${file} lacks h1`);
    assert.match(html, /<footer class="site-footer">/i, `${file} lacks footer`);
    assert.doesNotMatch(html, /<script\b/i, `${file} must remain static`);
    assertBalancedHtml(file, html);
  }
});

test('3. local legal navigation and stylesheet links resolve', () => {
  for (const file of Object.keys(pages)) {
    for (const href of localLinks(file, read(file))) {
      assert.ok(fs.existsSync(path.join(root, href)), `${file} has broken local link: ${href}`);
    }
  }
});

test('4. app privacy policy covers actual BARINV operational data and permissions', () => {
  const html = read('privacy-policy.html');
  const required = [
    /Admin app/i,
    /Barback Link/i,
    /Barback Manager/i,
    /Venue/i,
    /Night/i,
    /inventory movements/i,
    /Camera and barcode scanning/i,
    /Bluetooth and scale readings/i,
    /offline\/outbox submissions/i,
    /Supabase/i,
    /retention/i,
    /deletion/i,
    /info@barinv\.ca/i,
  ];
  for (const marker of required) assert.match(html, marker);
});

test('5. app terms cover authority, review, scale limits, and availability', () => {
  const html = read('app/terms.html');
  const required = [
    /authorized by the venue/i,
    /protect passwords, PINs, access links/i,
    /PENDING Events require/i,
    /must not attempt to bypass review/i,
    /operational estimates/i,
    /not represented as legally certified measurements/i,
    /offline drafts and queued submissions/i,
    /does not guarantee uninterrupted availability/i,
    /Acceptable use/i,
    /privacy-policy\.html/i,
  ];
  for (const marker of required) assert.match(html, marker);
});

test('6. support page provides safe operational and privacy request guidance', () => {
  const html = read('support.html');
  const required = [
    /info@barinv\.ca/i,
    /Never send secrets/i,
    /Venue name and Night\/date/i,
    /not an emergency service/i,
    /device storage is full or an outbox save failed/i,
    /Remote Scale Bridge readings are not accepted/i,
    /Privacy and account requests/i,
    /response times.*not.*guaranteed/is,
  ];
  for (const marker of required) assert.match(html, marker);
});

test('7. pages avoid unfinished placeholders and unsupported release claims', () => {
  for (const file of Object.keys(pages)) {
    const html = read(file);
    assert.doesNotMatch(html, /\bTODO\b|\bTBD\b|lorem ipsum/i, `${file} contains placeholder text`);
    assert.doesNotMatch(html, /App Store release (is )?(complete|completed|approved|live)/i);
    assert.doesNotMatch(html, /HIPAA|SOC ?2|ISO ?27001|PCI[- ]DSS certified/i);
  }
});

test('8. canonical App Store URL set is complete and distinct', () => {
  const canonicals = Object.values(pages).map(page => page.canonical);
  assert.equal(new Set(canonicals).size, 3);
  assert.deepEqual(canonicals.sort(), [
    'https://barinv.ca/app/terms',
    'https://barinv.ca/privacy-policy.html',
    'https://barinv.ca/support.html',
  ]);
});
