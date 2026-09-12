const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'barback.html'), 'utf8');

test('Phase 1N adds an opt-in Speak Item Names control and local preference', () => {
  assert.match(html, /SPEAK ITEM NAMES/);
  assert.match(html, /id="phase1-voice-item-toggle"/);
  assert.match(html, /const BARBACK_VOICE_ITEM_NAMES_KEY = 'barbackVoiceGuideSpeakItemNames'/);
  assert.match(html, /this\.speakItemNames = localStorage\.getItem\(BARBACK_VOICE_ITEM_NAMES_KEY\) === '1'/);
  assert.match(html, /setSpeakItemNames\(value\)/);
  assert.match(html, /localStorage\.setItem\(BARBACK_VOICE_ITEM_NAMES_KEY/);
});

test('Phase 1N keeps item names off by default and preserves generic phrases', () => {
  assert.match(html, /speakItemNames: false/);
  assert.match(html, /if \(!this\.speakItemNames\) return this\.speak\(generic, options\)/);
  assert.match(html, /VoiceGuide\.testVoice\(\)/);
  assert.match(html, /VoiceGuide\.announceOperationalState\('scanned'/);
  assert.match(html, /VoiceGuide\.announceOperationalState\('added'/);
  assert.match(html, /VoiceGuide\.announceOperationalState\('failed'/);
  assert.match(html, /VoiceGuide\.announceOperationalState\('blocked'/);
});

test('Phase 1N sanitizes and truncates spoken item names', () => {
  const start = html.indexOf('safeItemName(value)');
  const end = html.indexOf('speakState(generic', start);
  assert.ok(start >= 0 && end > start);
  const source = html.slice(start, end);
  assert.match(source, /replace\(\/\\s\+\/g, ' '\)/);
  assert.ok(source.includes('https?:') && source.includes('www\\.'));
  assert.ok(source.includes('\\d{8,}') && source.includes('[0-9a-f]{16,}'));
  assert.match(source, /name\.length > 40/);
  assert.match(source, /slice\(0, 39\)/);
  assert.doesNotMatch(source, /staff|pin|token|secret|url/i);
});

test('Phase 1N speaks names only at confirmed UI events and preserves Phase 1M', () => {
  assert.match(html, /phase1MarkPendingSelection\(it, source\)/);
  assert.match(html, /VoiceGuide\.announceOperationalState\('scanned'/);
  assert.match(html, /VoiceGuide\.announceOperationalState\('added'/);
  assert.match(html, /VoiceGuide\.announceOperationalState\('failed'/);
  for (const marker of ['VOICE GUIDE', 'TEST VOICE', 'barbackVoiceGuideEnabled', 'speechSynthesis', 'SpeechSynthesisUtterance', 'SCANNED — NOT ADDED YET', 'ADDED TO DRAFT', 'ACCESSORY / TARE', 'NET SAVED WEIGHT']) {
    assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  const voiceStart = html.indexOf('const VoiceGuide = {');
  const voiceEnd = html.indexOf('let phase1MeasureUnit', voiceStart);
  const source = html.slice(voiceStart, voiceEnd);
  assert.doesNotMatch(source, /eventsInsert|saveCore|addToReview|syncOutbox|fetch\(|\.from\(/);
});
